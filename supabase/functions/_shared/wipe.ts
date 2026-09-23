// Effacement complet d'un espace : fichiers du Storage Supabase, fichiers
// B2 (toutes versions, uploads abandonnés), puis la ligne spaces, qui fait
// tomber le reste en cascade. Utilisé par la purge nocturne et par la
// suppression manuelle du host.
//
// Ordre imperatif : les fichiers d'abord. Le "on delete cascade" SQL ne
// touche jamais aux fichiers.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.0";
import { b2Config, deletePrefix } from "./b2.ts";

const BUCKET = "seminar";

async function listAll(db: SupabaseClient, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix} : ${error.message}`);
    if (!data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...await listAll(db, path));
      else out.push(path);
    }
    if (data.length < 1000) break;
  }
  return out;
}

export async function wipeSpace(db: SupabaseClient, spaceId: string): Promise<number> {
  const paths = await listAll(db, `spaces/${spaceId}`);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`remove : ${error.message}`);
  }
  const b2 = b2Config();
  const onB2 = b2 ? await deletePrefix(b2, `spaces/${spaceId}/`) : 0;

  const { error } = await db.from("spaces").delete().eq("id", spaceId);
  if (error) throw new Error(`delete : ${error.message}`);
  return paths.length + onB2;
}
