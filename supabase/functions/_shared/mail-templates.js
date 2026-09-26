// Gabarits des emails WeshTransfer.
// JS pur (pas TS) : importé par les Edge Functions (Deno) ET par
// dev/emails.html, qui les affiche dans le navigateur avec des données
// fictives. Pas de guillemets typographiques ici : les chevrons français
// passent par \u00AB et \u00BB.
//
// Mise en page email classique : tableaux, styles en ligne, couleurs en
// double (bgcolor + style) pour les clients qui ignorent l'un ou l'autre.
// Pensé sombre d'office (l'identité est noire) ; le logo est une image PNG
// (le SVG ne passe pas dans Gmail) avec un texte de secours stylé.

const C = {
  bg: "#0E0B14", card: "#16141B", raised: "#1D1A23", tile: "#221E2B",
  line: "#2A2632", rule: "#25222C",
  text: "#ECEAF0", soft: "#B7B1C4", faint: "#8A8398",
  accent: "#7B5CE6", bright: "#A48BFF",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const DISPLAY = "Outfit,'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'IBM Plex Mono',Menlo,Consolas,monospace";
const LQ = "\u00AB\u00A0";
const RQ = "\u00A0\u00BB";

// ------------------------------------------------------------ formatage

// Noms choisis par un inconnu (nom d'espace, blaze) dans un email : les
// messageries transforment "arnaque.com" ou "http://..." en lien cliquable.
// Une espace invisible après le point ou les deux-points l'empêche, sans
// changer ce qui s'affiche.
export function defang(value) {
  return String(value ?? "")
    .replace(/:\/\//g, ":/\u200B/")
    .replace(/([A-Za-z0-9])\.([A-Za-z]{2,})/g, "$1.\u200B$2")
    .replace(/@/g, "@\u200B");
}

export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return bytes + " o";
  const units = ["Ko", "Mo", "Go"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "")).replace(".", ",") + " " + units[i];
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

const KIND_LABEL = { instru: "Instru", voix: "Voix", freestyle: "Freestyle", mix: "Mix", stems: "Stems" };

// Même classement que js/files.js, réduit à ce dont l'email a besoin.
const CATS = [
  ["Audio", ["mp3", "wav", "aif", "aiff", "m4a", "flac", "ogg", "opus", "aac"]],
  ["Image", ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "psd", "tif", "tiff"]],
  ["Vidéo", ["mp4", "mov", "m4v", "webm", "mkv", "avi"]],
  ["Document", ["pdf", "doc", "docx", "txt", "rtf", "pages", "xls", "xlsx", "csv"]],
  ["Archive", ["zip", "rar", "7z", "tar", "gz"]],
  ["Projet", ["als", "flp", "logicx", "ptx", "cpr", "rpp", "song", "band", "mid", "midi"]],
];

function extOf(name) {
  return ((/\.([a-z0-9]+)$/i.exec(name) || [])[1] || "").toLowerCase();
}

export function typeLabel(name, kind) {
  const ext = extOf(name);
  const found = CATS.find(([, list]) => list.includes(ext));
  const cat = found ? found[0] : "Fichier";
  return cat === "Audio" && KIND_LABEL[kind] ? KIND_LABEL[kind] : cat;
}

function lines(text) {
  return esc(text).replace(/\r?\n/g, "<br>");
}

// ------------------------------------------------------------ briques

function eyebrow(text) {
  return `<p style="margin:0 0 14px;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:2px;text-transform:uppercase;color:${C.bright};">${text}</p>`;
}

function heading(text) {
  return `<h1 class="wt-h1" style="margin:0;font-family:${DISPLAY};font-size:34px;line-height:1.06;font-weight:800;letter-spacing:-1px;color:${C.text};">${text}</h1>`;
}

function para(html, extra) {
  return `<p style="margin:${extra || "16px 0 0"};font-family:${SANS};font-size:16px;line-height:1.55;color:${C.soft};">${html}</p>`;
}

function small(html, extra) {
  return `<p style="margin:${extra || "14px 0 0"};font-family:${SANS};font-size:13px;line-height:1.55;color:${C.faint};">${html}</p>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="wt-btn" style="margin:28px 0 0;"><tr>` +
    `<td align="center" bgcolor="${C.accent}" style="border-radius:12px;background:${C.accent};">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:17px 30px;font-family:${SANS};font-size:16px;line-height:1;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:12px;">${label}</a>` +
    `</td></tr></table>`;
}

function layout(o) {
  const site = o.site;
  const filler = "&#847;&zwnj;&nbsp;".repeat(60);
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(o.title)}</title>
<style>
@font-face{font-family:'Outfit';font-style:normal;font-weight:500 900;src:url(${site}/fonts/outfit-normal-500-900-latin.woff2) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:400;src:url(${site}/fonts/ibm-plex-mono-normal-400-latin.woff2) format('woff2')}
:root{color-scheme:dark;supported-color-schemes:dark}
body{margin:0!important;padding:0!important;width:100%!important;background:${C.bg}}
a{color:${C.bright}}
@media (max-width:620px){
.wt-pad{padding-left:22px!important;padding-right:22px!important}
.wt-h1{font-size:28px!important}
.wt-code{font-size:32px!important;letter-spacing:7px!important;padding-left:17px!important}
.wt-btn{width:100%!important}
.wt-btn a{display:block!important}
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
<div style="max-height:0;max-width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.bg};">${esc(o.preheader)}${filler}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 12px 44px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="wt-pad" style="padding:0 6px 22px;">
<a href="${site}/" style="text-decoration:none;"><img src="${site}/img/mail/logo.png" width="196" alt="WeshTransfer" style="display:block;width:196px;max-width:100%;height:auto;border:0;color:${C.bright};font-family:${DISPLAY};font-size:22px;font-weight:800;"></a>
</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:18px;overflow:hidden;">
<img src="${site}/img/mail/scene.jpg" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:17px 17px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td class="wt-pad" style="padding:34px 40px 40px;">
${o.body}
</td></tr></table>
</td></tr>
<tr><td class="wt-pad" style="padding:26px 6px 0;font-family:${MONO};font-size:11px;line-height:1.7;color:${C.faint};">
${o.footer || ""}
<p style="margin:14px 0 0;">WeshTransfer, le transfert de fichiers le moins écoresponsable du marché.<br><a href="${site}/" style="color:${C.faint};">weshtransfer.fr</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

// Petit bloc de texte brut commun à la fin des versions texte.
function textFooter(site) {
  return `--\nWeshTransfer, le transfert de fichiers le moins écoresponsable du marché.\n${site}`;
}

function tidy(parts) {
  // lignes vides simples, jamais doublées
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ------------------------------------------------------------- l'envoi

// input : { site, to?, sender, senderEmail?, title, message, files: [{ name, kind, size }],
//           link, expiresAt, canReply }
export function transferMail(input) {
  const site = input.site;
  const count = input.files.length;
  const total = input.files.reduce((sum, f) => sum + (f.size || 0), 0);
  const countLabel = count > 1 ? `${count} fichiers` : "1 fichier";
  const until = formatDate(input.expiresAt);
  const shown = input.files.slice(0, 8);
  const hidden = count - shown.length;

  const subject = `${input.sender} t'a envoyé ${LQ}${input.title}${RQ}`;
  const preheader = input.untilDownload
    ? `${countLabel}, ${formatBytes(total)}. Attention : autodestruction au premier téléchargement complet.`
    : `${countLabel}, ${formatBytes(total)}. Écoute avant de télécharger, jusqu'au ${until}.`;

  const rows = shown.map((f) => {
    const ext = (extOf(f.name) || "?").slice(0, 4).toUpperCase();
    return `<tr>
<td width="50" valign="top" style="padding:14px 0;border-bottom:1px solid ${C.rule};">
<div style="width:38px;height:38px;border-radius:9px;background:${C.tile};color:${C.bright};font-family:${MONO};font-size:10px;line-height:38px;letter-spacing:.5px;text-align:center;">${esc(ext)}</div>
</td>
<td valign="middle" style="padding:14px 0;border-bottom:1px solid ${C.rule};">
<div style="font-family:${SANS};font-size:15px;line-height:1.35;font-weight:500;color:${C.text};word-break:break-all;">${esc(f.name)}</div>
<div style="margin-top:3px;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:1px;text-transform:uppercase;color:${C.faint};">${esc(typeLabel(f.name, f.kind))}${f.size ? " · " + esc(formatBytes(f.size)) : ""}</div>
</td></tr>`;
  }).join("");
  const more = hidden > 0
    ? `<tr><td colspan="2" style="padding:14px 0 0;font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.faint};">+ ${hidden} autre${hidden > 1 ? "s" : ""} dans l'envoi</td></tr>`
    : "";

  const message = input.message && input.message.trim()
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr>` +
      `<td style="border-left:3px solid ${C.accent};padding:2px 0 2px 18px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.text};">${lines(input.message.trim())}</td>` +
      `</tr></table>`
    : "";

  const body =
    eyebrow(`${esc(countLabel)} · ${esc(formatBytes(total))}`) +
    heading(esc(input.title)) +
    para(`<strong style="color:${C.text};font-weight:600;">${esc(input.sender)}</strong>` +
      (input.senderEmail ? ` <span style="color:${C.faint};">(${esc(input.senderEmail)}, adresse vérifiée)</span>` : "") +
      ` t'a envoyé ${count > 1 ? "des fichiers" : "un fichier"}. Écoute avant de télécharger, sans compte.`) +
    message +
    button(input.link, "Écouter et télécharger&nbsp;&rarr;") +
    small(input.untilDownload
      ? "Autodestruction : chaque fichier est effacé dès qu'il a été téléchargé en entier. Un seul essai, garde-le bien."
      : `Disponible jusqu'au ${esc(until)}. Après, on libère la place pour la prochaine fournée de charbon.`) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0;border-top:1px solid ${C.line};">${rows}${more}</table>` +
    (input.canReply ? small(`Réponds à cet email pour écrire directement à ${esc(input.sender)}.`, "22px 0 0") : "");

  const footer =
    `<p style="margin:0;">Le bouton ne marche pas ? Copie ce lien :<br><a href="${esc(input.link)}" style="color:${C.soft};word-break:break-all;">${esc(input.link)}</a></p>` +
    `<p style="margin:14px 0 0;">Tu reçois cet email parce que ${esc(input.sender)} a saisi ton adresse${input.to ? " (" + esc(input.to) + ")" : ""} sur WeshTransfer. On ne t'écrira pour rien d'autre.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });

  const text = tidy([
    `${input.sender}${input.senderEmail ? " (" + input.senderEmail + ", adresse vérifiée)" : ""} t'a envoyé ${countLabel} : ${input.title}`,
    "",
    input.message && input.message.trim() ? input.message.trim() + "\n" : "",
    ...shown.map((f) => `- ${f.name} (${typeLabel(f.name, f.kind)}${f.size ? ", " + formatBytes(f.size) : ""})`),
    hidden > 0 ? `+ ${hidden} autre(s)` : "",
    "",
    `Écouter et télécharger : ${input.link}`,
    input.untilDownload
      ? "Autodestruction : chaque fichier est effacé dès qu'il a été téléchargé en entier. Un seul essai, garde-le bien."
      : `Disponible jusqu'au ${until}.`,
    input.canReply ? `\nRéponds à cet email pour écrire directement à ${input.sender}.` : "",
    "",
    textFooter(site),
  ]);

  return { subject, html, text };
}

// ------------------------------------------------ code de vérification

// input : { site, email, code, minutes, purpose? }
// purpose : "pour rejoindre le salon Villa septembre" (sinon : envoyer des fichiers)
export function verifyCodeMail(input) {
  const site = input.site;
  const code = String(input.code);
  const subject = `${code} est ton code WeshTransfer`;
  const why = defang(input.purpose || "pour envoyer tes fichiers");
  const preheader = `Valable ${input.minutes} minutes. À taper dans WeshTransfer ${why}.`;

  const body =
    eyebrow("Vérification") +
    heading("Ton code") +
    para(`Tape-le dans WeshTransfer ${esc(why)} : il confirme que <strong style="color:${C.text};font-weight:600;">${esc(input.email)}</strong> est bien à toi. Une seule fois par appareil.`) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr>` +
    `<td align="center" class="wt-code" bgcolor="${C.raised}" style="background:${C.raised};border:1px solid ${C.line};border-radius:14px;padding:24px 10px 24px 22px;font-family:${MONO};font-size:40px;line-height:1;font-weight:600;letter-spacing:12px;color:${C.text};">${esc(code)}</td>` +
    `</tr></table>` +
    small(`Valable ${input.minutes} minutes.`, "16px 0 0") +
    small("Ce n'est pas toi ? Ignore ce message : rien ne partira en ton nom.", "6px 0 0");

  const footer = `<p style="margin:0;">Cet email t'est envoyé parce que quelqu'un a demandé à vérifier cette adresse sur WeshTransfer.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    `Ton code WeshTransfer : ${code}`,
    "",
    `Tape-le dans WeshTransfer ${why} : il confirme que ${input.email} est bien à toi. Valable ${input.minutes} minutes.`,
    "Ce n'est pas toi ? Ignore ce message : rien ne partira en ton nom.",
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// ---------------------------------------------------------- invitation

// input : { site, email, host, spaceName, mode ("seminaire" | "revue"), link, expiresAt }
export function inviteMail(input) {
  const site = input.site;
  // l'hôte n'a rien prouvé : nom d'espace et blaze sans lien possible
  input = Object.assign({}, input, { host: defang(input.host), spaceName: defang(input.spaceName) });
  const revue = input.mode === "revue";
  const subject = revue
    ? `${input.host} attend ton verdict sur ${LQ}${input.spaceName}${RQ}`
    : `${input.host} t'invite dans le séminaire ${LQ}${input.spaceName}${RQ}`;
  const preheader = revue
    ? "Écoute le mix et laisse tes retours à la seconde près."
    : "Sons, versions et commentaires du groupe, en temps réel.";
  const until = formatDate(input.expiresAt);

  const body =
    eyebrow(revue ? "Verdict" : "Séminaire") +
    heading(esc(input.spaceName)) +
    para(`<strong style="color:${C.text};font-weight:600;">${esc(input.host)}</strong> t'invite à le rejoindre. ` +
      (revue
        ? "Tu écoutes les mix, tu mets en pause là où quelque chose cloche, et tu écris : l'ingé retrouve chaque retour à la seconde près."
        : "Chacun y dépose ses sons ; versions et commentaires arrivent chez tout le monde en temps réel.")) +
    button(input.link, "Rejoindre&nbsp;&rarr;") +
    small(`Pour vérifier que c'est bien toi, on t'enverra un code à 6 chiffres à cette adresse (${esc(input.email)}). ` +
      "Une seule fois par appareil ; ensuite, tu entres directement.") +
    small(`Invitation valable jusqu'au ${esc(until)}. Elle ne marche qu'avec cette adresse : la transférer ne sert à rien.`, "10px 0 0");

  const footer =
    `<p style="margin:0;">Le bouton ne marche pas ? Copie ce lien :<br><a href="${esc(input.link)}" style="color:${C.soft};word-break:break-all;">${esc(input.link)}</a></p>` +
    `<p style="margin:14px 0 0;">Tu reçois cet email parce que ${esc(input.host)} a saisi ton adresse sur WeshTransfer. Pas intéressé ? Ignore-le, rien ne se passera.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    revue ? `${input.host} attend ton verdict sur "${input.spaceName}".` : `${input.host} t'invite dans le séminaire "${input.spaceName}".`,
    "",
    `Rejoindre : ${input.link}`,
    "",
    `Pour vérifier que c'est bien toi, on t'enverra un code à 6 chiffres à ${input.email}. Une seule fois par appareil.`,
    `Invitation valable jusqu'au ${until}. Elle ne marche qu'avec cette adresse.`,
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// ---------------------------------------- récapitulatif pour l'ingé son

function clock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

const TAG_NAMES = {
  voix: "Voix", instru: "Instru", basse: "Basse", batterie: "Batterie",
  effets: "Effets", niveau: "Volume", structure: "Structure", autre: "Autre",
};

// input : { site, spaceName, artists: ["Kenza"], projects: [{ title, link,
//   items: [{ kind: "new" | "reopen" | "reply", at, tag, body, author, version }],
//   verified, approved: { version, by } | null }] }
export function reviewDigestMail(input) {
  const site = input.site;
  const who = input.artists.length ? input.artists.join(", ") : "L'artiste";
  const count = (k) => input.projects.reduce((s, p) => s + p.items.filter((i) => i.kind === k).length, 0);
  const news = count("new"), reopened = count("reopen");
  const verified = input.projects.reduce((s, p) => s + (p.verified || 0), 0);
  const approved = input.projects.filter((p) => p.approved);
  const one = input.projects.length === 1 ? input.projects[0].title : null;

  const subject = approved.length && !news && !reopened
    ? `${who} a validé ${LQ}${approved[0].title}${RQ}`
    : `${who} a fait ses retours sur ${LQ}${one || input.spaceName}${RQ}`;
  const bits = [
    news ? `${news} nouveau${news > 1 ? "x" : ""} retour${news > 1 ? "s" : ""}` : "",
    reopened ? `${reopened} pas encore réglé${reopened > 1 ? "s" : ""}` : "",
    verified ? `${verified} correction${verified > 1 ? "s" : ""} validée${verified > 1 ? "s" : ""}` : "",
    approved.length ? "mix validé" : "",
  ].filter(Boolean);
  const preheader = bits.join(", ") + ".";

  const badge = (text, color) =>
    `<span style="display:inline-block;padding:2px 7px;border-radius:99px;border:1px solid ${color};color:${color};font-family:${MONO};font-size:10px;line-height:1.4;letter-spacing:1px;text-transform:uppercase;">${text}</span>`;
  const row = (i) => {
    const time = i.at != null
      ? `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:${C.tile};color:${C.bright};font-family:${MONO};font-size:12px;">${clock(i.at)}</span> `
      : "";
    const tag = i.tag ? `<span style="color:${C.faint};font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;">${esc(TAG_NAMES[i.tag] || i.tag)}</span> ` : "";
    const lead = i.kind === "reopen" ? badge("Pas encore réglé", "#E2B55A") + " "
      : i.kind === "reply" ? `<span style="color:${C.faint};">&#8627; réponse</span> ` : "";
    return `<tr><td style="padding:12px 0;border-bottom:1px solid ${C.rule};font-family:${SANS};font-size:15px;line-height:1.5;color:${C.text};">` +
      `<div style="margin-bottom:4px;">${lead}${time}${tag}</div>${esc(i.body)}` +
      `<div style="margin-top:3px;font-size:12px;color:${C.faint};">${esc(i.author || "")}${i.version ? " · " + esc(i.version) : ""}</div></td></tr>`;
  };

  const blocks = input.projects.map((p) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">` +
      `<tr><td style="padding:0 0 8px;border-bottom:1px solid ${C.line};">` +
        `<span style="font-family:${DISPLAY};font-size:20px;font-weight:700;color:${C.text};">${esc(p.title)}</span></td></tr>` +
      (p.approved
        ? `<tr><td style="padding:12px 14px;background:#16261C;border-radius:0 0 10px 10px;font-family:${SANS};font-size:15px;color:#6FCF8E;">&#10003; <strong>${esc(p.approved.version)} validée</strong> par ${esc(p.approved.by || "l'artiste")}</td></tr>`
        : "") +
      p.items.map(row).join("") +
      (p.verified
        ? `<tr><td style="padding:12px 0 0;font-family:${SANS};font-size:14px;color:#6FCF8E;">&#10003; ${p.verified} correction${p.verified > 1 ? "s" : ""} validée${p.verified > 1 ? "s" : ""} par l'artiste</td></tr>`
        : "") +
      `<tr><td style="padding:14px 0 0;"><a href="${esc(p.link)}" style="color:${C.bright};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;">Ouvrir ${esc(p.title)}&nbsp;&rarr;</a></td></tr>` +
    `</table>`).join("");

  const body =
    eyebrow("Verdict · " + esc(input.spaceName)) +
    heading(approved.length && !news && !reopened ? "C'est validé." : `${esc(who)} a fait ses retours.`) +
    para(esc(bits.join(" · "))) +
    button(input.projects[0].link, "Voir les retours&nbsp;&rarr;") +
    blocks +
    small("Les liens s'ouvrent sur l'appareil avec lequel tu es dans l'espace.", "24px 0 0");

  const footer = `<p style="margin:0;">Tu reçois cet email parce que tu as activé les notifications dans ${LQ}${esc(input.spaceName)}${RQ}. Pour les couper : l'icône enveloppe, en haut de l'espace.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    `${who} a fait ses retours (${bits.join(", ")}).`,
    ...input.projects.map((p) => [
      "",
      `== ${p.title}`,
      p.approved ? `VALIDÉ : ${p.approved.version} par ${p.approved.by || "l'artiste"}` : "",
      ...p.items.map((i) => `- ${i.kind === "reopen" ? "[pas encore réglé] " : i.kind === "reply" ? "[réponse] " : ""}${i.at != null ? clock(i.at) + " " : ""}${i.tag ? "[" + (TAG_NAMES[i.tag] || i.tag) + "] " : ""}${i.body} (${i.author || ""})`),
      p.verified ? `${p.verified} correction(s) validée(s) par l'artiste.` : "",
      `Ouvrir : ${p.link}`,
    ].join("\n")),
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// ------------------------------------------ avis de premier téléchargement

// input : { site, who, title }
// ------------------------------------------------------ avis à l'expéditeur
// Une blague de pollution par avis, tirée au hasard (pick peut être fixé
// pour les aperçus et les tests).

const OPEN_JOKES = [
  "Pour afficher la page, on a rallumé une turbine. Elle te salue.",
  "Quelque part, un ours polaire a senti un léger courant d'air chaud.",
  "Les serveurs ont chauffé pour l'occasion : un glaçon de plus a fondu.",
  "La centrale a lâché un petit nuage de joie. Noir, le nuage.",
  "Ouverture confirmée. Le compteur de CO₂ a fait un bond, lui aussi.",
];
const SENT_JOKES = [
  "Le jet a décollé, plein de kérosène, avec tes fichiers en première classe.",
  "Tes fichiers voyagent en jet privé. Seuls à bord, clim à fond.",
  "Décollage réussi. Les nuages derrière, c'est nous.",
  "On a allumé la centrale rien que pour toi. Elle tourne encore.",
];
const DOWNLOAD_JOKES = [
  "Pour l'occasion, on a brûlé un peu plus de charbon. Ça se fête.",
  "Livraison effectuée par jet privé. Retour à vide, évidemment.",
  "Les ventilateurs des serveurs applaudissent. Bruyamment.",
];
function joke(list, pick) {
  const i = Number.isInteger(pick) ? pick : Math.floor(Math.random() * list.length);
  return list[((i % list.length) + list.length) % list.length];
}

// Bloc "bilan carbone" : la même blague que l'appli, en encadré.
function carbonBox(text) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr>` +
    `<td bgcolor="${C.raised}" style="background:${C.raised};border:1px dashed ${C.line};border-radius:12px;padding:14px 16px;font-family:${MONO};font-size:12px;line-height:1.6;color:${C.soft};">${text}</td>` +
    `</tr></table>`;
}

// Confirmation d'envoi, pour l'expéditeur, avec le lien.
// input : { site, title, link, files: [{ name, kind, size }], recipients: [{ email, ok }],
//           expiresAt, pick? }
export function sentConfirmMail(input) {
  const site = input.site;
  const count = input.files.length;
  const total = input.files.reduce((sum, f) => sum + (f.size || 0), 0);
  const countLabel = count > 1 ? `${count} fichiers` : "1 fichier";
  const until = formatDate(input.expiresAt);
  const sent = input.recipients.filter((r) => r.ok);
  const failed = input.recipients.filter((r) => !r.ok);
  // un aller-retour Paris-Dubaï en jet par tranche de 50 Mo : pure blague
  const trips = Math.max(1, Math.round(total / (50 * 1024 * 1024))) * Math.max(1, sent.length);

  const subject = `Ton envoi ${LQ}${input.title}${RQ} a décollé`;
  const preheader = sent.length
    ? `${countLabel}, ${formatBytes(total)}, en route vers ${sent.length} personne${sent.length > 1 ? "s" : ""}. Le lien est dedans.`
    : `${countLabel}, ${formatBytes(total)}. Ton lien est prêt, il est dedans.`;

  const who = sent.length
    ? ` est en route vers <strong style="color:${C.text};font-weight:600;">${sent.length} personne${sent.length > 1 ? "s" : ""}</strong>.`
    : " est prêt. Partage le lien où tu veux.";
  const list = input.recipients.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;border-top:1px solid ${C.line};">` +
      input.recipients.map((r) => `<tr>` +
        `<td style="padding:11px 0;border-bottom:1px solid ${C.rule};font-family:${SANS};font-size:14px;color:${C.text};word-break:break-all;">${esc(r.email)}</td>` +
        `<td align="right" style="padding:11px 0;border-bottom:1px solid ${C.rule};font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${r.ok ? C.bright : "#E2B55A"};white-space:nowrap;">${r.ok ? "envoyé" : "échec"}</td>` +
        `</tr>`).join("") + `</table>`
    : "";

  const body =
    eyebrow(`Envoi parti · ${esc(countLabel)} · ${esc(formatBytes(total))}`) +
    heading("Décollage réussi.") +
    para(`<strong style="color:${C.text};font-weight:600;">${LQ}${esc(input.title)}${RQ}</strong>${who} ${esc(joke(SENT_JOKES, input.pick))}`) +
    button(input.link, "Voir le transfert&nbsp;&rarr;") +
    `<p style="margin:14px 0 0;font-family:${MONO};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${esc(input.link)}" style="color:${C.soft};">${esc(input.link)}</a></p>` +
    list +
    (failed.length ? small(`${failed.length} adresse${failed.length > 1 ? "s n'ont" : " n'a"} pas reçu l'email : envoie-leur le lien toi-même.`) : "") +
    carbonBox(`Bilan carbone de cet envoi : l'équivalent de ${trips} aller${trips > 1 ? "s" : ""}-retour${trips > 1 ? "s" : ""} Paris-Dubaï en jet privé.<br><span style="color:${C.faint};">Estimation totalement fantaisiste. Culpabilité bien réelle.</span>`) +
    small((input.untilDownload
      ? "Disponible jusqu'au premier téléchargement complet, puis détruit."
      : `Disponible jusqu'au ${esc(until)}.`) + " Tu seras prévenu à la première ouverture et au premier téléchargement.", "22px 0 0");

  const footer = `<p style="margin:0;">Tu reçois cet email parce que tu viens d'envoyer des fichiers avec WeshTransfer depuis cette adresse.</p>`;
  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    `Ton envoi "${input.title}" a décollé (${countLabel}, ${formatBytes(total)}).`,
    sent.length ? `En route vers : ${sent.map((r) => r.email).join(", ")}.` : "Ton lien est prêt : partage-le où tu veux.",
    failed.length ? `Pas reçu : ${failed.map((r) => r.email).join(", ")}. Envoie-leur le lien toi-même.` : "",
    "",
    `Le lien : ${input.link}`,
    input.untilDownload ? "Disponible jusqu'au premier téléchargement complet, puis détruit." : `Disponible jusqu'au ${until}.`,
    "",
    `Bilan carbone : ${trips} aller${trips > 1 ? "s" : ""}-retour${trips > 1 ? "s" : ""} Paris-Dubaï en jet privé. Estimation totalement fantaisiste.`,
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// Première ouverture d'un envoi (lien personnel d'un destinataire, ou lien
// partagé). input : { site, who (email ou null), title, pick? }
export function openNoticeMail(input) {
  const site = input.site;
  const who = input.who || null;
  const subject = who
    ? `${who} a ouvert ${LQ}${input.title}${RQ}`
    : `Ton lien ${LQ}${input.title}${RQ} vient d'être ouvert`;
  const preheader = "Première ouverture de ton envoi. Les suivantes, on ne te dérange pas.";
  const line = joke(OPEN_JOKES, input.pick);

  const body =
    eyebrow("Ouvert") +
    heading(who ? "C'est ouvert." : "Quelqu'un a cliqué.") +
    para((who ? `<strong style="color:${C.text};font-weight:600;">${esc(who)}</strong> vient d'ouvrir` : "Ton lien partagé vient d'être ouvert : quelqu'un regarde") +
      ` ton envoi <strong style="color:${C.text};font-weight:600;">${LQ}${esc(input.title)}${RQ}</strong>.`) +
    carbonBox(esc(line)) +
    small((who ? "Tu seras prévenu quand il téléchargera." : "Tu seras prévenu au premier téléchargement.") + " Pour les ouvertures suivantes, on ne te dérange pas.", "20px 0 0") +
    button(`${site}/app.html#/transfers`, "Voir mes envois&nbsp;&rarr;");

  const footer = `<p style="margin:0;">Tu reçois cet avis parce que tu as envoyé des fichiers avec WeshTransfer en donnant cette adresse.</p>`;
  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    who ? `${who} vient d'ouvrir ton envoi "${input.title}".` : `Ton lien "${input.title}" vient d'être ouvert.`,
    line,
    "",
    `Voir mes envois : ${site}/app.html#/transfers`,
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

export function downloadNoticeMail(input) {
  const site = input.site;
  const who = input.who || null;
  const subject = who
    ? `${who} a téléchargé ${LQ}${input.title}${RQ}`
    : `${LQ}${input.title}${RQ} a été téléchargé`;
  const preheader = "Premier téléchargement de ton envoi. On ne te préviendra pas pour les suivants.";

  const body =
    eyebrow("Téléchargé") +
    heading(who ? "C'est récupéré." : "Quelqu'un a récupéré tes fichiers.") +
    para((who ? `<strong style="color:${C.text};font-weight:600;">${esc(who)}</strong> vient de télécharger` : "Ton lien partagé vient de servir pour télécharger") +
      ` ton envoi <strong style="color:${C.text};font-weight:600;">${LQ}${esc(input.title)}${RQ}</strong>.`) +
    carbonBox(esc(joke(DOWNLOAD_JOKES, input.pick))) +
    small("C'est le premier téléchargement : pour les suivants, on ne te dérange pas.", "20px 0 0") +
    button(`${site}/app.html#/transfers`, "Voir mes envois&nbsp;&rarr;") +
    small("Le suivi des envois s'ouvre sur l'appareil qui a servi à envoyer.");

  const footer = `<p style="margin:0;">Tu reçois cet avis parce que tu as envoyé des fichiers avec WeshTransfer en donnant cette adresse.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    who ? `${who} a téléchargé ton envoi "${input.title}".` : `Ton envoi "${input.title}" a été téléchargé.`,
    "C'est le premier téléchargement : pour les suivants, on ne te dérange pas.",
    "",
    `Voir mes envois : ${site}/app.html#/transfers`,
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// Fichier d'un envoi "jusqu'au premier téléchargement" : récupéré en
// entier, donc détruit. input : { site, who, title, file }
export function burnNoticeMail(input) {
  const site = input.site;
  const who = input.who || null;
  const subject = `${LQ}${input.file}${RQ} récupéré, puis détruit`;
  const preheader = "Premier téléchargement complet : le fichier n'existe plus chez nous.";

  const body =
    eyebrow("Autodestruction") +
    heading("Récupéré. Et pulvérisé.") +
    para((who ? `<strong style="color:${C.text};font-weight:600;">${esc(who)}</strong> a téléchargé` : "Quelqu'un a téléchargé") +
      ` <strong style="color:${C.text};font-weight:600;">${LQ}${esc(input.file)}${RQ}</strong> en entier` +
      ` (envoi ${LQ}${esc(input.title)}${RQ}). Comme prévu, on l'a effacé de nos serveurs : le lien ne le propose plus.`) +
    carbonBox("Un fichier de moins sur nos serveurs : la centrale a baissé d'un degré. Ça ne durera pas.") +
    button(`${site}/app.html#/transfers`, "Voir mes envois&nbsp;&rarr;");

  const footer = `<p style="margin:0;">Tu reçois cet avis parce que tu as envoyé des fichiers avec WeshTransfer en donnant cette adresse.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    `${who ? who + " a téléchargé" : "Quelqu'un a téléchargé"} "${input.file}" en entier (envoi "${input.title}").`,
    "Comme prévu, le fichier est effacé de nos serveurs.",
    "",
    `Voir mes envois : ${site}/app.html#/transfers`,
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}

// Verdict, côté artiste : l'ingé a déposé de nouvelles versions (un seul
// email, 10 minutes après son dernier dépôt). input : { site, spaceName,
// engineer, projects: [{ title, version, label, fixed, replies, link }] }
export function newVersionsMail(input) {
  const site = input.site;
  const who = input.engineer || "L'ingé";
  const n = input.projects.length;
  const one = n === 1 ? input.projects[0] : null;
  const fixed = input.projects.reduce((s, p) => s + (p.fixed || 0), 0);

  const subject = one
    ? `Nouvelle version de ${LQ}${one.title}${RQ} (${one.version})`
    : `${n} nouvelles versions dans ${LQ}${input.spaceName}${RQ}`;
  const preheader = one
    ? `${who} a déposé la ${one.version} de ${one.title}${one.fixed ? `, ${one.fixed} correction${one.fixed > 1 ? "s" : ""} faite${one.fixed > 1 ? "s" : ""}` : ""}. À toi d'écouter.`
    : `${who} a déposé ${n} nouvelles versions${fixed ? `, ${fixed} correction${fixed > 1 ? "s" : ""} faite${fixed > 1 ? "s" : ""}` : ""}. À toi d'écouter.`;

  const rows = input.projects.map((p) =>
    `<tr><td style="padding:14px 0;border-bottom:1px solid ${C.rule};">` +
      `<div style="font-family:${DISPLAY};font-size:18px;font-weight:700;color:${C.text};">${esc(p.title)} ` +
        `<span style="display:inline-block;padding:1px 7px;border-radius:99px;background:${C.tile};color:${C.bright};font-family:${MONO};font-size:12px;vertical-align:middle;">${esc(p.version)}</span></div>` +
      (p.label ? `<div style="margin-top:3px;font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${C.faint};">${esc(p.label)}</div>` : "") +
      (p.fixed ? `<div style="margin-top:6px;font-family:${SANS};font-size:14px;color:#6FCF8E;">&#10003; ${p.fixed} correction${p.fixed > 1 ? "s" : ""} faite${p.fixed > 1 ? "s" : ""} : à vérifier</div>` : "") +
      (p.replies ? `<div style="margin-top:4px;font-family:${SANS};font-size:14px;color:${C.faint};">&#8627; ${p.replies} réponse${p.replies > 1 ? "s" : ""} à tes retours</div>` : "") +
      `<div style="margin-top:8px;"><a href="${esc(p.link)}" style="color:${C.bright};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;">Écouter ${esc(p.title)}&nbsp;&rarr;</a></div>` +
    `</td></tr>`).join("");

  const body =
    eyebrow("Verdict · " + esc(input.spaceName)) +
    heading(one ? `La ${esc(one.version)} de ${LQ}${esc(one.title)}${RQ} est là.` : "Du nouveau à écouter.") +
    para(`${esc(who)} a déposé ${one ? "une nouvelle version" : `${n} nouvelles versions`}. Écoute, vérifie les corrections, et valide ou redemande.`) +
    button(input.projects[0].link, one ? "Écouter&nbsp;&rarr;" : "Écouter la première&nbsp;&rarr;") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">${rows}</table>` +
    small("Les liens s'ouvrent sur l'appareil avec lequel tu es dans l'espace.", "24px 0 0");

  const footer = `<p style="margin:0;">Tu reçois cet email parce que tu participes au verdict ${LQ}${esc(input.spaceName)}${RQ}. Pour ne plus le recevoir : l'icône enveloppe, en haut de l'espace.</p>`;

  const html = layout({ site, title: subject, preheader, body, footer });
  const text = tidy([
    `${who} a déposé ${one ? "une nouvelle version" : `${n} nouvelles versions`} dans "${input.spaceName}".`,
    ...input.projects.map((p) => [
      "",
      `== ${p.title} (${p.version})${p.label ? " - " + p.label : ""}`,
      p.fixed ? `${p.fixed} correction(s) faite(s) : à vérifier.` : "",
      p.replies ? `${p.replies} réponse(s) à tes retours.` : "",
      `Écouter : ${p.link}`,
    ].join("\n")),
    "",
    textFooter(site),
  ]);
  return { subject, html, text };
}
