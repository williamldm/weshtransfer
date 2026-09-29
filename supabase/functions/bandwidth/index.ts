// Compteur de bande passante, appelé par le relais Cloudflare
// (cloudflare/files-worker.js) à chaque fichier servi.
//
// POST { kind, delivered, origin }   en-tête x-bw-secret
//
// Le secret BW_SECRET n'existe que dans le Worker et ici : sans lui, on ne
// peut pas fausser les chiffres. Déployée avec --no-verify-jwt.

import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";

const KINDS = new Set(["audio", "video", "image", "fichier"]);
const MAX = 5 * 1024 ** 3;   // 5 Go par réponse : au-delà, c'est faux

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHODE" }, 405);
  if (!sameSecret(req.headers.get("x-bw-secret") ?? "", Deno.env.get("BW_SECRET") ?? "")) {
    return json({ error: "INTERDIT" }, 403);
  }
  const body = await req.json().catch(() => ({})) as { kind?: string; delivered?: number; origin?: number };
  const kind = String(body.kind ?? "");
  const delivered = Math.floor(Number(body.delivered));
  const origin = Math.floor(Number(body.origin));
  if (!KINDS.has(kind) || !Number.isFinite(delivered) || !Number.isFinite(origin)
      || delivered < 0 || origin < 0 || delivered > MAX || origin > MAX) {
    return json({ error: "REQUETE_INVALIDE" }, 400);
  }
  const { error } = await admin().rpc("bw_add", { p_kind: kind, p_delivered: delivered, p_origin: origin, p_reqs: 1 });
  if (error) return json({ error: "ERREUR_BASE" }, 500);
  return json({ ok: true });
});
