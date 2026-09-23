// Carnet des destinataires d'un expéditeur, rattaché à son email.
//
// POST { action: "list",   sender }          -> { contacts: [{ email, sends, last_at }] }
// POST { action: "forget", sender, email }   -> { ok }
//
// Exige que l'appelant ait vérifié `sender` par code sur cet appareil
// (sender_emails) : sinon, taper l'email de quelqu'un suffirait à voir à
// qui il écrit. Déployée avec --no-verify-jwt : l'appelant est identifié
// ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified } from "../_shared/email.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const KEEP_DAYS = 180;
const MAX = 40;

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);

  const body = await readJson(req);
  const sender = String(body.sender ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(sender)) return json({ error: "EMAIL_INVALIDE" }, 400);
  if (!await isVerified(db, uid, sender)) return json({ error: "EMAIL_NON_VERIFIE" }, 403);

  if (body.action === "list") {
    // ménage au passage : un carnet ne garde pas indéfiniment des adresses
    await db.from("sender_contacts").delete().eq("sender_email", sender)
      .lt("last_at", new Date(Date.now() - KEEP_DAYS * 86400e3).toISOString());
    const { data, error } = await db.from("sender_contacts")
      .select("email, sends, last_at").eq("sender_email", sender)
      .order("last_at", { ascending: false }).limit(MAX);
    if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);
    return json({ contacts: data ?? [] });
  }

  if (body.action === "forget") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return json({ error: "EMAIL_INVALIDE" }, 400);
    await db.from("sender_contacts").delete().eq("sender_email", sender).eq("email", email);
    return json({ ok: true });
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
