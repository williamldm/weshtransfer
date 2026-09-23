// Emails transactionnels via Resend (https://resend.com).
//
// Trois secrets a definir (supabase secrets set ...) :
//   RESEND_API_KEY  cle API Resend (re_...)
//   MAIL_FROM       expediteur sur un domaine verifie chez Resend,
//                   ex. "Seminaire <envoi@mondomaine.fr>"
//   SITE_URL        adresse publique du site, ex. https://sons.mondomaine.fr
// Tant que l'un manque, l'envoi par email est desactive et l'appli bascule
// sur le partage de lien : rien ne casse.

export type MailConfig = { key: string; from: string; site: string };

export function mailConfig(): MailConfig | null {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MAIL_FROM");
  const site = Deno.env.get("SITE_URL");
  if (!key || !from || !site) return null;
  return { key, from, site: site.replace(/\/+$/, "") };
}

export function transferLink(site: string, token: string): string {
  return `${site}/t.html?k=${token}`;
}

export type OutgoingEmail = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
};

export async function sendBatch(
  cfg: MailConfig,
  emails: OutgoingEmail[],
  idempotencyKey?: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers,
      body: JSON.stringify(emails),
    });
  } catch (err) {
    return { ok: false, error: `Resend injoignable : ${(err as Error).message}` };
  }

  const body = await res.json().catch(() => ({})) as {
    data?: { id: string }[];
    message?: string;
  };
  if (!res.ok) return { ok: false, error: body.message ?? `Resend HTTP ${res.status}` };
  return { ok: true, ids: (body.data ?? []).map((d) => d.id) };
}

// ------------------------------------------------------------ formatage

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  const units = ["o", "Ko", "Mo", "Go"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

const KIND_LABEL: Record<string, string> = {
  instru: "Instru", voix: "Voix", freestyle: "Freestyle",
  mix: "Mix", stems: "Stems",
};

// Même classement que js/files.js, réduit à ce dont l'email a besoin.
const CATS: [string, string[]][] = [
  ["Audio", ["mp3", "wav", "aif", "aiff", "m4a", "flac", "ogg", "opus", "aac"]],
  ["Image", ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "psd", "tif", "tiff"]],
  ["Vidéo", ["mp4", "mov", "m4v", "webm", "mkv", "avi"]],
  ["Document", ["pdf", "doc", "docx", "txt", "rtf", "pages", "xls", "xlsx", "csv"]],
  ["Archive", ["zip", "rar", "7z", "tar", "gz"]],
  ["Projet", ["als", "flp", "logicx", "ptx", "cpr", "rpp", "song", "band", "mid", "midi"]],
];

function typeLabel(name: string, kind: string): string {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const cat = CATS.find(([, list]) => list.includes(ext))?.[0] ?? "Fichier";
  return cat === "Audio" && KIND_LABEL[kind] ? KIND_LABEL[kind] : cat;
}

// ------------------------------------------------------------- gabarits

export type TransferMailInput = {
  sender: string;
  spaceName: string;
  title: string;
  message: string | null;
  files: { name: string; kind: string; size: number | null }[];
  link: string;
  expiresAt: string;
  canReply: boolean;
};

export function transferMail(input: TransferMailInput): { subject: string; html: string; text: string } {
  const count = input.files.length;
  const total = input.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const countLabel = count > 1 ? `${count} fichiers` : "1 fichier";
  const until = formatDate(input.expiresAt);
  const shown = input.files.slice(0, 12);
  const hidden = count - shown.length;

  const subject = `${input.sender} t'a envoyé "${input.title}"`;
  const preheader = `${countLabel} · ${formatBytes(total)} · disponible jusqu'au ${until}`;

  const rows = shown.map((f) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #ececef;font-size:14px;color:#16181d;word-break:break-all;">${esc(f.name)}</td>
        <td style="padding:10px 0 10px 12px;border-bottom:1px solid #ececef;font-size:12px;color:#6c7484;white-space:nowrap;text-align:right;">${esc(typeLabel(f.name, f.kind))} · ${esc(formatBytes(f.size))}</td>
      </tr>`).join("");

  const more = hidden > 0
    ? `<tr><td colspan="2" style="padding:10px 0;font-size:13px;color:#6c7484;">+ ${hidden} autre${hidden > 1 ? "s" : ""}</td></tr>`
    : "";

  const message = input.message
    ? `<div style="margin:0 0 24px;padding:14px 16px;border-left:3px solid #7c3aed;background:#f5f0ff;font-size:15px;line-height:1.5;color:#16181d;white-space:pre-wrap;">${esc(input.message)}</div>`
    : "";

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fa;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#0b0911;background-image:linear-gradient(135deg,#1b1030 0%,#0b0911 70%);padding:20px 24px;">
      <span style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.02em;"><span style="color:#a78bfa;">&#9679;</span> Séminaire</span>
      <span style="font-size:13px;color:#aba2bf;"> · ${esc(input.spaceName)}</span>
    </td></tr>
    <tr><td style="padding:28px 24px 8px;">
      <p style="margin:0 0 6px;font-size:14px;color:#6c7484;"><strong style="color:#16181d;">${esc(input.sender)}</strong> t'a envoyé ${countLabel}</p>
      <h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;color:#0b0c0f;">${esc(input.title)}</h1>
      ${message}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">${rows}${more}</table>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr><td style="border-radius:12px;background:#7c3aed;">
        <a href="${esc(input.link)}" style="display:inline-block;padding:15px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">Ouvrir l'envoi</a>
      </td></tr></table>
      <p style="margin:0 0 24px;font-size:13px;color:#6c7484;">${esc(formatBytes(total))} au total · disponible jusqu'au ${esc(until)}</p>
    </td></tr>
    <tr><td style="padding:16px 24px 22px;border-top:1px solid #ececef;font-size:12px;line-height:1.5;color:#8b92a1;">
      ${input.canReply ? `Répondre à cet email écrit directement à ${esc(input.sender)}.<br>` : ""}
      Si le bouton ne marche pas : <a href="${esc(input.link)}" style="color:#6d28d9;word-break:break-all;">${esc(input.link)}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text = [
    `${input.sender} t'a envoyé ${countLabel} : ${input.title}`,
    "",
    input.message ? `${input.message}\n` : "",
    ...shown.map((f) => `- ${f.name} (${typeLabel(f.name, f.kind)}, ${formatBytes(f.size)})`),
    hidden > 0 ? `+ ${hidden} autre(s)` : "",
    "",
    `Ouvrir l'envoi : ${input.link}`,
    `Disponible jusqu'au ${until}.`,
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");

  return { subject, html, text };
}

export function downloadNoticeMail(input: {
  who: string | null;
  title: string;
  spaceName: string;
}): { subject: string; html: string; text: string } {
  const who = input.who ?? "Quelqu'un (via le lien partagé)";
  const subject = input.who
    ? `${input.who} a téléchargé "${input.title}"`
    : `"${input.title}" a été téléchargé`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px 12px;background:#f4f1fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;">
<tr><td style="padding:24px;font-size:15px;line-height:1.5;color:#16181d;">
<p style="margin:0 0 8px;font-size:13px;color:#6c7484;">Séminaire · ${esc(input.spaceName)}</p>
<p style="margin:0;"><strong>${esc(who)}</strong> a téléchargé ton envoi <strong>${esc(input.title)}</strong>.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = `${who} a téléchargé ton envoi "${input.title}".`;
  return { subject, html, text };
}
