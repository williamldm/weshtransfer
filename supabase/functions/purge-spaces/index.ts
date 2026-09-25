// Purge des espaces dont la date de suppression est passée, et des sons
// de séminaire (jam) arrivés à 5 jours. Appelée toutes les heures par
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

  const report: { space: string; files: number; ok: boolean; error?: string }[] = [];
  for (const space of spaces ?? []) {
    try {
      report.push({ space: space.name, files: await wipeSpace(db, space.id), ok: true });
    } catch (err) {
      // on continue avec les autres ; celui-ci sera retenté demain
      report.push({ space: space.name, files: 0, ok: false, error: (err as Error).message });
    }
  }
  // Séminaire : chaque son part 5 jours après son ajout. Le fichier
  // d'abord, la ligne ensuite (le trigger retire le morceau devenu vide).
  const b2 = b2Config();
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

  return json({
    purged: report.filter((r) => r.ok).length, report,
    jam: { files: jamFiles, errors: jamErr ? [jamErr.message] : jamErrors },
  });
});
