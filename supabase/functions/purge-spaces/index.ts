// Purge des espaces dont la date de suppression est passée, des sons
// de séminaire (jam) arrivés à 5 jours, et des fichiers d'envois "jusqu'au
// premier téléchargement" déjà récupérés en entier (files.burned_at).
// Un espace qui abrite encore un tel fichier en attente n'est pas purgé :
// ses autres fichiers sont effacés, lui est repoussé de 7 jours. Appelée toutes les heures par
// pg_cron (via pg_net), qui n'envoie pas de JWT : déployée avec
// --no-verify-jwt, protégée par le secret CRON_SECRET.

import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";
import { wipeSpace } from "../_shared/wipe.ts";
import { b2Config, deletePrefix } from "../_shared/b2.ts";

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("CRON_SECRET") ?? "")) {
    return json({ error: "INTERDIT" }, 403);
  }

  const db = admin();
  const { data: spaces, error } = await db
    .from("spaces")
    .select("id, name")
    .lt("purge_at", new Date().toISOString());
  if (error) return json({ error: error.message }, 500);

  const b2 = b2Config();
  // fichier effacé du stockage puis sa fiche (transfer_files suit en cascade)
  const dropFile = async (f: { id: string; storage_path: string; backend: string }) => {
    if (f.backend === "b2") {
      if (!b2) throw new Error("B2 non configuré");
      await deletePrefix(b2, f.storage_path);
    } else {
      const { error: rmErr } = await db.storage.from("seminar").remove([f.storage_path]);
      if (rmErr) throw new Error(rmErr.message);
    }
    const { error: delErr } = await db.from("files").delete().eq("id", f.id);
    if (delErr) throw new Error(delErr.message);
  };

  // espaces qui gardent un fichier encore attendu
  const due = (spaces ?? []).map((s) => s.id);
  const { data: held } = due.length
    ? await db.rpc("spaces_holding_downloads", { p_spaces: due })
    : { data: [] };
  const keep = new Map<string, Set<string>>();
  for (const h of (held ?? []) as { space_id: string; file_id: string }[]) {
    if (!keep.has(h.space_id)) keep.set(h.space_id, new Set());
    keep.get(h.space_id)!.add(h.file_id);
  }

  const report: { space: string; files: number; ok: boolean; error?: string; kept?: number }[] = [];
  for (const space of spaces ?? []) {
    const kept = keep.get(space.id);
    if (kept) {
      try {
        const { data: others } = await db.from("files").select("id, storage_path, backend").eq("space_id", space.id);
        let n = 0;
        for (const f of (others ?? []) as { id: string; storage_path: string; backend: string }[]) {
          if (kept.has(f.id)) continue;
          await dropFile(f);
          n++;
        }
        const { error: pinErr } = await db.rpc("pin_space_for_downloads", { p_space: space.id });
        if (pinErr) throw new Error(pinErr.message);
        report.push({ space: space.name, files: n, ok: true, kept: kept.size });
      } catch (err) {
        report.push({ space: space.name, files: 0, ok: false, error: (err as Error).message });
      }
      continue;
    }
    try {
      report.push({ space: space.name, files: await wipeSpace(db, space.id), ok: true });
    } catch (err) {
      // on continue avec les autres ; celui-ci sera retenté demain
      report.push({ space: space.name, files: 0, ok: false, error: (err as Error).message });
    }
  }
  // Envois "jusqu'au premier téléchargement" : fichiers déjà récupérés
  const { data: burned } = await db.from("files").select("id, storage_path, backend")
    .not("burned_at", "is", null).limit(500);
  let burnedFiles = 0;
  for (const f of (burned ?? []) as { id: string; storage_path: string; backend: string }[]) {
    try { await dropFile(f); burnedFiles++; } catch { /* retenté à l'heure suivante */ }
  }

  // Séminaire : chaque son part 5 jours après son ajout. Le fichier
  // d'abord, la ligne ensuite (le trigger retire le morceau devenu vide).
  const { data: expired, error: jamErr } = await db.rpc("jam_expired_files", { p_limit: 500 });
  let jamFiles = 0;
  const jamErrors: string[] = [];
  for (const f of (expired ?? []) as { id: string; storage_path: string; backend: string }[]) {
    try {
      if (f.backend === "b2") {
        if (!b2) throw new Error("B2 non configuré");
        await deletePrefix(b2, f.storage_path);
      } else {
        const { error: rmErr } = await db.storage.from("seminar").remove([f.storage_path]);
        if (rmErr) throw new Error(rmErr.message);
      }
      const { error: delErr } = await db.from("files").delete().eq("id", f.id);
      if (delErr) throw new Error(delErr.message);
      jamFiles++;
    } catch (err) {
      jamErrors.push(f.id + " : " + (err as Error).message);   // retenté à l'heure suivante
    }
  }

  // Versions remplacées : la base a déjà retiré leurs fiches, il reste les
  // fichiers stockés (file d'attente storage_trash).
  const { data: trash } = await db.from("storage_trash").select("id, storage_path, backend").order("id").limit(500);
  let trashed = 0;
  for (const item of (trash ?? []) as { id: number; storage_path: string; backend: string }[]) {
    try {
      if (item.backend === "b2") {
        if (!b2) throw new Error("B2 non configuré");
        await deletePrefix(b2, item.storage_path);
      } else {
        await db.storage.from("seminar").remove([item.storage_path]);
      }
      await db.from("storage_trash").delete().eq("id", item.id);
      trashed++;
    } catch { /* retenté à l'heure suivante */ }
  }

  return json({
    purged: report.filter((r) => r.ok).length, report,
    jam: { files: jamFiles, errors: jamErr ? [jamErr.message] : jamErrors },
    versions: trashed,
    downloaded: burnedFiles,
  });
});
