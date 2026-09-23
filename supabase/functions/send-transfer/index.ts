// Envoie par email un envoi cree par create_transfer().
//
// POST { transfer_id }          -> envoie aux destinataires en attente
// POST { transfer_id, retry }   -> renvoie aussi a ceux en echec
// POST { check: true }          -> { email_enabled } (l'UI s'adapte)
//
// L'email de l'expediteur (reply_to) doit avoir ete verifie par code
// (Edge Function verify-email) : rien ne part "de la part de" quelqu'un
// qui n'a pas prouve que l'adresse est a lui.
//
// Deployee avec --no-verify-jwt : l'appelant est identifie ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified, mailConfig, sendEmails, transferLink, transferMail, type OutgoingEmail } from "../_shared/email.ts";

type TransferRow = {
  id: string;
  title: string;
  message: string | null;
  reply_to: string | null;
  expires_at: string;
  sender: { pseudo: string; user_id: string } | null;
  space: { name: string } | null;
};

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

  if (!transfer.reply_to) return json({ error: "EMAIL_EXPEDITEUR_REQUIS" }, 400);
  if (!await isVerified(db, uid, transfer.reply_to)) return json({ error: "EMAIL_NON_VERIFIE" }, 403);

  // Plafonds quotidiens : par expéditeur (une adresse vérifiée ne sert pas
  // à arroser), et pour tout le site (le quota du fournisseur d'envoi est
  // partagé, codes de vérification compris).
  const since = new Date(Date.now() - 86400e3).toISOString();
  const [{ count: bySender }, { count: sentAll }, { count: codesAll }, { count: pending }] = await Promise.all([
    db.from("transfer_recipients").select("id, transfers!inner(reply_to)", { count: "exact", head: true })
      .eq("status", "sent").gte("sent_at", since).eq("transfers.reply_to", transfer.reply_to),
    db.from("transfer_recipients").select("id", { count: "exact", head: true })
      .eq("status", "sent").gte("sent_at", since),
    db.from("email_codes").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("transfer_recipients").select("id", { count: "exact", head: true })
      .eq("transfer_id", transfer.id).eq("status", "pending"),
  ]);
  const wanted = pending ?? 0;
  const senderMax = Number(Deno.env.get("MAIL_SENDER_DAY") || 60);
  const globalMax = Number(Deno.env.get("MAIL_GLOBAL_DAY") || (cfg.smtp ? 800 : 280));
  if ((bySender ?? 0) + wanted > senderMax || (sentAll ?? 0) + (codesAll ?? 0) + wanted > globalMax) {
    return json({ error: "QUOTA_EMAILS_JOUR" }, 429);
  }

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
      site: cfg.site,
      to: r.email,
      sender,
      senderEmail: transfer.reply_to,
      title: transfer.title,
      message: transfer.message,
      files,
      link: transferLink(cfg.site, r.token),
      expiresAt: transfer.expires_at,
      canReply: !!transfer.reply_to,
    });
    return {
      to: r.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(transfer.reply_to ? { reply_to: transfer.reply_to } : {}),
    };
  });

  const results = await sendEmails(cfg, emails);
  const now = new Date().toISOString();

  await Promise.all(recipients.map((r, n) => {
    const res = results[n];
    return db.from("transfer_recipients")
      .update(res.ok
        ? { status: "sent", sent_at: now, error: null }
        : { status: "failed", error: res.error.slice(0, 500) })
      .eq("id", r.id);
  }));

  // Carnet de l'expéditeur (rattaché à son email vérifié) : seulement les
  // adresses qui ont bien reçu l'envoi.
  const delivered = recipients.filter((_, n) => results[n].ok).map((r) => r.email);
  if (delivered.length) {
    await db.rpc("remember_contacts", { p_sender: transfer.reply_to, p_emails: delivered });
  }

  return json({
    email_enabled: true,
    results: recipients.map((r, n) => {
      const res = results[n];
      return { email: r.email, status: res.ok ? "sent" : "failed", error: res.ok ? null : res.error };
    }),
  });
});
