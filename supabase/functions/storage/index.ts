// Point de passage unique pour les fichiers : upload vers B2, URLs de
// lecture signées, suppression. Les octets ne transitent jamais par ici :
// le navigateur parle directement à B2 avec des URLs signées.
//
// Les droits sont vérifiés avec la session de l'appelant (asUser) : mêmes
// règles RLS que dans le navigateur, aucune règle dupliquée ici.
//
// POST { action: "config" }
// POST { action: "upload-init", project_id, file_id, file_name, size, content_type }
// POST { action: "upload-parts", key, upload_id, parts: [1, 2, ...] }
// POST { action: "upload-status", key, upload_id }
// POST { action: "upload-complete", key, upload_id }
// POST { action: "upload-abort", key, upload_id }
// POST { action: "sign", file_ids: [...] }
// POST { action: "delete", file_id }
// POST { action: "delete-space", space_id }   (host uniquement)

import { admin, asUser, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import {
  abortMultipart, b2Config, completeMultipart, createMultipart, deletePrefix,
  listParts, presignGet, presignPart,
} from "../_shared/b2.ts";
import { wipeSpace } from "../_shared/wipe.ts";

const PART_SIZE = 16 * 1024 * 1024;
const FILE_MAX = 2 * 1024 ** 3;   // 2 Go par fichier, quel que soit l'espace   // compromis 4G : une partie ratée coûte peu à renvoyer
const GET_TTL = 6 * 3600;
const PUT_TTL = 2 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Tout est accepté sauf ce qui s'exécute (même liste que js/files.js).
const BLOCKED = ["exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "msc",
  "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "ps1", "psm1", "reg", "lnk",
  "jar", "apk", "app", "dmg", "pkg", "sh", "command"];
const KEY = /^spaces\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z0-9]{1,10})$/;

// Quotas (surchargeables par secrets, en Go). Un site sans compte : chaque
// limite existe par appareil ET par IP, plus un disjoncteur global.
const GB = 1024 ** 3;
const env = (name: string, fallback: number) => Number(Deno.env.get(name) || fallback) * GB;
const LIMITS = {
  userDay: env("UPLOAD_USER_DAY_GB", 3),       // par appareil, sur 24 h
  ipDay: env("UPLOAD_IP_DAY_GB", 3),           // par IP, sur 24 h (3 Go)
  space: env("SPACE_MAX_GB", 50),              // par espace, au total
  globalDay: env("UPLOAD_GLOBAL_DAY_GB", 200), // tout le site, sur 24 h
  open: 12,                                    // uploads ouverts en même temps
};

// Type servi par B2 décidé ici, jamais par le client : un .html déposé
// ne doit pas s'ouvrir comme une page (phishing hébergé sur nos liens).
const SAFE_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", m4a: "audio/mp4",
  flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", heic: "image/heic",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain; charset=utf-8",
};

async function ipHash(req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || "inconnue";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wt:" + ip));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Session = { id: string; declared_bytes: number; completed_at: string | null };

type FileRow = { id: string; storage_path: string; backend: string; original_name: string };

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const service = admin();
  const uid = await callerId(req, service);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);

  const db = asUser(req);
  const b2 = b2Config();
  const body = await readJson(req);
  const action = String(body.action ?? "");

  // Le chemin encode l'espace : l'appelant doit en être membre.
  const memberOfKey = async (key: unknown): Promise<string | null> => {
    const m = KEY.exec(String(key ?? ""));
    if (!m) return null;
    const { data } = await db.from("spaces").select("id").eq("id", m[1]).maybeSingle();
    return data ? String(key) : null;
  };

  try {
    // ------------------------------------------------------------ config
    if (action === "config") {
      return json({ backend: b2 ? "b2" : "supabase", part_size: PART_SIZE });
    }

    // ------------------------------------------------------ upload B2
    if (action.startsWith("upload-")) {
      if (!b2) return json({ error: "B2_NON_CONFIGURE" }, 503);

      if (action === "upload-init") {
        const projectId = String(body.project_id ?? "");
        const fileId = String(body.file_id ?? "");
        const name = String(body.file_name ?? "");
        const size = Number(body.size ?? 0);
        // sans extension exploitable : .bin (le nom d'origine reste en base)
        const ext = (/\.([a-z0-9]{1,10})$/i.exec(name)?.[1] ?? "bin").toLowerCase();
        if (!UUID.test(projectId) || !UUID.test(fileId)) return json({ error: "REQUETE_INVALIDE" }, 400);
        if (BLOCKED.includes(ext)) return json({ error: "FORMAT_REFUSE" }, 400);
        if (!(size > 0)) return json({ error: "FICHIER_VIDE" }, 400);
        if (!Number.isSafeInteger(size)) return json({ error: "REQUETE_INVALIDE" }, 400);

        const { data: project } = await db.from("projects")
          .select("id, space_id, space:spaces(max_file_bytes)")
          .eq("id", projectId).maybeSingle();
        if (!project) return json({ error: "NON_MEMBRE" }, 403);
        const spaceMax = (project as unknown as { space: { max_file_bytes: number } }).space?.max_file_bytes ?? 0;
        const max = spaceMax ? Math.min(spaceMax, FILE_MAX) : FILE_MAX;
        if (size > max) return json({ error: "TROP_LOURD" }, 413);

        // Un identifiant déjà pris = tentative d'écraser le son de quelqu'un.
        const { data: taken } = await db.from("files").select("id").eq("id", fileId).maybeSingle();
        if (taken) return json({ error: "FICHIER_EXISTANT" }, 409);

        const ip = await ipHash(req);
        const { data: budget, error: budgetError } = await service.rpc("upload_budget", {
          p_user: uid, p_ip: ip, p_space: project.space_id,
        });
        if (budgetError) return json({ error: "ERREUR_BASE", detail: budgetError.message }, 500);
        const b = budget as { user_day: number; ip_day: number; global_day: number; open: number; space: number };
        if (b.open >= LIMITS.open) return json({ error: "TROP_D_UPLOADS" }, 429);
        if (b.global_day + size > LIMITS.globalDay) return json({ error: "QUOTA_GLOBAL" }, 429);
        if (b.user_day + size > LIMITS.userDay || b.ip_day + size > LIMITS.ipDay) {
          // ce qu'il reste sur 24 h, pour un message précis
          const left = Math.max(0, Math.min(LIMITS.userDay - b.user_day, LIMITS.ipDay - b.ip_day));
          return json({ error: "QUOTA_UPLOAD_JOUR", left }, 429);
        }
        if (b.space + size > LIMITS.space) return json({ error: "QUOTA_ESPACE" }, 413);

        const key = `spaces/${project.space_id}/${projectId}/${fileId}.${ext}`;
        const uploadId = await createMultipart(b2, key, SAFE_TYPES[ext] ?? "application/octet-stream");
        const { error: sessionError } = await service.from("upload_sessions").insert({
          user_id: uid, space_id: project.space_id, storage_path: key, upload_id: uploadId,
          declared_bytes: size, ip_hash: ip,
        });
        if (sessionError) {
          await abortMultipart(b2, key, uploadId);
          return json({ error: "FICHIER_EXISTANT" }, 409);
        }
        return json({ backend: "b2", key, upload_id: uploadId, part_size: PART_SIZE });
      }

      const key = await memberOfKey(body.key);
      const uploadId = String(body.upload_id ?? "");
      if (!key || !uploadId) return json({ error: "NON_MEMBRE" }, 403);

      // L'upload doit avoir été ouvert par CET appareil, ici même.
      const { data: session } = await service.from("upload_sessions")
        .select("id, declared_bytes, completed_at")
        .eq("storage_path", key).eq("upload_id", uploadId).eq("user_id", uid)
        .maybeSingle<Session>();
      if (!session) return json({ error: "UPLOAD_INCONNU" }, 404);
      if (session.completed_at && action !== "upload-complete") return json({ error: "UPLOAD_INCONNU" }, 404);

      const partCount = Math.ceil(session.declared_bytes / PART_SIZE);
      const partLength = (n: number) =>
        n < partCount ? PART_SIZE : session.declared_bytes - PART_SIZE * (partCount - 1);

      if (action === "upload-parts") {
        const parts = (Array.isArray(body.parts) ? body.parts : [])
          .map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= partCount).slice(0, 100);
        const urls: Record<number, string> = {};
        for (const n of parts) urls[n] = await presignPart(b2, key, uploadId, n, PUT_TTL, partLength(n));
        return json({ urls });
      }

      if (action === "upload-status") {
        try {
          const parts = await listParts(b2, key, uploadId);
          return json({ parts: parts.map((p) => ({ part: p.part, size: p.size })) });
        } catch {
          // upload expiré ou déjà terminé : le client repart de zéro
          return json({ error: "UPLOAD_INCONNU" }, 404);
        }
      }

      if (action === "upload-complete") {
        if (session.completed_at) return json({ ok: true, size: session.declared_bytes });
        // Toutes les parties, et rien de plus : sinon on annule tout.
        const parts = await listParts(b2, key, uploadId);
        const received = parts.reduce((s, p) => s + p.size, 0);
        const complete = parts.length === partCount
          && parts.every((p, i) => p.part === i + 1 && p.size === partLength(p.part));
        if (!complete || received !== session.declared_bytes) {
          await abortMultipart(b2, key, uploadId);
          await service.from("upload_sessions").delete().eq("id", session.id);
          return json({ error: "TAILLE_INCOHERENTE" }, 400);
        }
        const size = await completeMultipart(b2, key, uploadId);
        await service.from("upload_sessions")
          .update({ completed_at: new Date().toISOString(), size_bytes: size }).eq("id", session.id);
        return json({ ok: true, size });
      }

      if (action === "upload-abort") {
        await abortMultipart(b2, key, uploadId);
        await service.from("upload_sessions").delete().eq("id", session.id).is("completed_at", null);
        return json({ ok: true });
      }

      return json({ error: "ACTION_INCONNUE" }, 400);
    }

    // ------------------------------------------------- URLs de lecture
    if (action === "sign") {
      const ids = (Array.isArray(body.file_ids) ? body.file_ids : [])
        .map(String).filter((id) => UUID.test(id)).slice(0, 200);
      if (!ids.length) return json({ urls: {} });

      // RLS : seuls les fichiers des espaces de l'appelant reviennent.
      const { data: files, error } = await db.from("files")
        .select("id, storage_path, backend, original_name").in("id", ids);
      if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);

      const urls: Record<string, { url: string; download_url: string }> = {};
      const onSupabase = (files as FileRow[]).filter((f) => f.backend !== "b2");
      const onB2 = (files as FileRow[]).filter((f) => f.backend === "b2");

      if (onSupabase.length) {
        const { data } = await service.storage.from("seminar")
          .createSignedUrls(onSupabase.map((f) => f.storage_path), GET_TTL);
        const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
        for (const f of onSupabase) {
          const url = byPath.get(f.storage_path);
          if (url) urls[f.id] = { url, download_url: `${url}&download=${encodeURIComponent(f.original_name)}` };
        }
      }
      if (onB2.length) {
        if (!b2) return json({ error: "B2_NON_CONFIGURE" }, 503);
        await Promise.all(onB2.map(async (f) => {
          urls[f.id] = {
            url: await presignGet(b2, f.storage_path, GET_TTL),
            download_url: await presignGet(b2, f.storage_path, GET_TTL, f.original_name),
          };
        }));
      }
      return json({ urls, ttl: GET_TTL });
    }

    // ------------------------------------------------------ suppression
    if (action === "delete") {
      const fileId = String(body.file_id ?? "");
      if (!UUID.test(fileId)) return json({ error: "REQUETE_INVALIDE" }, 400);

      // C'est la RLS qui décide (auteur ou host) : si la ligne ne part pas,
      // l'appelant n'avait pas le droit, et on ne touche pas au fichier.
      const { data: gone } = await db.from("files").delete().eq("id", fileId)
        .select("id, storage_path, backend");
      const row = (gone as FileRow[] | null)?.[0];
      if (!row) return json({ error: "SUPPRESSION_REFUSEE" }, 403);

      if (row.backend === "b2") {
        if (b2) await deletePrefix(b2, row.storage_path);
      } else {
        await service.storage.from("seminar").remove([row.storage_path]);
      }
      return json({ ok: true });
    }

    // ---------------------------------------- suppression d'un espace
    if (action === "delete-space") {
      const spaceId = String(body.space_id ?? "");
      if (!UUID.test(spaceId)) return json({ error: "REQUETE_INVALIDE" }, 400);
      // seul le host : vérifié avec la session de l'appelant
      const { data: me } = await db.from("participants")
        .select("id, is_host").eq("space_id", spaceId).eq("user_id", uid).maybeSingle();
      if (!me || !me.is_host) return json({ error: "SEUL_LE_HOST" }, 403);
      const files = await wipeSpace(service, spaceId);
      return json({ ok: true, files });
    }

    return json({ error: "ACTION_INCONNUE" }, 400);
  } catch (err) {
    return json({ error: "ERREUR_STOCKAGE", detail: (err as Error).message.slice(0, 300) }, 502);
  }
});
