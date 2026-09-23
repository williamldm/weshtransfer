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

import { admin, asUser, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import {
  abortMultipart, b2Config, completeMultipart, createMultipart, deletePrefix,
  listParts, presignGet, presignPart,
} from "../_shared/b2.ts";

const PART_SIZE = 16 * 1024 * 1024;   // compromis 4G : une partie ratée coûte peu à renvoyer
const GET_TTL = 6 * 3600;
const PUT_TTL = 2 * 3600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXT = ["mp3", "wav", "aif", "aiff", "m4a", "flac", "ogg", "zip"];
const KEY = /^spaces\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.([a-z0-9]{2,5})$/;

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
        const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
        if (!UUID.test(projectId) || !UUID.test(fileId)) return json({ error: "REQUETE_INVALIDE" }, 400);
        if (!EXT.includes(ext)) return json({ error: "FORMAT_REFUSE" }, 400);
        if (!(size > 0)) return json({ error: "FICHIER_VIDE" }, 400);

        const { data: project } = await db.from("projects")
          .select("id, space_id, space:spaces(max_file_bytes)")
          .eq("id", projectId).maybeSingle();
        if (!project) return json({ error: "NON_MEMBRE" }, 403);
        const max = (project as unknown as { space: { max_file_bytes: number } }).space?.max_file_bytes ?? 0;
        if (max && size > max) return json({ error: "TROP_LOURD" }, 413);

        // Un identifiant déjà pris = tentative d'écraser le son de quelqu'un.
        const { data: taken } = await db.from("files").select("id").eq("id", fileId).maybeSingle();
        if (taken) return json({ error: "FICHIER_EXISTANT" }, 409);

        const key = `spaces/${project.space_id}/${projectId}/${fileId}.${ext}`;
        const contentType = String(body.content_type ?? "") || "application/octet-stream";
        const uploadId = await createMultipart(b2, key, contentType);
        return json({ backend: "b2", key, upload_id: uploadId, part_size: PART_SIZE });
      }

      const key = await memberOfKey(body.key);
      const uploadId = String(body.upload_id ?? "");
      if (!key || !uploadId) return json({ error: "NON_MEMBRE" }, 403);

      if (action === "upload-parts") {
        const parts = (Array.isArray(body.parts) ? body.parts : [])
          .map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10000).slice(0, 100);
        const urls: Record<number, string> = {};
        for (const n of parts) urls[n] = await presignPart(b2, key, uploadId, n, PUT_TTL);
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
        const size = await completeMultipart(b2, key, uploadId);
        return json({ ok: true, size });
      }

      if (action === "upload-abort") {
        await abortMultipart(b2, key, uploadId);
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

    return json({ error: "ACTION_INCONNUE" }, 400);
  } catch (err) {
    return json({ error: "ERREUR_STOCKAGE", detail: (err as Error).message.slice(0, 300) }, 502);
  }
});
