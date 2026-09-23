// Purge des espaces dont la date de suppression est passée.
// Appelée une fois par jour par pg_cron (via pg_net), qui n'envoie pas de
// JWT : déployée avec --no-verify-jwt, protégée par le secret CRON_SECRET.

import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";
import { wipeSpace } from "../_shared/wipe.ts";

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
  return json({ purged: report.filter((r) => r.ok).length, report });
});
