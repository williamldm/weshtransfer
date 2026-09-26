// Santé de la voie d'envoi o2switch, toutes les heures (pg_cron, secret).
// Le moindre signal "ces emails risquent de finir en spam" coupe la voie
// (mail_trip) : Brevo prend tout le trafic le temps que ça se calme.
//
//   1. Listes noires : l'IP d'envoi o2switch sur Spamhaus, SpamCop,
//      Barracuda, Mailspike, PSBL -> coupure 12 h (prolongée à chaque
//      contrôle tant qu'elle y reste).
//   2. Rebonds reçus dans la boîte d'envoi (IMAP) : chaque rebond est
//      rattaché à son email (Message-ID). Refus "spam / réputation /
//      authentification" -> coupure 24 h, 72 h dès le deuxième en 24 h.
//      Adresses inexistantes > 8 % des envois (sur 25+) -> coupure 24 h.
//   3. Ouvertures : les destinataires d'un transfert parti par o2switch
//      ouvrent-ils leur lien aussi souvent que ceux de Brevo ? Moitié moins
//      (20+ envois de chaque côté), ou moins de 15 % sans point de
//      comparaison -> coupure 72 h. C'est le signe typique du dossier spam.
//   4. Sonde d'authentification, chaque semaine : un email à l'analyseur
//      public de Port25, dont la réponse (SPF, DKIM, DMARC, SpamAssassin)
//      revient dans la boîte d'envoi. Un échec -> coupure 72 h.
//
// Déployée avec --no-verify-jwt : appel par secret uniquement.

// deno-lint-ignore-file no-explicit-any
import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";
import { smtpConfig, smtpSendAll } from "../_shared/smtp.ts";
import { Imap, markSeen, unreadMessages } from "../_shared/imap.ts";
import { badRecipient, spamSignal, trip } from "../_shared/mail-route.ts";

const PROBE_TO = "check-auth@verifier.port25.com";
const LISTS = ["zen.spamhaus.org", "bl.spamcop.net", "b.barracudacentral.org", "bl.mailspike.net", "psbl.surriel.com"];

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dnsA(name: string): Promise<string[]> {
  const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`, {
    headers: { Accept: "application/dns-json" },
  });
  const body = await res.json().catch(() => ({})) as { Answer?: { type: number; data: string }[] };
  return (body.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

// ------------------------------------------------------ 1. listes noires
async function blacklists(host: string): Promise<{ ips: string[]; listed: string[] }> {
  const extra = (Deno.env.get("SMTP_OUT_IPS") ?? "").split(/[\s,]+/).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
  const ips = [...new Set([...(await dnsA(host)), ...extra])];
  const listed: string[] = [];
  await Promise.all(ips.flatMap((ip) => LISTS.map(async (bl) => {
    const rev = ip.split(".").reverse().join(".");
    const hits = await dnsA(`${rev}.${bl}`).catch(() => []);
    // 127.255.255.x : la liste refuse de répondre au résolveur public (pas une inscription)
    if (hits.some((h) => h.startsWith("127.") && !h.startsWith("127.255.255."))) listed.push(`${ip} sur ${bl}`);
  })));
  return { ips, listed };
}

// ---------------------------------------------------------- 2. rebonds
function decodeParts(raw: string): string {
  // les parties en base64 (certains serveurs encodent le rapport)
  const blocks = raw.match(/(?:^[A-Za-z0-9+/=]{60,}\r?\n){3,}/gm) ?? [];
  let out = raw;
  for (const b of blocks.slice(0, 4)) {
    try {
      const bin = atob(b.replace(/\s+/g, ""));
      out += "\n" + new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch { /* pas du base64 */ }
  }
  return out;
}

function header(raw: string, name: string): string {
  const head = raw.split(/\r?\n\r?\n/)[0];
  const m = head.match(new RegExp(`^${name}:([^\\n]*(?:\\n[ \\t][^\\n]*)*)`, "im"));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

type Mail = { uid: string; raw: string };

function isBounce(m: Mail): boolean {
  const from = header(m.raw, "From");
  const type = header(m.raw, "Content-Type");
  const subject = header(m.raw, "Subject");
  return /mailer-daemon|postmaster/i.test(from) || /report-type=["']?delivery-status/i.test(type) ||
    /undeliver|delivery status|failure notice|returned mail|non remis|échec de la remise|delivery has failed/i.test(subject);
}

function isProbeReply(m: Mail): boolean {
  return /port25\.com/i.test(header(m.raw, "From"));
}

async function handleBounces(db: any, mails: Mail[], domain: string) {
  let spam = 0, invalid = 0;
  const notes: string[] = [];
  for (const m of mails) {
    const text = decodeParts(m.raw);
    const status = text.match(/^Status:\s*([245]\.\d{1,3}\.\d{1,3})/im)?.[1] ?? text.match(/\b([45]\.\d\.\d{1,2})\b/)?.[1] ?? "";
    const diag = (text.match(/^Diagnostic-Code:\s*([^\n]*(?:\n[ \t][^\n]*)*)/im)?.[1] ??
      text.match(/^(?:.*(?:550|554|552|553|421|451|452)[ -].*)$/m)?.[0] ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (status.startsWith("2")) continue;   // accusé de réception, pas un rebond
    const ids = [...new Set(text.match(new RegExp(`[0-9a-f-]{36}@${domain.replace(/\./g, "\\.")}`, "gi")) ?? [])];
    const summary = `${status} ${diag}`.trim() || "rebond illisible";
    const reputation = spamSignal(summary) && !badRecipient(summary);
    if (reputation) spam++;
    else if (badRecipient(summary) || status.startsWith("5.1")) invalid++;
    for (const id of ids) {
      await db.from("mail_log").update({ bounced_at: new Date().toISOString(), bounce: summary.slice(0, 500) })
        .eq("message_id", id).eq("via", "smtp");
    }
    if (reputation) notes.push(summary);
  }
  return { spam, invalid, notes };
}

// ----------------------------------------------- 4. sonde d'authentification
function probeVerdict(m: Mail): { fail: string[]; source: string } {
  const text = decodeParts(m.raw);
  const fail: string[] = [];
  // l'IP qui a réellement remis l'email (à autoriser dans le SPF si besoin)
  const source = text.match(/Source IP:\s*([0-9a-f.:]+)/i)?.[1] ?? "";
  for (const check of ["SPF", "DKIM", "DMARC", "iprev", "SpamAssassin"]) {
    const r = text.match(new RegExp(`^${check} check:\\s*(\\w+)`, "im"))?.[1]?.toLowerCase();
    if (!r) continue;
    if (check === "SpamAssassin" ? r !== "ham" : !["pass", "neutral", "none"].includes(r)) fail.push(`${check} ${r}`);
  }
  return { fail, source };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHODE" }, 405);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("CRON_SECRET") ?? "")) {
    return json({ error: "INTERDIT" }, 403);
  }
  const body = await req.json().catch(() => ({})) as { probe?: boolean };
  const db = admin();
  const smtp = smtpConfig();
  if (!smtp) return json({ skipped: "o2switch non configuré" });
  const domain = smtp.user.split("@")[1] ?? "";

  const { data: route } = await db.from("mail_route").select("*").eq("id", 1).single();
  // Identifiants refusés : on ne retente rien (ni IMAP ni sonde) tant que la
  // coupure dure. Des échecs de connexion répétés feraient bannir l'IP de
  // Supabase par la protection anti-force brute d'o2switch (cPHulk).
  const authBlocked = !!(route?.smtp_paused_until && new Date(route.smtp_paused_until) > new Date() &&
    /^authentification/.test(route.reason ?? ""));
  const authFailed = async (where: string, err: string) => {
    await event("error", `${where} : ${err}`);
    await trip(db, 6, `authentification o2switch refusée (${where}) : ${err}`);
  };
  const sinceResume = route?.smtp_paused_until && new Date(route.smtp_paused_until) < new Date()
    ? new Date(route.smtp_paused_until) : new Date(0);
  const report: Record<string, unknown> = { at: new Date().toISOString() };
  const event = (kind: string, detail: string) => db.from("mail_events").insert({ kind, detail: detail.slice(0, 1000) });

  // 1. listes noires
  try {
    const bl = await blacklists(smtp.host);
    report.ips = bl.ips;
    report.blacklists = bl.listed;
    if (bl.listed.length) {
      await event("blacklist", bl.listed.join(", "));
      await trip(db, 12, `IP o2switch sur liste noire : ${bl.listed.join(", ")}`);
    }
  } catch (err) {
    report.blacklists_error = (err as Error).message;
  }

  // 2 + 4. boîte d'envoi : rebonds et réponse de la sonde
  let im: Imap | null = null;
  if (authBlocked) report.imap = "suspendu (identifiants refusés)";
  else try {
    im = await Imap.open(Deno.env.get("IMAP_HOST") || smtp.host);
    await im.login(smtp.user, smtp.pass);
    const mails = await unreadMessages(im, new Date(Date.now() - 3 * 86400e3));
    const bounces = mails.filter(isBounce);
    const probes = mails.filter(isProbeReply);
    const b = await handleBounces(db, bounces, domain);
    report.bounces = { read: bounces.length, spam: b.spam, invalid: b.invalid };
    if (b.spam) {
      await event("bounce", b.notes.join(" | "));
      const { count } = await db.from("mail_log").select("id", { count: "exact", head: true })
        .eq("via", "smtp").gte("bounced_at", new Date(Date.now() - 86400e3).toISOString())
        .or("bounce.ilike.%5.7.%,bounce.ilike.%spam%,bounce.ilike.%block%,bounce.ilike.%reputation%,bounce.ilike.%policy%");
      await trip(db, (count ?? b.spam) >= 2 ? 72 : 24, `rebond spam/réputation : ${b.notes[0]}`);
    }
    for (const p of probes) {
      const v = probeVerdict(p);
      report.probe = v.fail.length ? v.fail : "ok";
      report.probe_source = v.source;
      await event("probe", (v.fail.length ? `échec : ${v.fail.join(", ")}` : "SPF, DKIM, DMARC : ok") +
        (v.source ? ` (envoyé depuis ${v.source})` : ""));
      if (v.fail.length) await trip(db, 72, `sonde d'authentification : ${v.fail.join(", ")}`);
    }
    await markSeen(im, [...bounces, ...probes].map((m) => m.uid));
  } catch (err) {
    const msg = (err as Error).message;
    report.imap_error = msg;
    if (/LOGIN|AUTHENTICATIONFAILED|authentication failed/i.test(msg)) await authFailed("IMAP", msg);
    else await event("error", `IMAP : ${msg}`);
  } finally {
    if (im) await im.close();
  }

  // 2 bis. adresses inexistantes
  const weekAgo = new Date(Math.max(Date.now() - 7 * 86400e3, sinceResume.getTime())).toISOString();
  {
    const [{ count: sent }, { count: hard }] = await Promise.all([
      db.from("mail_log").select("id", { count: "exact", head: true }).eq("via", "smtp").eq("ok", true).gte("created_at", weekAgo),
      db.from("mail_log").select("id", { count: "exact", head: true }).eq("via", "smtp").gte("created_at", weekAgo)
        .not("bounced_at", "is", null).ilike("bounce", "5.1.%"),
    ]);
    report.hard_bounce = { sent, hard };
    if ((sent ?? 0) >= 25 && (hard ?? 0) / (sent ?? 1) > 0.08) {
      await trip(db, 24, `trop d'adresses inexistantes : ${hard}/${sent}`);
    }
  }

  // 3. ouvertures des liens de transfert, par voie (envois de plus de 24 h)
  {
    const dayAgo = new Date(Date.now() - 86400e3).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 86400e3).toISOString();
    const rate = async (via: string, from: string) => {
      const { data } = await db.from("mail_log").select("ref").eq("via", via).eq("ok", true)
        .not("ref", "is", null).gte("created_at", from).lt("created_at", dayAgo).limit(1000);
      const refs = (data ?? []).map((r: any) => r.ref);
      if (!refs.length) return { n: 0, opened: 0 };
      const { count } = await db.from("transfer_recipients").select("id", { count: "exact", head: true })
        .in("id", refs.slice(0, 300)).not("first_opened_at", "is", null);
      const n = Math.min(refs.length, 300);
      return { n, opened: count ?? 0 };
    };
    const s = await rate("smtp", weekAgo);
    const b = await rate("brevo", monthAgo);
    report.opens = { smtp: s, brevo: b };
    const sr = s.n ? s.opened / s.n : 0;
    const br = b.n ? b.opened / b.n : 0;
    if (s.n >= 20 && ((b.n >= 20 && sr < br * 0.5) || (b.n < 20 && sr < 0.15))) {
      await event("engagement", `o2switch ${s.opened}/${s.n} ouverts, Brevo ${b.opened}/${b.n}`);
      await trip(db, 72, `liens peu ouverts via o2switch (${Math.round(sr * 100)} % contre ${Math.round(br * 100)} %) : dossier spam probable`);
    }
  }

  // 4. sonde hebdomadaire (ou à la demande)
  {
    const lastProbe = (route?.last_check as any)?.probe_sent_at;
    const due = !authBlocked && (body.probe || !lastProbe || Date.now() - new Date(lastProbe).getTime() > 7 * 86400e3);
    report.probe_sent_at = lastProbe ?? null;
    if (due) {
      try {
        const [r] = await smtpSendAll(smtp, [{
          from: { name: "WeshTransfer", email: smtp.user },
          to: PROBE_TO,
          subject: "Ton envoi a décollé",
          text: "Contrôle automatique d'authentification (SPF, DKIM, DMARC) de WeshTransfer.",
          html: "<p>Contrôle automatique d'authentification (SPF, DKIM, DMARC) de WeshTransfer.</p>",
        }]);
        if (r.ok) report.probe_sent_at = new Date().toISOString();
        else report.probe_error = r.error;
      } catch (err) {
        report.probe_error = (err as Error).message;
        if (/\b535\b|auth/i.test(report.probe_error as string)) await authFailed("SMTP", report.probe_error as string);
      }
    }
  }

  await db.from("mail_route").update({ checked_at: new Date().toISOString(), last_check: report }).eq("id", 1);
  // journal : 30 jours
  await db.from("mail_log").delete().lt("created_at", new Date(Date.now() - 30 * 86400e3).toISOString());
  await db.from("mail_events").delete().lt("created_at", new Date(Date.now() - 90 * 86400e3).toISOString());
  return json(report);
});
