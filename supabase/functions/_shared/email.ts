// Envoi des emails transactionnels.
//
// Deux voies, dans cet ordre :
//   1. SMTP o2switch (boîte envoi@weshtransfer.fr) : gratuit, n'entame pas
//      le quota Brevo. Secrets SMTP_HOST, SMTP_USER, SMTP_PASS (voir smtp.ts).
//   2. Brevo (API HTTP) : en secours si le SMTP est absent ou refuse un
//      message. Secret BREVO_API_KEY. Plan gratuit : 300 emails par jour.
// Communs : MAIL_FROM ("WeshTransfer <envoi@weshtransfer.fr>") et SITE_URL
// (https://weshtransfer.fr). Sans aucune des deux voies, l'envoi par email
// est désactivé et l'appli bascule sur le partage de lien : rien ne casse.

import { smtpConfig, smtpSendAll, type SmtpConfig } from "./smtp.ts";
export {
  esc, formatBytes, formatDate, typeLabel, transferMail, verifyCodeMail, downloadNoticeMail, inviteMail, reviewDigestMail,
  sentConfirmMail, openNoticeMail,
} from "./mail-templates.js";

export type Sender = { name?: string; email: string };
export type MailConfig = { from: Sender; site: string; brevo: string | null; smtp: SmtpConfig | null };

// "Nom <adresse>" ou "adresse" seule
function parseFrom(raw: string): Sender | null {
  const m = raw.trim().match(/^(?:"?([^"<]*?)"?\s*<([^>\s]+@[^>\s]+)>|([^<>\s]+@[^<>\s]+))$/);
  if (!m) return null;
  return m[3] ? { email: m[3] } : { name: m[1] || undefined, email: m[2] };
}

export function mailConfig(): MailConfig | null {
  const from = parseFrom(Deno.env.get("MAIL_FROM") ?? "");
  const site = Deno.env.get("SITE_URL");
  const brevo = Deno.env.get("BREVO_API_KEY") || null;
  const smtp = smtpConfig();
  if (!from || !site || (!brevo && !smtp)) return null;
  return { from, site: site.replace(/\/+$/, ""), brevo, smtp };
}

// Liens courts (weshtransfer.fr/t/<jeton>) dès que le site les connaît :
// secret SHORT_LINKS=1, posé après le déploiement des règles Apache.
export const shortLinks = () => Deno.env.get("SHORT_LINKS") === "1";

export function transferLink(site: string, token: string): string {
  return shortLinks() ? `${site}/t/${token}` : `${site}/t.html?k=${token}`;
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
};

export type SendResult =
  | { ok: true; id: string | null; via: "smtp" | "brevo" }
  | { ok: false; error: string };

// Un message par destinataire (chacun a son lien personnel). SMTP d'abord,
// sur une seule connexion ; chaque message refusé retente par Brevo.
export async function sendEmails(cfg: MailConfig, emails: OutgoingEmail[]): Promise<SendResult[]> {
  const results: (SendResult | null)[] = emails.map(() => null);
  let smtpError = "";

  if (cfg.smtp && emails.length) {
    try {
      const out = await smtpSendAll(cfg.smtp, emails.map((e) => ({
        from: cfg.from, to: e.to, replyTo: e.reply_to, subject: e.subject, html: e.html, text: e.text,
      })));
      out.forEach((r, i) => {
        if (r.ok) results[i] = { ok: true, id: r.id, via: "smtp" };
        else smtpError = r.error;
      });
    } catch (err) {
      smtpError = (err as Error).message;
    }
    if (smtpError) console.warn("SMTP en échec, bascule Brevo :", smtpError);
  }

  await Promise.all(emails.map(async (e, i) => {
    if (results[i]) return;
    results[i] = cfg.brevo
      ? await sendBrevo(cfg, e)
      : { ok: false, error: smtpError || "Aucune voie d'envoi configurée" };
  }));
  return results as SendResult[];
}

async function sendBrevo(cfg: MailConfig, e: OutgoingEmail): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cfg.brevo!, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: cfg.from,
        to: [{ email: e.to }],
        subject: e.subject,
        htmlContent: e.html,
        textContent: e.text,
        ...(e.reply_to ? { replyTo: { email: e.reply_to } } : {}),
        tags: ["weshtransfer"],
      }),
    });
  } catch (err) {
    return { ok: false, error: `Brevo injoignable : ${(err as Error).message}` };
  }
  const body = await res.json().catch(() => ({})) as { messageId?: string; message?: string; code?: string };
  if (!res.ok) return { ok: false, error: body.message ?? body.code ?? `Brevo HTTP ${res.status}` };
  return { ok: true, id: body.messageId ?? null, via: "brevo" };
}

// Adresse vérifiée par CET utilisateur (table sender_emails) ?
// deno-lint-ignore no-explicit-any
// Emails partis ou en partance sur 24 h, tout le site : codes, invitations,
// transferts. Un seul plafond : le quota du fournisseur est commun, et
// personne ne doit pouvoir l'épuiser pour bloquer les autres.
export function mailDayMax(cfg: MailConfig): number {
  return Number(Deno.env.get("MAIL_GLOBAL_DAY") || (cfg.smtp ? 800 : 280));
}
export async function mailsToday(db: any): Promise<number> {
  const since = new Date(Date.now() - 86400e3).toISOString();
  const [a, b, c, d] = await Promise.all([
    db.from("email_codes").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("transfer_recipients").select("id", { count: "exact", head: true }).eq("status", "sent").gte("sent_at", since),
    db.from("space_invites").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("transfers").select("id", { count: "exact", head: true }).gte("sender_notified_at", since),
  ]);
  return (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0) + (d.count ?? 0);
}

export async function isVerified(db: any, userId: string, email: string | null): Promise<boolean> {
  if (!email) return false;
  const { data } = await db.from("sender_emails").select("email")
    .eq("user_id", userId).eq("email", email.trim().toLowerCase()).maybeSingle();
  return !!data;
}
