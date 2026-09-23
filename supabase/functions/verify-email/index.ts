// Vérification de l'email de l'expéditeur par code à 6 chiffres.
//
// POST { action: "status",  email }        -> { verified }
// POST { action: "request", email }        -> envoie un code -> { sent } ou { verified }
// POST { action: "confirm", email, code }  -> { verified } ou erreur
//
// Rattaché à la session anonyme de l'appelant (un appareil). Limites et
// logique des codes : _shared/codes.ts. Déployée avec --no-verify-jwt :
// l'appelant est identifié ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified, mailConfig } from "../_shared/email.ts";
import { CODE_MINUTES, confirmCode, requestCode } from "../_shared/codes.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);

  const body = await readJson(req);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "EMAIL_INVALIDE" }, 400);

  if (await isVerified(db, uid, email)) return json({ verified: true });
  if (body.action === "status") return json({ verified: false });

  if (body.action === "request") {
    const cfg = mailConfig();
    if (!cfg) return json({ error: "EMAIL_INDISPONIBLE" }, 503);
    const r = await requestCode(db, cfg, req, uid, email);
    if (!r.ok) return json({ error: r.error, detail: r.detail }, r.status);
    return json(r.verified ? { verified: true } : { sent: true, minutes: CODE_MINUTES });
  }

  if (body.action === "confirm") {
    const r = await confirmCode(db, uid, email, body.code);
    if (!r.ok) return json({ error: r.error }, r.status);
    return json({ verified: true });
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
