// Contrôle de santé du site pour l'admin : ce qui mérite un email.
// Utilisé par la fonction admin-alerts (toutes les heures) et par le
// bouton "Tester les alertes" de l'admin.
//
// Seuils réglables (secrets) : ALERT_STORAGE_PCT (80), ALERT_BW_GB (10 Go
// servis par jour), ALERT_DB_PCT (80 % des 500 Mo gratuits de Supabase).

// deno-lint-ignore-file no-explicit-any
import { adminAlertMail, mailConfig, sendEmails } from "./email.ts";

export type Alert = { key: string; level: "warn" | "crit"; title: string; detail: string };

const GB = 1024 ** 3;
const num = (name: string, def: number) => {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : def;
};
const fmt = (b: number) => (b >= GB ? (b / GB).toFixed(1).replace(".", ",") + " Go" : Math.round(b / 1024 ** 2) + " Mo");
const parisDay = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

export function adminEmails(): string[] {
  return (Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

// Ce qui ne va pas, là, maintenant
export async function currentAlerts(db: any): Promise<Alert[]> {
  const out: Alert[] = [];
  const now = Date.now();

  // 1. stockage B2 face au plafond du site
  const cap = num("STORAGE_TOTAL_GB", 9) * GB;
  const { data: used } = await db.rpc("storage_used");
  const pct = Math.round((Number(used) || 0) / cap * 100);
  const warnAt = num("ALERT_STORAGE_PCT", 80);
  if (pct >= warnAt) {
    out.push({
      key: "storage", level: pct >= 95 ? "crit" : "warn",
      title: `Stockage à ${pct} %`,
      detail: `${fmt(Number(used) || 0)} sur ${fmt(cap)} : au plafond, les nouveaux envois sont refusés. Supprime des fichiers dans l'admin, ou attends qu'ils expirent.`,
    });
  }

  // 2. base Supabase (500 Mo gratuits)
  const { data: dbBytes } = await db.rpc("db_size");
  const dbPct = Math.round((Number(dbBytes) || 0) / (500 * 1024 ** 2) * 100);
  if (dbPct >= num("ALERT_DB_PCT", 80)) {
    out.push({ key: "db", level: dbPct >= 95 ? "crit" : "warn", title: `Base de données à ${dbPct} %`, detail: `${fmt(Number(dbBytes) || 0)} sur les 500 Mo du plan gratuit Supabase.` });
  }

  // 3. emails : voie o2switch, listes noires, surveillance arrêtée
  const smtpOn = !!(Deno.env.get("SMTP_HOST") && Deno.env.get("SMTP_USER") && Deno.env.get("SMTP_PASS"));
  const { data: route } = await db.from("mail_route").select("*").eq("id", 1).maybeSingle();
  if (smtpOn && route) {
    const paused = route.smtp_paused_until && new Date(route.smtp_paused_until).getTime() > now;
    if (paused && !route.manual) {
      out.push({ key: "smtp-paused", level: "warn", title: "Emails : o2switch coupé, tout part par Brevo", detail: `${route.reason ?? ""} (jusqu'au ${new Date(route.smtp_paused_until).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}). Brevo : 300 emails par jour maximum.` });
    }
    const bl = route.last_check?.blacklists;
    if (Array.isArray(bl) && bl.length) {
      out.push({ key: "blacklist", level: "crit", title: "IP d'envoi sur liste noire", detail: bl.join(", ") });
    }
    if (!route.checked_at || now - new Date(route.checked_at).getTime() > 3 * 3600e3) {
      out.push({ key: "mail-health-stale", level: "warn", title: "La surveillance des emails ne tourne plus", detail: "Dernier contrôle il y a plus de 3 h (fonction mail-health)." });
    }
  }
  const since = new Date(now - 86400e3).toISOString();
  const [{ count: failed }, { count: brevo }] = await Promise.all([
    db.from("mail_log").select("id", { count: "exact", head: true }).eq("ok", false).gte("created_at", since),
    db.from("mail_log").select("id", { count: "exact", head: true }).eq("via", "brevo").eq("ok", true).gte("created_at", since),
  ]);
  if ((failed ?? 0) >= 5) {
    out.push({ key: "mail-failed", level: "warn", title: `${failed} emails refusés en 24 h`, detail: "Détail dans l'admin, onglet Emails." });
  }
  if ((brevo ?? 0) >= 240) {
    out.push({ key: "brevo-quota", level: (brevo ?? 0) >= 290 ? "crit" : "warn", title: `Brevo : ${brevo} emails sur 300 aujourd'hui`, detail: "Au-delà de 300, plus aucun email ne part tant qu'o2switch est coupé." });
  }

  // 4. bande passante du jour (relais Cloudflare)
  const today = parisDay();
  const weekAgo = parisDay(new Date(now - 7 * 86400e3));
  const { data: rows } = await db.from("bw_daily").select("day, kind, delivered_bytes").gte("day", weekAgo);
  let todayBytes = 0, prevBytes = 0;
  const prevDays = new Set<string>();
  for (const r of (rows ?? []) as any[]) {
    if (r.kind === "upload") continue;
    if (r.day === today) todayBytes += Number(r.delivered_bytes);
    else { prevBytes += Number(r.delivered_bytes); prevDays.add(r.day); }
  }
  const avg = prevDays.size ? prevBytes / prevDays.size : 0;
  const bwMax = num("ALERT_BW_GB", 10) * GB;
  if (todayBytes >= bwMax || (avg > 0 && todayBytes >= Math.max(GB, avg * 5))) {
    out.push({
      key: "bandwidth", level: todayBytes >= bwMax * 2 ? "crit" : "warn",
      title: `Pic de bande passante : ${fmt(todayBytes)} servis aujourd'hui`,
      detail: avg ? `Moyenne des jours précédents : ${fmt(avg)}.` : "Vérifie qu'aucun lien n'a été partagé massivement.",
    });
  }
  return out;
}

// Compare à ce qui est déjà connu, envoie un seul email si besoin.
// test = true : envoie tout de suite ce qu'on voit, sans rien mémoriser.
export async function runAlerts(db: any, opts: { test?: boolean; to?: string[] } = {}) {
  const alerts = await currentAlerts(db);
  const cfg = mailConfig();
  const to = opts.to?.length ? opts.to : adminEmails();
  if (!cfg || !to.length) return { alerts, sent: false, reason: !cfg ? "EMAIL_INDISPONIBLE" : "ADMIN_EMAILS_VIDE" };

  if (opts.test) {
    const mail = adminAlertMail({ site: cfg.site, alerts: alerts.map((a) => ({ ...a, isNew: true })), resolved: [], test: true });
    const res = await sendEmails(cfg, to.map((email) => ({ to: email, subject: mail.subject, html: mail.html, text: mail.text })), { kind: "admin" });
    return { alerts, sent: res.some((r) => r.ok) };
  }

  const nowIso = new Date().toISOString();
  const { data: known } = await db.from("admin_alerts").select("*");
  const byKey = new Map(((known ?? []) as any[]).map((k) => [k.key, k]));
  const current = new Set(alerts.map((a) => a.key));
  const toSend: (Alert & { isNew: boolean })[] = [];
  for (const a of alerts) {
    const k = byKey.get(a.key);
    const escalated = k && k.level === "warn" && a.level === "crit";
    const due = !k || escalated || !k.last_sent_at || Date.now() - new Date(k.last_sent_at).getTime() >= 24 * 3600e3;
    if (due) toSend.push({ ...a, isNew: !k || escalated });
  }
  const resolved = ((known ?? []) as any[]).filter((k) => !current.has(k.key));

  let sent = false;
  if (toSend.length || resolved.length) {
    // l'email liste tout ce qui est en cours, pas seulement ce qui a changé
    const all = alerts.map((a) => toSend.find((t) => t.key === a.key) ?? { ...a, isNew: false });
    const mail = adminAlertMail({ site: cfg.site, alerts: all, resolved: resolved.map((r) => r.title) });
    const res = await sendEmails(cfg, to.map((email) => ({ to: email, subject: mail.subject, html: mail.html, text: mail.text })), { kind: "admin" });
    sent = res.some((r) => r.ok);
  }
  // mémoire : seulement si l'email est parti (sinon on réessaie à l'heure suivante)
  if (sent || (!toSend.length && !resolved.length)) {
    for (const a of alerts) {
      const k = byKey.get(a.key);
      const wasSent = toSend.some((t) => t.key === a.key);
      await db.from("admin_alerts").upsert({
        key: a.key, level: a.level, title: a.title, detail: a.detail, seen_at: nowIso,
        first_at: k ? k.first_at : nowIso,
        last_sent_at: wasSent ? nowIso : (k ? k.last_sent_at : null),
      });
    }
    if (resolved.length) await db.from("admin_alerts").delete().in("key", resolved.map((r) => r.key));
  }
  return { alerts, sent, new: toSend.length, resolved: resolved.length };
}
