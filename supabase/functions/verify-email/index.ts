// Vérification de l'email de l'expéditeur par code à 6 chiffres.
//
// POST { action: "status",  email }        -> { verified }
// POST { action: "request", email }        -> envoie un code -> { sent } ou { verified }
// POST { action: "confirm", email, code }  -> { verified } ou erreur
//
// Rattaché à la session anonyme de l'appelant (un appareil). Limites :
// 5 codes par heure et par appareil, 10 par heure et par IP, 8 par jour
// et par adresse (sinon ce serait un moyen d'inonder la boîte de
// quelqu'un), 100 par heure pour tout le site, 5 essais par code,
// 15 minutes de validité. Déployée avec --no-verify-jwt : l'appelant est
// identifié ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified, mailConfig, sendEmails, verifyCodeMail } from "../_shared/email.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MINUTES = 15;
const MAX_ATTEMPTS = 5;

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Code uniforme sur 000000-999999 (rejet des valeurs hors plage)
function newCode(): string {
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, "0");
}

const hashOf = (uid: string, email: string, code: string) => sha256(`${uid}:${email}:${code}`);

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || "inconnue";
}

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

  const cfg = mailConfig();
  if (!cfg) return json({ error: "EMAIL_INDISPONIBLE" }, 503);

  // ------------------------------------------------------------ envoi du code
  if (body.action === "request") {
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const dayAgo = new Date(Date.now() - 86400e3).toISOString();
    const ip = await sha256("wt:" + clientIp(req));
    const [{ count: mine }, { count: forEmail }, { count: fromIp }, { count: all }] = await Promise.all([
      db.from("email_codes").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", hourAgo),
      db.from("email_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", dayAgo),
      db.from("email_codes").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", hourAgo),
      db.from("email_codes").select("id", { count: "exact", head: true }).gte("created_at", hourAgo),
    ]);
    if ((mine ?? 0) >= 5 || (forEmail ?? 0) >= 8 || (fromIp ?? 0) >= 10 || (all ?? 0) >= 100) {
      return json({ error: "TROP_DE_CODES" }, 429);
    }

    // ménage : les codes de plus d'un jour ne servent plus qu'aux limites
    await db.from("email_codes").delete().lt("created_at", dayAgo);
    // un seul code valable à la fois par appareil et par adresse : l'ancien
    // expire tout de suite mais reste compté dans les limites
    await db.from("email_codes").update({ expires_at: new Date().toISOString() })
      .eq("user_id", uid).eq("email", email).gt("expires_at", new Date().toISOString());

    const code = newCode();
    const { data: row, error } = await db.from("email_codes").insert({
      user_id: uid,
      email,
      ip_hash: ip,
      code_hash: await hashOf(uid, email, code),
      expires_at: new Date(Date.now() + MINUTES * 60e3).toISOString(),
    }).select("id").single();
    if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);

    const mail = verifyCodeMail({ site: cfg.site, email, code, minutes: MINUTES });
    const [sent] = await sendEmails(cfg, [{ to: email, subject: mail.subject, html: mail.html, text: mail.text }]);
    if (!sent.ok) {
      await db.from("email_codes").delete().eq("id", row.id);
      return json({ error: "ENVOI_CODE_ECHEC", detail: sent.error }, 502);
    }
    return json({ sent: true, minutes: MINUTES });
  }

  // -------------------------------------------------------- saisie du code
  if (body.action === "confirm") {
    const code = String(body.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) return json({ error: "CODE_FAUX" }, 400);

    const { data: row } = await db.from("email_codes")
      .select("id, code_hash, attempts, expires_at")
      .eq("user_id", uid).eq("email", email)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!row || new Date(row.expires_at) < new Date()) return json({ error: "CODE_EXPIRE" }, 410);
    if (row.attempts >= MAX_ATTEMPTS) return json({ error: "TROP_D_ESSAIS" }, 429);

    if (row.code_hash !== await hashOf(uid, email, code)) {
      await db.from("email_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return json({ error: row.attempts + 1 >= MAX_ATTEMPTS ? "TROP_D_ESSAIS" : "CODE_FAUX" }, 400);
    }

    await db.from("sender_emails").upsert({ user_id: uid, email }, { onConflict: "user_id,email" });
    await db.from("email_codes").update({ expires_at: new Date().toISOString() }).eq("id", row.id);
    return json({ verified: true });
  }

  return json({ error: "ACTION_INCONNUE" }, 400);
});
