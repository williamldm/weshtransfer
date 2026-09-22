// Purge des espaces dont la date de suppression est passee.
// Appelee une fois par jour par pg_cron (via pg_net), qui n'envoie pas de
// JWT : deployee avec --no-verify-jwt, protegee par le secret CRON_SECRET.
//
// Ordre imperatif : d'abord les fichiers du Storage, ensuite la ligne
// spaces. Le "on delete cascade" SQL ne touche jamais aux fichiers, et
// Supabase interdit de supprimer storage.objects directement en SQL.

import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";

const BUCKET = "seminar";

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Liste recursive d'un dossier du bucket (le Storage ne liste qu'un niveau).
async function listAll(db: ReturnType<typeof admin>, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix} : ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      // un dossier n'a pas d'id
      if (item.id === null) out.push(...await listAll(db, path));
      else out.push(path);
    }
    if (data.length < 1000) break;
  }
  return out;
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
      const paths = await listAll(db, `spaces/${space.id}`);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmError } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (rmError) throw new Error(`remove : ${rmError.message}`);
      }
      const { error: delError } = await db.from("spaces").delete().eq("id", space.id);
      if (delError) throw new Error(`delete : ${delError.message}`);
      report.push({ space: space.name, files: paths.length, ok: true });
    } catch (err) {
      // on continue avec les autres espaces ; celui-ci sera retente demain
      report.push({ space: space.name, files: 0, ok: false, error: (err as Error).message });
    }
  }

  return json({ purged: report.filter((r) => r.ok).length, report });
});
