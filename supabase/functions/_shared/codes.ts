// Codes à 6 chiffres envoyés par email : vérifier l'expéditeur d'un envoi
// (verify-email) et vérifier qu'un invité est bien le destinataire de son
// invitation (invite). Mêmes tables, mêmes limites :
//   5 codes par heure et par appareil, 10 par heure et par IP, 8 par jour
//   et par adresse, 100 par heure pour tout le site, 5 essais par code,
//   15 minutes de validité.
// Un code réussi inscrit l'adresse dans sender_emails pour CET appareil :
// ensuite, plus besoin de code sur cet appareil.

// deno-lint-ignore-file no-explicit-any
import { isVerified, mailDayMax, mailsToday, sendEmails, verifyCodeMail, type MailConfig } from "./email.ts";

export const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
    || "inconnue";
}

// Code uniforme sur 000000-999999 (rejet des valeurs hors plage)
function newCode(): string {
  const a = new Uint32Array(1);
  do crypto.getRandomValues(a); while (a[0] >= 4294000000);
  return String(a[0] % 1000000).padStart(6, "0");
}

const hashOf = (uid: string, email: string, code: string) => sha256(`${uid}:${email}:${code}`);

export type CodeResult = { ok: true; verified?: boolean; reused?: boolean } | { ok: false; error: string; status: number; detail?: string };

// Envoie un code à `email` pour l'appareil `uid`. purpose : phrase de
// l'email ("pour rejoindre le salon X"), facultative.
export async function requestCode(
  db: any, cfg: MailConfig, req: Request, uid: string, email: string, purpose?: string,
): Promise<CodeResult> {
  if (await isVerified(db, uid, email)) return { ok: true, verified: true };

  const ip = await sha256("wt:" + clientIp(req));
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const dayAgo = new Date(Date.now() - 86400e3).toISOString();
  const [{ count: mine }, { count: forEmail }, { count: fromIp }, { count: all }] = await Promise.all([
    db.from("email_codes").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", hourAgo),
    db.from("email_codes").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", dayAgo),
    db.from("email_codes").select("id", { count: "exact", head: true }).eq("ip_hash", ip).gte("created_at", hourAgo),
    db.from("email_codes").select("id", { count: "exact", head: true }).gte("created_at", hourAgo),
  ]);
  if ((mine ?? 0) >= 5 || (forEmail ?? 0) >= 8 || (fromIp ?? 0) >= 10 || (all ?? 0) >= 100) {
    return { ok: false, error: "TROP_DE_CODES", status: 429 };
  }
  if (await mailsToday(db) >= mailDayMax(cfg)) return { ok: false, error: "QUOTA_EMAILS_JOUR", status: 429 };

  // ménage : les codes de plus d'un jour ne servent plus qu'aux limites
  await db.from("email_codes").delete().lt("created_at", dayAgo);

  // Double appui, fenêtre fermée puis rouverte : un code parti il y a moins
  // d'une minute suffit, pas de second email. (Avant, chaque demande
  // annulait la précédente : on tapait le code du premier email reçu et il
  // était refusé.)
  const { data: recent } = await db.from("email_codes").select("id")
    .eq("user_id", uid).eq("email", email)
    .gt("expires_at", new Date().toISOString())
    .gt("created_at", new Date(Date.now() - 60e3).toISOString())
    .limit(1).maybeSingle();
  if (recent) return { ok: true, reused: true };

  const code = newCode();
  const { data: row, error } = await db.from("email_codes").insert({
    user_id: uid, email, ip_hash: ip,
    code_hash: await hashOf(uid, email, code),
    expires_at: new Date(Date.now() + CODE_MINUTES * 60e3).toISOString(),
  }).select("id").single();
  if (error) return { ok: false, error: "ERREUR_BASE", status: 500, detail: error.message };

  const mail = verifyCodeMail({ site: cfg.site, email, code, minutes: CODE_MINUTES, purpose });
  const [sent] = await sendEmails(cfg, [{ to: email, subject: mail.subject, html: mail.html, text: mail.text }], { kind: "code" });
  if (!sent.ok) {
    await db.from("email_codes").delete().eq("id", row.id);
    return { ok: false, error: "ENVOI_CODE_ECHEC", status: 502, detail: sent.error };
  }
  return { ok: true };
}

// Vérifie le code tapé. Réussi : l'adresse est retenue pour cet appareil.
export async function confirmCode(db: any, uid: string, email: string, rawCode: unknown): Promise<CodeResult> {
  if (await isVerified(db, uid, email)) return { ok: true, verified: true };
  const code = String(rawCode ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "CODE_FAUX", status: 400 };

  // Tous les codes encore valables de cet appareil pour cette adresse : si
  // plusieurs emails sont partis, n'importe lequel marche. Les essais sont
  // comptés sur le plus récent (5 au plus).
  const { data: rows } = await db.from("email_codes")
    .select("id, code_hash, attempts, expires_at")
    .eq("user_id", uid).eq("email", email)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(5);
  const valid = (rows ?? []) as { id: string; code_hash: string; attempts: number }[];
  if (!valid.length) return { ok: false, error: "CODE_EXPIRE", status: 410 };
  const latest = valid[0];
  if (latest.attempts >= MAX_ATTEMPTS) return { ok: false, error: "TROP_D_ESSAIS", status: 429 };

  const hash = await hashOf(uid, email, code);
  if (!valid.some((r) => r.code_hash === hash)) {
    await db.from("email_codes").update({ attempts: latest.attempts + 1 }).eq("id", latest.id);
    return { ok: false, error: latest.attempts + 1 >= MAX_ATTEMPTS ? "TROP_D_ESSAIS" : "CODE_FAUX", status: 400 };
  }

  await db.from("sender_emails").upsert({ user_id: uid, email }, { onConflict: "user_id,email" });
  await db.from("email_codes").update({ expires_at: new Date().toISOString() })
    .in("id", valid.map((r) => r.id));
  return { ok: true, verified: true };
}
