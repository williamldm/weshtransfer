// Envoie par email un envoi cree par create_transfer().
//
// POST { transfer_id }          -> envoie aux destinataires en attente
// POST { transfer_id, retry }   -> renvoie aussi a ceux en echec
// POST { check: true }          -> { email_enabled } (l'UI s'adapte)
//
// Une fois par envoi, l'expéditeur reçoit une confirmation avec le lien
// (aussi pour un envoi par lien seul, sans destinataire).
//
// L'email de l'expediteur (reply_to) doit avoir ete verifie par code
// (Edge Function verify-email) : rien ne part "de la part de" quelqu'un
// qui n'a pas prouve que l'adresse est a lui.
//
// Deployee avec --no-verify-jwt : l'appelant est identifie ici via son JWT.

import { admin, callerId } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { isVerified, mailConfig, mailDayMax, mailsToday, sendEmails, sentConfirmMail, transferLink, transferMail, type MailConfig, type OutgoingEmail } from "../_shared/email.ts";

type TransferRow = {
  id: string;
  token: string;
  title: string;
  message: string | null;
  reply_to: string | null;
  expires_at: string;
  until_download: boolean;
  sender: { pseudo: string; user_id: string } | null;
  space: { name: string } | null;
};

type FileInfo = { name: string; size: number | null; kind: string };

// Confirmation à l'expéditeur, avec le lien. Une seule fois : la date
// sender_notified_at sert de verrou. Au-delà du budget d'emails du jour,
// l'avis saute (l'envoi, lui, est parti).
// deno-lint-ignore no-explicit-any
async function confirmToSender(db: any, cfg: MailConfig, transfer: TransferRow, files: FileInfo[], recipients: { email: string; ok: boolean }[]) {
  const { data: lock } = await db.from("transfers").update({ sender_notified_at: new Date().toISOString() })
    .eq("id", transfer.id).is("sender_notified_at", null).select("id");
  if (!lock?.length || !transfer.reply_to) return;
  if (await mailsToday(db) > mailDayMax(cfg)) return;
  const mail = sentConfirmMail({
    site: cfg.site, title: transfer.title, link: transferLink(cfg.site, transfer.token),
    files, recipients, expiresAt: transfer.expires_at, untilDownload: transfer.until_download,
  });
  await sendEmails(cfg, [{ to: transfer.reply_to, subject: mail.subject, html: mail.html, text: mail.text }], { kind: "confirmation" });
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
    .select("id, token, title, message, reply_to, expires_at, until_download, sender:participants(pseudo, user_id), space:spaces(name)")
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
  const [{ count: bySender }, today, { count: pending }] = await Promise.all([
    db.from("transfer_recipients").select("id, transfers!inner(reply_to)", { count: "exact", head: true })
      .eq("status", "sent").gte("sent_at", since).eq("transfers.reply_to", transfer.reply_to),
    mailsToday(db),
    db.from("transfer_recipients").select("id", { count: "exact", head: true })
      .eq("transfer_id", transfer.id).eq("status", "pending"),
  ]);
  const wanted = pending ?? 0;
  const senderMax = Number(Deno.env.get("MAIL_SENDER_DAY") || 60);
  if ((bySender ?? 0) + wanted > senderMax || today + wanted > mailDayMax(cfg)) {
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

  const { data: items } = await db
    .from("transfer_files")
    .select("position, file:files(original_name, size_bytes, kind)")
    .eq("transfer_id", transfer.id)
    .order("position");

  const files: FileInfo[] = (items ?? [])
    .map((i) => (i as unknown as { file: { original_name: string; size_bytes: number | null; kind: string } | null }).file)
    .filter((f): f is { original_name: string; size_bytes: number | null; kind: string } => !!f)
    .map((f) => ({ name: f.original_name, size: f.size_bytes, kind: f.kind }));

  // envoi par lien seul : juste la confirmation, lien compris
  if (!recipients?.length) {
    await confirmToSender(db, cfg, transfer, files, []).catch(() => {});
    return json({ email_enabled: true, results: [] });
  }

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
      untilDownload: transfer.until_download,
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

  const results = await sendEmails(cfg, emails, { kind: "transfert", refs: recipients.map((r) => r.id) });
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

  await confirmToSender(db, cfg, transfer, files,
    recipients.map((r, n) => ({ email: r.email, ok: results[n].ok }))).catch(() => {});

  return json({
    email_enabled: true,
    results: recipients.map((r, n) => {
      const res = results[n];
      return { email: r.email, status: res.ok ? "sent" : "failed", error: res.ok ? null : res.error };
    }),
  });
});
