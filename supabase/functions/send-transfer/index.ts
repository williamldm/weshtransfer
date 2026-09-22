// Envoie par email un envoi cree par create_transfer().
//
// POST { transfer_id }          -> envoie aux destinataires en attente
// POST { transfer_id, retry }   -> renvoie aussi a ceux en echec
// POST { check: true }          -> { email_enabled } (l'UI s'adapte)
//
// Deployee avec --no-verify-jwt : l'appelant est identifie ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { mailConfig, sendBatch, transferLink, transferMail, type OutgoingEmail } from "../_shared/email.ts";

type TransferRow = {
  id: string;
  title: string;
  message: string | null;
  reply_to: string | null;
  expires_at: string;
  sender: { pseudo: string; user_id: string } | null;
  space: { name: string } | null;
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const uid = await callerId(req, db);
  if (!uid) return json({ error: "NON_AUTHENTIFIE" }, 401);

  const body = await readJson(req);
  const cfg = mailConfig();

  if (body.check) return json({ email_enabled: cfg !== null });

  const transferId = typeof body.transfer_id === "string" ? body.transfer_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(transferId)) return json({ error: "ENVOI_INCONNU" }, 400);

  const { data: transfer, error } = await db
    .from("transfers")
    .select("id, title, message, reply_to, expires_at, sender:participants(pseudo, user_id), space:spaces(name)")
    .eq("id", transferId)
    .maybeSingle<TransferRow>();

  if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);
  if (!transfer) return json({ error: "ENVOI_INCONNU" }, 404);

  // Seul l'expediteur declenche l'envoi de SES emails.
  if (transfer.sender?.user_id !== uid) return json({ error: "PAS_TON_ENVOI" }, 403);
  if (new Date(transfer.expires_at) < new Date()) return json({ error: "ENVOI_EXPIRE" }, 410);

  if (!cfg) return json({ email_enabled: false, results: [] });

  if (body.retry) {
    await db.from("transfer_recipients")
      .update({ status: "pending", error: null })
      .eq("transfer_id", transfer.id)
      .eq("status", "failed");
  }

  const { data: recipients } = await db
    .from("transfer_recipients")
    .select("id, email, token")
    .eq("transfer_id", transfer.id)
    .eq("status", "pending")
    .order("created_at");

  if (!recipients?.length) return json({ email_enabled: true, results: [] });

  const { data: items } = await db
    .from("transfer_files")
    .select("position, file:files(original_name, size_bytes, kind)")
    .eq("transfer_id", transfer.id)
    .order("position");

  const files = (items ?? [])
    .map((i) => (i as unknown as { file: { original_name: string; size_bytes: number | null; kind: string } | null }).file)
    .filter((f): f is { original_name: string; size_bytes: number | null; kind: string } => !!f)
    .map((f) => ({ name: f.original_name, size: f.size_bytes, kind: f.kind }));

  const sender = transfer.sender?.pseudo ?? "Quelqu'un";

  const emails: OutgoingEmail[] = recipients.map((r) => {
    const mail = transferMail({
      sender,
      spaceName: transfer.space?.name ?? "",
      title: transfer.title,
      message: transfer.message,
      files,
      link: transferLink(cfg.site, r.token),
      expiresAt: transfer.expires_at,
      canReply: !!transfer.reply_to,
    });
    return {
      from: cfg.from,
      to: [r.email],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(transfer.reply_to ? { reply_to: transfer.reply_to } : {}),
    };
  });

  // Un double clic ou une relance reseau ne doit pas envoyer deux fois.
  const key = await sha256(transfer.id + ":" + recipients.map((r) => r.id).join(","));
  const result = await sendBatch(cfg, emails, key);
  const now = new Date().toISOString();

  if (result.ok) {
    await db.from("transfer_recipients")
      .update({ status: "sent", sent_at: now, error: null })
      .in("id", recipients.map((r) => r.id));
  } else {
    await db.from("transfer_recipients")
      .update({ status: "failed", error: result.error.slice(0, 500) })
      .in("id", recipients.map((r) => r.id));
  }

  return json({
    email_enabled: true,
    results: recipients.map((r) => ({
      email: r.email,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
    })),
  });
});
