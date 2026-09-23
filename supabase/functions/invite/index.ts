// Invitations par email aux salons et aux retours.
//
// POST { action: "create", space_id, emails: [...] }  (host)  -> { results }
// POST { action: "info", token }         -> espace, adresse masquée, déjà vérifié ?
// POST { action: "send-code", token }    -> code à 6 chiffres envoyé à l'adresse invitée
// POST { action: "accept", token, code?, pseudo }  -> entre dans l'espace
//
// Le lien porte un jeton de 128 bits (seul son sha256 est stocké). Il ne
// suffit pas : il faut aussi le code reçu à l'adresse invitée, sauf sur un
// appareil qui a déjà vérifié cette adresse. Même personne sur un nouvel
// appareil : elle retrouve sa place (même blaze, mêmes commentaires).
// Déployée avec --no-verify-jwt : l'appelant est identifié via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { inviteMail, isVerified, mailConfig, sendEmails } from "../_shared/email.ts";
import { confirmCode, requestCode, sha256 } from "../_shared/codes.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITE_DAYS = 30;
const PER_CALL = 10;
const PER_DAY = 30;      // invitations envoyées par espace sur 24 h
const PER_SPACE = 200;   // invitations en tout par espace

type Invite = {
  id: string; space_id: string; email: string; expires_at: string;
  accepted_participant: string | null; invited_by: string | null;
};
type Space = {
  id: string; name: string; code: string; mode: string; access: string;
  expires_at: string; purge_at: string; is_locked: boolean; max_file_bytes: number;
};

function newToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mask(email: string): string {
  const [user, domain] = email.split("@");
  return user.slice(0, 1) + "•••@" + domain;
}

const what = (mode: string) => (mode === "revue" ? "l'espace de retours" : "le salon");

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);
  const body = await readJson(req);

  // -------------------------------------------------------------- inviter
  if (body.action === "create") {
    const spaceId = String(body.space_id ?? "");
    const { data: me } = await db.from("participants").select("id, pseudo, is_host")
      .eq("space_id", spaceId).eq("user_id", uid).maybeSingle();
    if (!me || !me.is_host) return json({ error: "SEUL_LE_HOST" }, 403);
    const { data: space } = await db.from("spaces").select("id, name, mode, purge_at").eq("id", spaceId).maybeSingle();
    if (!space || space.mode === "envoi") return json({ error: "ESPACE_INCONNU" }, 404);

    const emails = [...new Set((Array.isArray(body.emails) ? body.emails : [])
      .map((e: unknown) => String(e ?? "").trim().toLowerCase()).filter(Boolean))].slice(0, PER_CALL) as string[];
    const bad = emails.find((e) => !EMAIL_RE.test(e) || e.length > 254);
    if (bad) return json({ error: "EMAIL_INVALIDE", detail: bad }, 400);
    if (!emails.length) return json({ error: "EMAIL_INVALIDE" }, 400);

    const cfg = mailConfig();
    if (!cfg) return json({ error: "EMAIL_INDISPONIBLE" }, 503);

    const dayAgo = new Date(Date.now() - 86400e3).toISOString();
    const [{ count: today }, { count: total }] = await Promise.all([
      db.from("space_invites").select("id", { count: "exact", head: true }).eq("space_id", spaceId).gte("created_at", dayAgo),
      db.from("space_invites").select("id", { count: "exact", head: true }).eq("space_id", spaceId),
    ]);
    if ((today ?? 0) + emails.length > PER_DAY || (total ?? 0) + emails.length > PER_SPACE) {
      return json({ error: "QUOTA_INVITATIONS" }, 429);
    }

    const expires = new Date(Math.min(Date.now() + INVITE_DAYS * 86400e3, new Date(space.purge_at).getTime())).toISOString();
    const outgoing = [];
    for (const email of emails) {
      const token = newToken();
      // réinviter la même adresse : nouveau lien, l'ancien ne marche plus
      const { error } = await db.from("space_invites").upsert({
        space_id: spaceId, email, token_hash: await sha256(token), invited_by: me.id,
        created_at: new Date().toISOString(), expires_at: expires,
      }, { onConflict: "space_id,email" });
      if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);
      const mail = inviteMail({
        site: cfg.site, email, host: me.pseudo, spaceName: space.name, mode: space.mode,
        link: `${cfg.site}/index.html?i=${token}`, expiresAt: expires,
      });
      outgoing.push({ to: email, subject: mail.subject, html: mail.html, text: mail.text });
    }
    const sent = await sendEmails(cfg, outgoing);
    return json({
      results: emails.map((email, i) => ({ email, status: sent[i].ok ? "sent" : "failed", error: sent[i].ok ? null : sent[i].error })),
    });
  }

  // -------------------------------------------- côté invité : le lien
  const token = String(body.token ?? "");
  if (!/^[0-9a-f]{32}$/.test(token)) return json({ error: "INVITATION_INCONNUE" }, 404);
  const { data: invite } = await db.from("space_invites")
    .select("id, space_id, email, expires_at, accepted_participant, invited_by")
    .eq("token_hash", await sha256(token)).maybeSingle<Invite>();
  if (!invite) return json({ error: "INVITATION_INCONNUE" }, 404);
  const { data: space } = await db.from("spaces")
    .select("id, name, code, mode, access, expires_at, purge_at, is_locked, max_file_bytes")
    .eq("id", invite.space_id).maybeSingle<Space>();
  if (!space || new Date(space.purge_at) < new Date()) return json({ error: "ESPACE_EXPIRE" }, 410);
  if (new Date(invite.expires_at) < new Date()) return json({ error: "INVITATION_EXPIREE" }, 410);

  if (body.action === "info") {
    const [{ data: host }, { data: already }] = await Promise.all([
      invite.invited_by
        ? db.from("participants").select("pseudo").eq("id", invite.invited_by).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from("participants").select("id, pseudo").eq("space_id", space.id).eq("user_id", uid).maybeSingle(),
    ]);
    let returning: string | null = null;
    if (invite.accepted_participant) {
      const { data: p } = await db.from("participants").select("pseudo").eq("id", invite.accepted_participant).maybeSingle();
      returning = p ? p.pseudo : null;
    }
    return json({
      space_name: space.name, mode: space.mode, host: host ? host.pseudo : null,
      email: mask(invite.email), verified: await isVerified(db, uid, invite.email),
      member: already ? already.pseudo : null, returning,
    });
  }

  if (body.action === "send-code") {
    const cfg = mailConfig();
    if (!cfg) return json({ error: "EMAIL_INDISPONIBLE" }, 503);
    const r = await requestCode(db, cfg, req, uid, invite.email, `pour rejoindre ${what(space.mode)} ${space.name}`);
    if (!r.ok) return json({ error: r.error, detail: r.detail }, r.status);
    return json(r.verified ? { verified: true } : { sent: true });
  }

  if (body.action === "accept") {
    const check = await confirmCode(db, uid, invite.email, body.code);
    if (!check.ok) return json({ error: check.error }, check.status);

    let participant: { id: string; pseudo: string } | null = null;
    const { data: already } = await db.from("participants").select("id, pseudo")
      .eq("space_id", space.id).eq("user_id", uid).maybeSingle();
    if (already) {
      participant = already;
    } else if (invite.accepted_participant) {
      // même personne (adresse vérifiée), nouvel appareil : elle reprend sa place
      const { data: moved } = await db.from("participants")
        .update({ user_id: uid, last_seen_at: new Date().toISOString() })
        .eq("id", invite.accepted_participant).select("id, pseudo").maybeSingle();
      participant = moved;
    }
    if (!participant) {
      const pseudo = String(body.pseudo ?? "").trim();
      if (pseudo.length < 2 || pseudo.length > 24) return json({ error: "PSEUDO_INVALIDE" }, 400);
      const { count } = await db.from("participants").select("id", { count: "exact", head: true }).eq("space_id", space.id);
      if ((count ?? 0) >= 200) return json({ error: "ESPACE_PLEIN" }, 409);
      const { data: created, error } = await db.from("participants")
        .insert({ space_id: space.id, user_id: uid, pseudo, is_host: false })
        .select("id, pseudo").single();
      if (error) return json({ error: error.code === "23505" ? "PSEUDO_PRIS" : "ERREUR_BASE", detail: error.message }, 409);
      participant = created;
    }
    await db.from("space_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_participant: participant!.id })
      .eq("id", invite.id);

    return json({
      space_id: space.id, participant_id: participant!.id, name: space.name, code: space.code,
      mode: space.mode, access: space.access, expires_at: space.expires_at, is_locked: space.is_locked,
      max_file_bytes: space.max_file_bytes, is_host: false, pseudo: participant!.pseudo,
    });
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
