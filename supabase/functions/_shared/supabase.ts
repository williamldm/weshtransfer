// Client service_role : contourne la RLS, a n'utiliser que cote serveur
// et toujours apres avoir verifie soi-meme les droits de l'appelant.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.0";

function serviceKey(): string {
  // Cle historique, injectee d'office dans les Edge Functions...
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;

  // ...ou nouvelles cles (sb_secret_...), injectees sous forme de JSON.
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const first = parsed.default ?? Object.values(parsed)[0];
      if (first) return first;
    } catch { /* format inattendu : on tente la suite */ }
  }

  const manual = Deno.env.get("SERVICE_ROLE_KEY");
  if (manual) return manual;
  throw new Error("Aucune cle service_role disponible dans l'environnement");
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Identifie l'appelant a partir de son JWT (session anonyme du navigateur).
// Verification faite ici plutot que par verify_jwt : ce reglage ne
// fonctionne qu'avec l'ancien secret JWT, pas avec les nouvelles cles.
export async function callerId(req: Request, client: SupabaseClient): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
