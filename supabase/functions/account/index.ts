// Connexion au compte d'une adresse email, sans mot de passe.
//
// POST { action: "login", email, code? }  -> { email, token_hash }
//   code : celui reçu par email (verify-email request) ; inutile si cet
//   appareil a déjà vérifié l'adresse. token_hash présent : le navigateur
//   ouvre la session du compte avec verifyOtp. Absent : l'appareil est
//   devenu le compte, sa session reste valable.
// Déployée avec --no-verify-jwt : l'appelant est identifié via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { confirmCode } from "../_shared/codes.ts";
import { loginAccount } from "../_shared/account.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);
  const body = await readJson(req);

  if (body.action === "login") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "EMAIL_INVALIDE" }, 400);
    const check = await confirmCode(db, uid, email, body.code);   // déjà vérifiée : passe sans code
    if (!check.ok) return json({ error: check.error }, check.status);
    try {
      const r = await loginAccount(db, uid, email);
      return json({ email, token_hash: r.token });
    } catch (err) {
      return json({ error: "CONNEXION_ECHEC", detail: (err as Error).message.slice(0, 200) }, 500);
    }
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
