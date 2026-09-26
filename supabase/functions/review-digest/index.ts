// Retours de mix : récapitulatif par email pour l'ingé son.
//
// POST (pg_cron, x-cron-secret)            -> envoie les récapitulatifs prêts
// POST { action: "status", space_id }      -> { email } ou { email: null }
// POST { action: "subscribe", space_id, email }  (ingé, adresse vérifiée)
// POST { action: "unsubscribe", space_id }
// POST { action: "flush", space_id }       -> l'artiste a fini : envoi immédiat
//
// Un récapitulatif part quand l'artiste n'a plus rien fait depuis 10
// minutes (pas un email par retour). Contenu : nouveaux retours, "pas
// encore réglé", réponses, corrections validées, mix validé.
// Déployée avec --no-verify-jwt : cron par secret, appli par JWT.

// deno-lint-ignore-file no-explicit-any
import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified, mailConfig, reviewDigestMail, sendEmails, type MailConfig } from "../_shared/email.ts";

const QUIET_MS = 10 * 60e3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Sub = { participant_id: string; space_id: string; email: string; since: string; last_sent_at: string | null };

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const later = (a: string | null, b: string) => !!a && a > b;

async function digest(db: any, cfg: MailConfig, sub: Sub, force: boolean): Promise<string> {
  const since = sub.since;
  const { data: space } = await db.from("spaces").select("id, name, mode").eq("id", sub.space_id).maybeSingle();
  if (!space || space.mode !== "revue") return "hors-sujet";

  const [{ data: comments }, { data: approvals }] = await Promise.all([
    db.from("comments")
      .select("id, file_id, parent_id, body, at_ms, tag, created_at, verified_at, reopened_at, author_id, author:participants(pseudo)")
      .eq("space_id", space.id).neq("author_id", sub.participant_id)
      .or(`created_at.gt.${since},verified_at.gt.${since},reopened_at.gt.${since}`),
    db.from("files").select("id, version_no, project_id, approved_at, approved_by")
      .eq("space_id", space.id).gt("approved_at", since)
      // validation notée par l'ingé lui-même : pas une nouvelle pour lui
      .eq("approved_on_behalf", false),
  ]);
  const cs = (comments ?? []) as any[];
  const aps = (approvals ?? []) as any[];
  if (!cs.length && !aps.length) return "rien";

  // l'artiste est-il encore en train d'écrire ?
  const times = [
    ...cs.flatMap((c) => [c.created_at, c.verified_at, c.reopened_at].filter((t) => later(t, since))),
    ...aps.map((f) => f.approved_at),
  ];
  const latest = times.sort().pop() as string;
  if (!force && Date.now() - new Date(latest).getTime() < QUIET_MS) return "en cours";

  // versions et morceaux concernés
  const fileIds = [...new Set([...cs.map((c) => c.file_id), ...aps.map((f) => f.id)])];
  const { data: files } = await db.from("files").select("id, version_no, project_id, project:projects(title)").in("id", fileIds);
  const fileOf = new Map((files ?? []).map((f: any) => [f.id, f]));
  const projectIds = [...new Set((files ?? []).map((f: any) => f.project_id))];
  const { data: lastVersions } = await db.from("files").select("id, project_id, version_no")
    .in("project_id", projectIds).eq("status", "ready").order("version_no", { ascending: false });
  const latestFile = new Map<string, string>();
  for (const f of (lastVersions ?? []) as any[]) if (!latestFile.has(f.project_id)) latestFile.set(f.project_id, f.id);

  const projects = new Map<string, any>();
  const projectOf = (fileId: string) => {
    const f: any = fileOf.get(fileId);
    if (!f) return null;
    if (!projects.has(f.project_id)) {
      projects.set(f.project_id, {
        title: f.project ? f.project.title : "Morceau",
        link: `${cfg.site}/app.html#/f/${latestFile.get(f.project_id) ?? f.id}`,
        items: [] as any[], verified: 0, approved: null,
      });
    }
    return projects.get(f.project_id);
  };
  const artists = new Set<string>();
  for (const c of cs.sort((a, b) => (a.at_ms ?? 1e12) - (b.at_ms ?? 1e12))) {
    const p = projectOf(c.file_id);
    if (!p) continue;
    const author = c.author ? c.author.pseudo : null;
    if (author) artists.add(author);
    const version = "v" + (fileOf.get(c.file_id) as any)?.version_no;
    if (!c.parent_id && later(c.created_at, since)) p.items.push({ kind: "new", at: c.at_ms, tag: c.tag, body: c.body, author, version });
    else if (!c.parent_id && later(c.reopened_at, since)) p.items.push({ kind: "reopen", at: c.at_ms, tag: c.tag, body: c.body, author, version });
    else if (c.parent_id && later(c.created_at, since)) p.items.push({ kind: "reply", at: null, tag: null, body: c.body, author, version });
    if (!c.parent_id && later(c.verified_at, since)) p.verified++;
  }
  for (const f of aps) {
    const p = projectOf(f.id);
    if (p) { p.approved = { version: "v" + f.version_no, by: f.approved_by }; if (f.approved_by) artists.add(f.approved_by); }
  }
  const list = [...projects.values()].filter((p) => p.items.length || p.verified || p.approved);
  if (!list.length) return "rien";

  const mail = reviewDigestMail({ site: cfg.site, spaceName: space.name, artists: [...artists], projects: list });
  const [sent] = await sendEmails(cfg, [{ to: sub.email, subject: mail.subject, html: mail.html, text: mail.text }]);
  if (!sent.ok) return "échec : " + sent.error;
  const now = new Date().toISOString();
  await db.from("review_subscriptions").update({ since: now, last_sent_at: now }).eq("participant_id", sub.participant_id);
  return "envoyé";
}

Deno.serve(async (req) => {
  const db = admin();

  // ---------------------------------------------------------------- cron
  if (req.headers.get("x-cron-secret") !== null) {
    if (!sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("CRON_SECRET") ?? "")) {
      return json({ error: "INTERDIT" }, 403);
    }
    const cfg = mailConfig();
    if (!cfg) return json({ skipped: "EMAIL_INDISPONIBLE" });
    const { data: subs } = await db.from("review_subscriptions").select("*").limit(200);
    const report: Record<string, number> = {};
    for (const sub of (subs ?? []) as Sub[]) {
      const r = await digest(db, cfg, sub, false).catch((e) => "erreur : " + (e as Error).message);
      report[r] = (report[r] ?? 0) + 1;
    }
    return json({ report });
  }

  // -------------------------------------------------------------- appli
  const early = preflight(req);
  if (early) return early;
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);
  const body = await readJson(req);
  const spaceId = String(body.space_id ?? "");

  const { data: me } = await db.from("participants").select("id, is_host")
    .eq("space_id", spaceId).eq("user_id", uid).maybeSingle();
  if (!me) return json({ error: "NON_MEMBRE" }, 403);
  const { data: space } = await db.from("spaces").select("id, mode").eq("id", spaceId).maybeSingle();
  if (!space || space.mode !== "revue") return json({ error: "ESPACE_INCONNU" }, 404);

  if (body.action === "status") {
    const { data: sub } = await db.from("review_subscriptions").select("email").eq("participant_id", me.id).maybeSingle();
    return json({ email: sub ? sub.email : null });
  }

  if (body.action === "subscribe") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "EMAIL_INVALIDE" }, 400);
    // réservé à l'ingé : host, ou quelqu'un qui a déposé un mix ici
    if (!me.is_host) {
      const { count } = await db.from("files").select("id", { count: "exact", head: true })
        .eq("space_id", spaceId).eq("uploaded_by", me.id);
      if (!count) return json({ error: "RESERVE_INGE" }, 403);
    }
    if (!await isVerified(db, uid, email)) return json({ error: "EMAIL_NON_VERIFIE" }, 403);
    const { error } = await db.from("review_subscriptions").upsert({
      participant_id: me.id, space_id: spaceId, email, since: new Date().toISOString(),
    }, { onConflict: "participant_id" });
    if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);
    return json({ email });
  }

  if (body.action === "unsubscribe") {
    await db.from("review_subscriptions").delete().eq("participant_id", me.id);
    return json({ email: null });
  }

  if (body.action === "flush") {
    const cfg = mailConfig();
    if (!cfg) return json({ error: "EMAIL_INDISPONIBLE" }, 503);
    const { data: subs } = await db.from("review_subscriptions").select("*").eq("space_id", spaceId);
    let sent = 0;
    for (const sub of (subs ?? []) as Sub[]) {
      if (sub.participant_id === me.id) continue;                                   // pas à soi-même
      if (sub.last_sent_at && Date.now() - new Date(sub.last_sent_at).getTime() < 2 * 60e3) continue;  // anti-rafale
      if (await digest(db, cfg, sub, true) === "envoyé") sent++;
    }
    return json({ subscribed: (subs ?? []).some((s: any) => s.participant_id !== me.id), sent });
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
