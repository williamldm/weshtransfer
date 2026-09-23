// Session anonyme + appartenance à un espace. Aucun compte : l'appareil
// reçoit un utilisateur anonyme Supabase, puis rejoint un espace via son code.

import { sb, q, requireClient } from "./db.js?v=29";

const SPACE_KEY = "seminaire.space";      // espace actif
const KNOWN_KEY = "seminaire.spaces";     // tous les espaces rejoints sur cet appareil

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (err) { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* navigation privée */ }
}

export function getSpace() {
  return read(SPACE_KEY, null);
}

// Espaces connus de cet appareil (un même téléphone peut être dans
// "Envois" et dans "Salon" : on passe de l'un à l'autre sans recode).
export function knownSpaces() {
  return read(KNOWN_KEY, []);
}

function remember(space) {
  const list = knownSpaces().filter((s) => s.id !== space.id);
  list.unshift({ id: space.id, name: space.name, code: space.code, mode: space.mode, isHost: !!space.isHost });
  write(KNOWN_KEY, list.slice(0, 10));
}

function setSpace(space) {
  write(SPACE_KEY, space);
  remember(space);
}

export function switchTo(id) {
  const target = knownSpaces().find((s) => s.id === id);
  if (target) write(SPACE_KEY, target);
  return !!target;
}

// Oublie un espace sur cet appareil (sans rien supprimer côté serveur).
export function forgetSpace(id) {
  write(KNOWN_KEY, knownSpaces().filter((s) => s.id !== id));
  const current = getSpace();
  if (current && current.id === id) {
    try { localStorage.removeItem(SPACE_KEY); } catch (err) { /* privé */ }
  }
}

export function leaveSpace() {
  const current = getSpace();
  if (current) write(KNOWN_KEY, knownSpaces().filter((s) => s.id !== current.id));
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

function toSpace(s, pseudo) {
  return {
    id: s.space_id,
    participantId: s.participant_id,
    name: s.name,
    code: s.code,
    mode: s.mode || "seminaire",
    isHost: s.is_host,
    isLocked: s.is_locked,
    expiresAt: s.expires_at,
    maxFileBytes: s.max_file_bytes,
    pseudo
  };
}

// Crée un espace (salon ou envoi) dont on devient host, et y entre.
export async function createSpace(name, mode, pseudo) {
  await ensureAuth();
  const s = await q(sb.rpc("create_my_space", { p_name: name, p_mode: mode, p_pseudo: pseudo }));
  const space = toSpace(s, pseudo);
  setSpace(space);
  return space;
}

export async function joinSpace(code, pseudo) {
  await ensureAuth();
  const s = await q(sb.rpc("join_space", { p_code: code, p_pseudo: pseudo }));
  const space = {
    id: s.space_id,
    participantId: s.participant_id,
    name: s.name,
    code: s.code,
    mode: s.mode || "seminaire",
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
      .select("id, name, code, mode, is_locked, expires_at, purge_at, max_file_bytes")
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
    mode: spaceRes.data.mode,
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
