// Session anonyme + appartenance à un espace. Aucun compte : l'appareil
// reçoit un utilisateur anonyme Supabase, puis rejoint un espace via son code.

import { sb, q, requireClient } from "./db.js?v=6";

const SPACE_KEY = "seminaire.space";

export function getSpace() {
  try { return JSON.parse(localStorage.getItem(SPACE_KEY)); } catch (err) { return null; }
}

function setSpace(space) {
  try { localStorage.setItem(SPACE_KEY, JSON.stringify(space)); } catch (err) { /* navigation privée */ }
}

export function leaveSpace() {
  try { localStorage.removeItem(SPACE_KEY); } catch (err) { /* idem */ }
}

export async function ensureAuth() {
  requireClient();
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;

  const res = await sb.auth.signInAnonymously();
  if (res.error) {
    // Tout le monde partage la même IP dans une villa : la limite de
    // connexions anonymes par IP peut sauter si on insiste.
    throw new Error(/rate|limit/i.test(res.error.message) ? "TROP_DE_CONNEXIONS" : "NON_AUTHENTIFIE");
  }
  return res.data.session;
}

export async function currentUserId() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user.id : null;
}

export async function joinSpace(code, pseudo) {
  await ensureAuth();
  const s = await q(sb.rpc("join_space", { p_code: code, p_pseudo: pseudo }));
  const space = {
    id: s.space_id,
    participantId: s.participant_id,
    name: s.name,
    code: s.code,
    isHost: s.is_host,
    isLocked: s.is_locked,
    expiresAt: s.expires_at,
    maxFileBytes: s.max_file_bytes,
    pseudo
  };
  setSpace(space);
  return space;
}

// Au démarrage de l'appli : la session et l'appartenance tiennent-elles ?
// null = il faut repasser par l'écran d'entrée ; une exception = réseau.
export async function restore() {
  requireClient();
  const space = getSpace();
  if (!space) return null;

  const { data } = await sb.auth.getSession();
  if (!data.session) return null;

  const [spaceRes, meRes] = await Promise.all([
    sb.from("spaces")
      .select("id, name, code, is_locked, expires_at, purge_at, max_file_bytes")
      .eq("id", space.id)
      .maybeSingle(),
    sb.from("participants")
      .select("id, pseudo, is_host")
      .eq("space_id", space.id)
      .eq("user_id", data.session.user.id)
      .maybeSingle()
  ]);

  if (spaceRes.error || meRes.error) throw new Error("RESEAU");
  if (!spaceRes.data || !meRes.data) return null;

  Object.assign(space, {
    name: spaceRes.data.name,
    code: spaceRes.data.code,
    isLocked: spaceRes.data.is_locked,
    expiresAt: spaceRes.data.expires_at,
    purgeAt: spaceRes.data.purge_at,
    maxFileBytes: spaceRes.data.max_file_bytes,
    participantId: meRes.data.id,
    pseudo: meRes.data.pseudo,
    isHost: meRes.data.is_host
  });
  setSpace(space);
  return space;
}
