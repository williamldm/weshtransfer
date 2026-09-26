// Accès aux données. Toutes les requêtes de l'appli passent par ici : les
// vues ne connaissent ni PostgREST ni le Storage.

import { sb, q, invoke, requireClient } from "./db.js?v=82";

// Toute requête passe par ici : sans config, message clair plutôt
// qu'un "Cannot read properties of null".
const db = () => requireClient();

// ------------------------------------------------------------- projets

export function listProjects(spaceId) {
  return q(db().from("projects")
    .select("id, title, bpm, musical_key, last_activity_at, created_at, created_by, creator:participants(pseudo), files(id, kind, status, version_no, approved_at, original_name, mime_type, uploaded_by, duration_sec, label, created_at)")
    .eq("space_id", spaceId)
    .eq("archived", false)
    .order("last_activity_at", { ascending: false }));
}

export function getProject(id) {
  return q(db().from("projects")
    .select(`id, space_id, title, notes, bpm, musical_key, created_at, last_activity_at, created_by,
      creator:participants(pseudo),
      files(id, version_no, label, kind, status, storage_path, original_name, mime_type,
            size_bytes, duration_sec, bpm, musical_key, peaks, created_at, uploaded_by,
            approved_at, approved_by, approved_on_behalf, changelog,
            uploader:participants(id, pseudo), comments(id, parent_id, resolved_at, resolved_in, verified_at))`)
    .eq("id", id)
    .order("version_no", { referencedTable: "files", ascending: false })
    .maybeSingle());
}

export async function createProject(spaceId, title) {
  return q(db().from("projects")
    .insert({ space_id: spaceId, title: title.trim().slice(0, 80) })
    .select("id, title")
    .single());
}

export function updateProject(id, patch) {
  return q(db().from("projects").update(patch).eq("id", id).select("id").single());
}

export function deleteProject(id) {
  return q(db().from("projects").delete().eq("id", id));
}

// ------------------------------------------------------------ fichiers

export function getFile(id) {
  return q(db().from("files")
    .select(`id, space_id, project_id, version_no, label, kind, status, storage_path,
      original_name, mime_type, size_bytes, duration_sec, bpm, musical_key, peaks,
      created_at, uploaded_by, approved_at, approved_by, approved_on_behalf, changelog,
      uploader:participants(id, pseudo),
      project:projects(id, title, files(id, version_no, label, kind, status, storage_path,
        original_name, mime_type, duration_sec, approved_at, uploaded_by))`)
    .eq("id", id)
    .maybeSingle());
}

const COMMENT_COLS = "id, file_id, parent_id, body, at_ms, tag, created_at, resolved_at, resolved_by, resolved_in, resolution_note, verified_at, verified_by, author_id, author:participants(id, pseudo)";

export function listComments(fileId) {
  return q(db().from("comments")
    .select(COMMENT_COLS)
    .eq("file_id", fileId)
    .order("created_at", { ascending: true }));
}

// Retours de toutes les versions d'un morceau (pour suivre sur la v3 ce
// qui a été demandé sur la v2).
export function listCommentsOf(fileIds) {
  if (!fileIds.length) return Promise.resolve([]);
  return q(db().from("comments")
    .select(COMMENT_COLS)
    .in("file_id", fileIds)
    .order("at_ms", { ascending: true, nullsFirst: false }));
}

// Retours (hors réponses) de tout l'espace, pour les statuts de l'accueil.
export function listReviewComments(spaceId) {
  return q(db().from("comments")
    .select("id, file_id, resolved_at, verified_at")
    .eq("space_id", spaceId)
    .is("parent_id", null));
}

// L'ingé coche "corrigé" : dans quelle version (fileId), avec quelle note.
export function setCommentResolved(id, resolved, fileId, note) {
  return q(db().rpc("set_comment_resolved", {
    p_comment: id, p_resolved: !!resolved, p_file: fileId || null, p_note: note || null
  }));
}

// L'artiste confirme une correction, ou la rouvre en expliquant.
export function setCommentVerified(id, ok, reason) {
  return q(db().rpc("set_comment_verified", { p_comment: id, p_ok: !!ok, p_reason: reason || null }));
}

// Email à l'ingé quand l'artiste a fait ses retours
export function reviewNotifyStatus(spaceId) {
  return invoke("review-digest", { action: "status", space_id: spaceId });
}
export function reviewSubscribe(spaceId, email) {
  return invoke("review-digest", { action: "subscribe", space_id: spaceId, email });
}
export function reviewUnsubscribe(spaceId) {
  return invoke("review-digest", { action: "unsubscribe", space_id: spaceId });
}
export function reviewFlush(spaceId) {
  return invoke("review-digest", { action: "flush", space_id: spaceId });
}

// Pochette d'un espace de retours (data URL JPEG, une ligne par espace)
// Album d'un Verdict : pochette et titre (une ligne par espace, chacun
// facultatif)
export function getAlbum(spaceId) {
  return q(db().from("space_covers").select("image, title").eq("space_id", spaceId).maybeSingle())
    .then((r) => ({ image: (r && r.image) || null, title: (r && r.title) || null }));
}
export function saveCover(spaceId, image) {
  return q(db().from("space_covers").upsert({ space_id: spaceId, image, updated_at: new Date().toISOString() }));
}
export function removeCover(spaceId) {
  return q(db().from("space_covers").update({ image: null, updated_at: new Date().toISOString() }).eq("space_id", spaceId));
}
export function saveAlbumTitle(spaceId, title) {
  return q(db().from("space_covers").upsert({ space_id: spaceId, title: title || null, updated_at: new Date().toISOString() }));
}

export function isEngineer(projectId) {
  return q(db().rpc("is_engineer", { p_project: projectId }));
}

export function setFileApproved(id, approved) {
  return q(db().rpc("set_file_approved", { p_file: id, p_approved: !!approved }));
}

export function addComment(fileId, body, atMs, extra) {
  const e = extra || {};
  return q(db().from("comments")
    .insert({ file_id: fileId, body: body.trim().slice(0, 1000), at_ms: atMs, tag: e.tag || null, parent_id: e.parentId || null })
    .select("id")
    .single());
}

export function deleteComment(id) {
  return q(db().from("comments").delete().eq("id", id));
}

export function insertFile(row) {
  return q(db().from("files").insert(row).select("id, version_no, project_id").single());
}

export function updateFile(id, patch) {
  return q(db().from("files").update(patch).eq("id", id).select("id").single());
}

export function getFilesByIds(ids) {
  if (!ids.length) return Promise.resolve([]);
  return q(db().from("files")
    .select("id, version_no, label, kind, status, original_name, mime_type, size_bytes, duration_sec, project:projects(id, title)")
    .in("id", ids));
}

// --------------------------------------------------------- participants

export function listParticipants(spaceId) {
  return q(db().from("participants")
    .select("id, pseudo, is_host, joined_at, last_seen_at")
    .eq("space_id", spaceId)
    .order("joined_at", { ascending: true }));
}

export function updateSpace(id, patch) {
  return q(db().from("spaces").update(patch).eq("id", id)
    .select("id, name, access, is_locked, expires_at, purge_at").single());
}

// ----------------------------------------------------------- invitations

export function inviteByEmail(spaceId, emails) {
  return invoke("invite", { action: "create", space_id: spaceId, emails });
}

export function listInvites(spaceId) {
  return q(db().from("space_invites")
    .select("id, email, created_at, expires_at, accepted_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false }));
}

export function deleteInvite(id) {
  return q(db().from("space_invites").delete().eq("id", id));
}

// ---------------------------------------------------------- stockage
// Tout passe par l'Edge Function storage, qui signe selon l'endroit où vit
// chaque fichier (Storage Supabase ou Backblaze B2). Cache par fichier :
// les vues pré-signent ce qu'elles affichent, pour que le tap sur
// "lecture" lance le son sans attendre le réseau (iOS refuse play() hors
// du geste de l'utilisateur).

const urlCache = new Map();   // fileId -> { url, download, exp }

function fresh(fileId) {
  const hit = urlCache.get(fileId);
  return hit && hit.exp - Date.now() > 10 * 60 * 1000 ? hit : null;
}

export function cachedUrl(fileId) {
  const hit = fresh(fileId);
  return hit ? hit.url : null;
}

export function cachedDownload(fileId) {
  const hit = fresh(fileId);
  return hit ? hit.download : null;
}

export async function signFiles(fileIds) {
  const missing = [...new Set(fileIds)].filter((id) => id && !fresh(id));
  for (let i = 0; i < missing.length; i += 200) {
    const res = await invoke("storage", { action: "sign", file_ids: missing.slice(i, i + 200) });
    const exp = Date.now() + ((res && res.ttl) || 3600) * 1000;
    for (const [id, u] of Object.entries((res && res.urls) || {})) {
      urlCache.set(id, { url: u.url, download: u.download_url, exp });
    }
  }
  const out = {};
  for (const id of fileIds) out[id] = cachedUrl(id);
  return out;
}

// Suppression côté serveur : la RLS décide (auteur ou host), puis le
// fichier est réellement effacé du stockage, quel qu'il soit.
export function deleteFile(file) {
  return invoke("storage", { action: "delete", file_id: file.id });
}

// Efface un espace entier, fichiers compris (host uniquement).
export function deleteSpace(spaceId) {
  return invoke("storage", { action: "delete-space", space_id: spaceId });
}

export function storageCall(action, params) {
  return invoke("storage", Object.assign({ action }, params || {}));
}

let storageConf = null;
export function storageConfig() {
  if (!storageConf) {
    storageConf = storageCall("config")
      .catch(() => ({ backend: "supabase" }));
  }
  return storageConf;
}

// --------------------------------------------------------------- envois

export function createTransfer(params) {
  return q(db().rpc("create_transfer", {
    p_space: params.spaceId,
    p_title: params.title,
    p_file_ids: params.fileIds,
    p_emails: params.emails,
    p_message: params.message || null,
    p_reply_to: params.replyTo || null,
    p_days: params.days,
    p_notify: true
  }));
}

export function sendTransfer(transferId, retry) {
  return invoke("send-transfer", { transfer_id: transferId, retry: !!retry });
}

// Vérification de l'email de l'expéditeur (code à 6 chiffres), une fois
// par appareil et par adresse. Le serveur fait foi ; la liste locale évite
// juste un aller-retour.
const VERIFIED_KEY = "seminaire.verifiedEmails";

function verifiedLocal() {
  try { return JSON.parse(localStorage.getItem(VERIFIED_KEY) || "[]"); } catch (err) { return []; }
}

function rememberVerified(email) {
  const list = verifiedLocal().filter((e) => e !== email);
  list.unshift(email);
  try { localStorage.setItem(VERIFIED_KEY, JSON.stringify(list.slice(0, 10))); } catch (err) { /* privé */ }
}

export async function emailVerified(email) {
  const r = await invoke("verify-email", { action: "status", email });
  if (r && r.verified) rememberVerified(email);
  return !!(r && r.verified);
}

export function knownVerified(email) {
  return verifiedLocal().includes(email);
}

export function requestEmailCode(email) {
  return invoke("verify-email", { action: "request", email });
}

export async function confirmEmailCode(email, code) {
  const r = await invoke("verify-email", { action: "confirm", email, code });
  if (r && r.verified) rememberVerified(email);
  return !!(r && r.verified);
}

// Carnet des destinataires, rattaché à l'email d'expédition. Le serveur
// fait foi (il suit l'adresse d'un appareil à l'autre) et n'ouvre le
// carnet qu'à qui a prouvé l'adresse ; une copie locale, par adresse
// d'expédition, garde aussi ce qui a été tapé ici même si l'email n'est
// pas (encore) vérifié ou si l'envoi a échoué.
const BOOK_KEY = "seminaire.contacts";

function localBook() {
  try { return JSON.parse(localStorage.getItem(BOOK_KEY) || "{}") || {}; } catch (err) { return {}; }
}
function saveBook(book) {
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(book)); } catch (err) { /* privé */ }
}

export function rememberContactsLocal(sender, emails) {
  if (!sender || !emails.length) return;
  const book = localBook();
  const now = new Date().toISOString();
  const list = (book[sender] || []).filter((r) => !emails.includes(r.email));
  book[sender] = emails.filter((e) => e !== sender).map((email) => ({ email, last_at: now })).concat(list).slice(0, 60);
  saveBook(book);
}

export async function listContacts(sender) {
  const local = localBook()[sender] || [];
  let remote = [];
  try {
    const r = await invoke("contacts", { action: "list", sender });
    remote = (r && r.contacts) || [];
    rememberVerified(sender);   // le serveur a ouvert le carnet : adresse prouvée
  } catch (err) {
    if (!/EMAIL_NON_VERIFIE/.test(String(err && err.message))) throw err;
  }
  // fusion : la date la plus récente l'emporte
  const byEmail = new Map();
  for (const r of remote.concat(local)) {
    const prev = byEmail.get(r.email);
    if (!prev || String(r.last_at) > String(prev.last_at)) byEmail.set(r.email, { email: r.email, last_at: r.last_at });
  }
  return [...byEmail.values()].sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
}

export function forgetContact(sender, email) {
  const book = localBook();
  if (book[sender]) { book[sender] = book[sender].filter((r) => r.email !== email); saveBook(book); }
  return invoke("contacts", { action: "forget", sender, email }).catch((err) => {
    if (!/EMAIL_NON_VERIFIE/.test(String(err && err.message))) throw err;
  });
}

let emailCheck = null;
export function emailEnabled() {
  if (!sb) return Promise.resolve(false);
  if (!emailCheck) {
    emailCheck = invoke("send-transfer", { check: true })
      .then((r) => !!(r && r.email_enabled))
      .catch(() => false);
  }
  return emailCheck;
}

const TRANSFER_COLS = `id, title, message, token, expires_at, created_at, download_count, sender_id, reply_to,
  sender:participants(pseudo),
  transfer_files(position, file:files(id, original_name, size_bytes, kind)),
  transfer_recipients(id, email, token, status, error, sent_at, first_opened_at, first_download_at)`;

export function listTransfers(spaceId) {
  return q(db().from("transfers")
    .select(TRANSFER_COLS)
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false }));
}

export function getTransfer(id) {
  return q(db().from("transfers").select(TRANSFER_COLS).eq("id", id).maybeSingle());
}

// Fichiers encore utilisés par un envoi (après suppression d'un autre).
export function listTransferRefs(fileIds) {
  return q(db().from("transfer_files").select("file_id").in("file_id", fileIds));
}

export function revokeTransfer(id) {
  return q(db().from("transfers").update({ expires_at: new Date().toISOString() }).eq("id", id).select("id").single());
}

export function deleteTransfer(id) {
  return q(db().from("transfers").delete().eq("id", id));
}

// Lien public, construit à partir de l'adresse courante : fonctionne aussi
// si le site est hébergé dans un sous-dossier.
// lien court : weshtransfer.fr/t/<jeton>
export function transferUrl(token) {
  return location.origin + "/t/" + token;
}
