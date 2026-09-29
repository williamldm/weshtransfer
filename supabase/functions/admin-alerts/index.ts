// Alertes email pour l'admin, toutes les heures (pg_cron, secret) :
// stockage, base, emails (o2switch coupé, liste noire, refus, quota Brevo),
// pic de bande passante. Un seul email groupé, seulement quand une alerte
// apparaît, dure depuis 24 h, ou disparaît. Logique : _shared/alerts.ts.
// Déployée avec --no-verify-jwt : appel par secret uniquement.

import { admin } from "../_shared/supabase.ts";
import { json } from "../_shared/http.ts";
import { runAlerts } from "../_shared/alerts.ts";

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHODE" }, 405);
  if (!sameSecret(req.headers.get("x-cron-secret") ?? "", Deno.env.get("CRON_SECRET") ?? "")) {
    return json({ error: "INTERDIT" }, 403);
  }
  try {
    return json(await runAlerts(admin()));
  } catch (err) {
    return json({ error: "ERREUR", detail: (err as Error).message.slice(0, 300) }, 500);
  }
});
