// Client Supabase unique de l'application.
// Toujours importer ce module avec le même suffixe ?v= que partout ailleurs :
// deux URL différentes = deux clients = deux sessions.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=86";

function atobSafe(key) {
  try { return atob(key.split(".")[1] || ""); } catch (err) { return ""; }
}

// Erreur de configuration exposée plutôt que levée à l'import : une
// exception ici casserait tout le graphe de modules (page blanche).
export const configError = !SUPABASE_PUBLISHABLE_KEY
  ? "CONFIG_MANQUANTE"
  // Garde-fou : une clé secrète dans le front donnerait tout à tout le monde.
  : /^sb_secret_/.test(SUPABASE_PUBLISHABLE_KEY) || /service_role/.test(atobSafe(SUPABASE_PUBLISHABLE_KEY))
    ? "CLE_SECRETE_DANS_LE_FRONT"
    : null;

export const BUCKET = "seminar";

export const sb = configError ? null : createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: "seminaire.auth"
  }
});

export function requireClient() {
  if (configError) throw new Error(configError);
  return sb;
}

// Déballe { data, error } : lève une Error dont le message est celui de
// Postgres (CODE_INVALIDE, PSEUDO_PRIS...), que l'UI sait traduire.
export async function q(request) {
  const { data, error } = await request;
  if (error) {
    const err = new Error(error.message || "ERREUR");
    err.code = error.code;
    err.details = error.details;
    throw err;
  }
  return data;
}

// Appel d'Edge Function : remonte le code d'erreur renvoyé en JSON.
export async function invoke(name, body) {
  const { data, error } = await requireClient().functions.invoke(name, { body });
  if (!error) return data;

  let code = error.message || "ERREUR";
  try {
    const payload = await error.context.json();
    if (payload && payload.error) code = payload.error;
  } catch (err) { /* réponse non JSON */ }
  throw new Error(code);
}
