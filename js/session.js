// Session + appartenance aux espaces. Tant qu'on ne s'est pas connecté,
// l'appareil a un utilisateur anonyme Supabase. Connecté (email + code, sans
// mot de passe), il partage le compte de cette adresse : les mêmes espaces,
// envois et blazes sur tous ses appareils.

import { sb, q, invoke, requireClient } from "./db.js?v=93";

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
    access: s.access || "code",
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
  // code faux : renvoyé et non levé, pour que le serveur garde la trace
  // de l'essai (limite anti-énumération des codes)
  if (s && s.error) throw new Error(s.error);
  const space = toSpace(s, pseudo);
  setSpace(space);
  return space;
}

// ------------------------------------------------ invitations par email
// Le lien d'invitation (/i/<jeton>) ne suffit pas : il faut aussi le
// code reçu à l'adresse invitée, sauf sur un appareil qui l'a déjà vérifiée.

export async function inviteInfo(token) {
  await ensureAuth();
  return invoke("invite", { action: "info", token });
}

export function inviteSendCode(token) {
  return invoke("invite", { action: "send-code", token });
}

export async function acceptInvite(token, code, pseudo) {
  const s = await invoke("invite", { action: "accept", token, code, pseudo });
  // l'adresse invitée est prouvée : l'appareil passe sur son compte
  await openAccountSession(s.account && s.account.token_hash);
  const space = toSpace(s, s.pseudo);
  setSpace(space);
  await syncSpaces();
  return space;
}

// ------------------------------------------------------------- compte

// Adresse du compte connecté sur cet appareil, lue dans la session gardée
// par Supabase (sans charger quoi que ce soit). null = pas connecté.
export function accountEmail() {
  try {
    const s = JSON.parse(localStorage.getItem("seminaire.auth") || "null");
    return (s && s.user && s.user.email) || null;
  } catch (err) {
    return null;
  }
}

async function openAccountSession(tokenHash) {
  if (tokenHash) {
    const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (error) throw new Error("CONNEXION_ECHEC");
  } else {
    // l'appareil est devenu le compte : on relit la session (adresse posée)
    await sb.auth.refreshSession();
  }
}

// Se connecter au compte de `email` (vérifiée sur cet appareil, ou avec le
// code reçu). Les espaces de l'appareil rejoignent le compte.
export async function login(email, code) {
  await ensureAuth();
  const r = await invoke("account", { action: "login", email, code: code || null });
  await openAccountSession(r.token_hash);
  await syncSpaces();
  return r.email;
}

// Se déconnecter de CET appareil : rien n'est supprimé, tout revient en se
// reconnectant.
export async function logout() {
  await sb.auth.signOut();
  write(KNOWN_KEY, []);
  try { localStorage.removeItem(SPACE_KEY); } catch (err) { /* privé */ }
}

// "Mes espaces" = ceux du compte, lus sur le serveur (l'ordre local, les
// plus récents d'abord, est conservé).
export async function syncSpaces() {
  if (!sb || !accountEmail()) return knownSpaces();
  const uid = await currentUserId();
  if (!uid) return knownSpaces();
  const { data, error } = await sb.from("participants")
    .select("id, pseudo, is_host, space:spaces(id, name, code, mode)")
    .eq("user_id", uid);
  if (error) return knownSpaces();
  const order = knownSpaces().map((k) => k.id);
  const rank = (id) => (order.indexOf(id) === -1 ? 999 : order.indexOf(id));
  const list = (data || []).filter((p) => p.space)
    .map((p) => ({ id: p.space.id, name: p.space.name, code: p.space.code, mode: p.space.mode, isHost: !!p.is_host }))
    .sort((a, b) => rank(a.id) - rank(b.id));
  write(KNOWN_KEY, list.slice(0, 50));
  const current = getSpace();
  if (current && !list.some((s) => s.id === current.id)) {
    try { localStorage.removeItem(SPACE_KEY); } catch (err) { /* privé */ }
  }
  return list;
}

// ----------------------------------------------------- changer de blaze

// Dans l'espace donné, pour cet appareil. Blaze déjà pris : PSEUDO_PRIS.
export async function renameMe(spaceId, pseudo) {
  const clean = String(pseudo || "").trim();
  if (clean.length < 2 || clean.length > 24) throw new Error("PSEUDO_INVALIDE");
  const uid = await currentUserId();
  if (!uid) throw new Error("NON_AUTHENTIFIE");
  try {
    await q(sb.from("participants").update({ pseudo: clean }).eq("space_id", spaceId).eq("user_id", uid).select("id").single());
  } catch (err) {
    throw new Error(err.code === "23505" ? "PSEUDO_PRIS" : err.message);
  }
  const current = getSpace();
  if (current && current.id === spaceId) write(SPACE_KEY, Object.assign(current, { pseudo: clean }));
  return clean;
}

// Renommer un espace connu de cet appareil (host), dans la liste locale aussi.
export async function renameSpace(spaceId, name) {
  await q(sb.from("spaces").update({ name }).eq("id", spaceId).select("id").single());
  write(KNOWN_KEY, knownSpaces().map((k) => (k.id === spaceId ? Object.assign(k, { name }) : k)));
  const current = getSpace();
  if (current && current.id === spaceId) write(SPACE_KEY, Object.assign(current, { name }));
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
      .select("id, name, code, mode, access, is_locked, expires_at, purge_at, max_file_bytes")
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
    access: spaceRes.data.access,
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
