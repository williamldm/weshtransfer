// Accès aux données. Toutes les requêtes de l'appli passent par ici : les
// vues ne connaissent ni PostgREST ni le Storage.

import { sb, q, invoke, BUCKET, requireClient } from "./db.js?v=2";

// Toute requête passe par ici : sans config, message clair plutôt
// qu'un "Cannot read properties of null".
const db = () => requireClient();

// ------------------------------------------------------------- projets

export function listProjects(spaceId) {
  return q(db().from("projects")
    .select("id, title, bpm, musical_key, last_activity_at, created_at, creator:participants(pseudo), files(id, kind, status)")
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
            uploader:participants(id, pseudo), comments(count))`)
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
      created_at, uploaded_by,
      uploader:participants(id, pseudo),
      project:projects(id, title, files(id, version_no, label, kind, status))`)
    .eq("id", id)
    .maybeSingle());
}

export function listComments(fileId) {
  return q(db().from("comments")
    .select("id, body, at_ms, created_at, author_id, author:participants(id, pseudo)")
    .eq("file_id", fileId)
    .order("created_at", { ascending: true }));
}

export function addComment(fileId, body, atMs) {
  return q(db().from("comments")
    .insert({ file_id: fileId, body: body.trim().slice(0, 1000), at_ms: atMs })
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

export async function deleteFile(file) {
  await q(db().from("files").delete().eq("id", file.id));
  // Si ça échoue (fichier d'un autre, supprimé par le host), l'objet
  // restera jusqu'à la purge de l'espace : pas bloquant.
  await db().storage.from(BUCKET).remove([file.storage_path]);
}

// Tous les fichiers de l'espace, pour le sélecteur d'envoi.
export function listSpaceFiles(spaceId) {
  return q(db().from("projects")
    .select("id, title, last_activity_at, files(id, version_no, label, kind, status, original_name, size_bytes, duration_sec)")
    .eq("space_id", spaceId)
    .eq("archived", false)
    .order("last_activity_at", { ascending: false })
    .order("version_no", { referencedTable: "files", ascending: false }));
}

export function getFilesByIds(ids) {
  if (!ids.length) return Promise.resolve([]);
  return q(db().from("files")
    .select("id, version_no, label, kind, status, original_name, size_bytes, duration_sec, project:projects(id, title)")
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
    .select("id, name, is_locked, expires_at, purge_at").single());
}

// ------------------------------------------------------- URLs signées
// Cache par chemin : une URL signée vaut 2 h. Les vues pré-signent tout ce
// qu'elles affichent, pour que le tap sur "lecture" lance le son sans
// attendre le réseau (iOS refuse play() hors du geste de l'utilisateur).

const URL_TTL = 7200;
const urlCache = new Map();

export function cachedUrl(path) {
  const hit = urlCache.get(path);
  return hit && hit.exp - Date.now() > 10 * 60 * 1000 ? hit.url : null;
}

export async function signUrls(paths) {
  const missing = [...new Set(paths)].filter((p) => p && !cachedUrl(p));
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100);
    const data = await q(db().storage.from(BUCKET).createSignedUrls(chunk, URL_TTL));
    const exp = Date.now() + URL_TTL * 1000;
    for (const item of data) {
      if (item.signedUrl && !item.error) urlCache.set(item.path, { url: item.signedUrl, exp });
    }
  }
  const out = {};
  for (const p of paths) out[p] = cachedUrl(p);
  return out;
}

export function withDownloadName(url, name) {
  return url + (url.includes("?") ? "&" : "?") + "download=" + encodeURIComponent(name);
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

export function revokeTransfer(id) {
  return q(db().from("transfers").update({ expires_at: new Date().toISOString() }).eq("id", id).select("id").single());
}

export function deleteTransfer(id) {
  return q(db().from("transfers").delete().eq("id", id));
}

// Lien public, construit à partir de l'adresse courante : fonctionne aussi
// si le site est hébergé dans un sous-dossier.
export function transferUrl(token) {
  return new URL("t.html?k=" + token, location.href).href;
}
