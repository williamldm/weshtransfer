// Briques d'interface partagées : DOM, messages, formatage, feuilles.

import { icon } from "./icons.js?v=76";
import { CATEGORY, categoryOf, extOf } from "./files.js?v=76";

// ------------------------------------------------------------------ DOM

export function h(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// alias historique
export const escapeHtml = esc;

// ------------------------------------------------------------- messages

export function toast(message, kind) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = "toast" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.classList.add("out"), kind === "err" ? 5600 : 3000);
  setTimeout(() => el.remove(), kind === "err" ? 6000 : 3400);
}

// Traduit les codes d'erreur du back en français lisible.
const ERRORS = {
  CODE_INVALIDE: "Ce code ne correspond à aucun espace.",
  CONNEXION_ECHEC: "La connexion à ton compte a échoué. Réessaie.",
  INVITATION_REQUISE: "Cet espace est sur invitation : demande à l'hôte de t'inviter par email.",
  INVITATION_INCONNUE: "Cette invitation n'existe pas, ou a été remplacée par une plus récente.",
  INVITATION_EXPIREE: "Cette invitation a expiré. Demande à l'hôte de t'en renvoyer une.",
  QUOTA_INVITATIONS: "Trop d'invitations aujourd'hui. Réessaie demain.",
  ESPACE_INCONNU: "Espace introuvable.",
  ESPACE_EXPIRE: "Cet espace a expiré.",
  ESPACE_VERROUILLE: "Cet espace n'accepte plus de nouveaux arrivants.",
  PSEUDO_PRIS: "Ce blaze est déjà pris ici, choisis-en un autre.",
  SEUL_LE_HOST: "Seul le host de l'espace peut le supprimer.",
  SUPPRESSION_REFUSEE: "Tu ne peux supprimer que ce que tu as posté (ou tout, si tu es host).",
  QUOTA_ESPACES: "Tu as déjà créé 5 espaces aujourd'hui. Même nous, on a des limites.",
  NOM_INVALIDE: "Donne un nom à ton séminaire (60 caractères max).",
  PSEUDO_INVALIDE: "Ton blaze doit faire entre 2 et 24 caractères.",
  NON_AUTHENTIFIE: "Connexion impossible, réessaie.",
  TROP_DE_CONNEXIONS: "Trop de connexions depuis ce réseau, réessaie dans quelques minutes.",
  NON_MEMBRE: "Tu ne fais plus partie de cet espace.",
  TITRE_INVALIDE: "Il faut un titre (80 caractères max).",
  AUCUN_FICHIER: "Choisis au moins un fichier.",
  TROP_DE_FICHIERS: "100 fichiers maximum par envoi.",
  FICHIER_INVALIDE: "Un des fichiers n'est plus disponible.",
  EMAIL_INVALIDE: "Adresse email invalide",
  TROP_DE_DESTINATAIRES: "20 destinataires maximum par envoi.",
  QUOTA_EMAILS: "Limite de 200 emails par jour atteinte pour cet espace.",
  PAS_TON_ENVOI: "Seul l'expéditeur peut faire ça.",
  EMAIL_EXPEDITEUR_REQUIS: "Donne ton email pour envoyer par email.",
  EMAIL_NON_VERIFIE: "Ton email n'est pas encore vérifié.",
  RESERVE_INGE: "Réservé à l'ingé son de cet espace.",
  RESERVE_ARTISTE: "C'est à l'artiste de confirmer cette correction.",
  VALIDATION_ARTISTE: "C'est à l'artiste de valider le mix, pas à celui qui l'a déposé.",
  PAS_CORRIGE: "Ce retour n'a pas encore été corrigé.",
  RETOUR_INCONNU: "Ce retour n'existe plus.",
  EMAIL_INDISPONIBLE: "L'envoi d'emails est coupé pour le moment.",
  TROP_DE_CODES: "Trop de codes demandés. Réessaie dans une heure.",
  ENVOI_CODE_ECHEC: "Le code n'a pas pu partir. Vérifie l'adresse et réessaie.",
  CODE_FAUX: "Ce n'est pas le bon code.",
  TROP_D_ESSAIS_CODE: "Trop de codes essayés. Réessaie dans une heure.",
  DUREE_MAX: "Un espace vit 60 jours au plus, prolongations comprises.",
  CONSERVATION_RETOURS: "La conservation sans limite est réservée aux espaces de retours.",
  QUOTA_CONSERVATION: "Tu as déjà 3 espaces conservés sans limite. Supprimes-en un ou remets-lui une date.",
  ESPACE_PLEIN: "Cet espace a atteint sa taille maximale.",
  TROP_RAPIDE: "Doucement : réessaie dans une minute.",
  QUOTA_ENVOIS: "100 envois par jour et par espace, c'est la limite.",
  QUOTA_UPLOAD_JOUR: "Limite atteinte : 3 Go envoyés par 24 h depuis ta connexion. Même le charbon a ses limites, réessaie plus tard.",
  QUOTA_ESPACE: "Cet espace est plein. Supprime des fichiers ou crée un autre espace.",
  QUOTA_GLOBAL: "La centrale est en surchauffe : trop de fichiers aujourd'hui. Réessaie demain.",
  TROP_D_UPLOADS: "Trop d'uploads en même temps. Attends que les premiers finissent.",
  TAILLE_INCOHERENTE: "Le fichier reçu ne correspond pas à l'original. Réessaie.",
  UPLOAD_INCONNU: "Upload introuvable ou expiré. Réessaie.",
  QUOTA_EMAILS_JOUR: "Tu as atteint la limite d'emails pour aujourd'hui. Partage le lien à la place.",
  CODE_EXPIRE: "Ce code a expiré. Demande-en un nouveau.",
  TROP_D_ESSAIS: "Trop d'essais. Demande un nouveau code.",
  ENVOI_EXPIRE: "Cet envoi a expiré.",
  CHEMIN_INVALIDE: "Chemin de fichier refusé.",
  RESEAU: "Pas de réseau. Vérifie ta connexion.",
  CONFIG_MANQUANTE: "L'appli n'est pas encore reliée à Supabase (js/config.js).",
  CLE_SECRETE_DANS_LE_FRONT: "Clé secrète détectée dans js/config.js : remplace-la par la clé publishable."
};

export function errorText(err) {
  const raw = String((err && err.message) || err || "");
  const match = raw.match(/[A-Z][A-Z_]{4,}/);
  if (match && ERRORS[match[0]]) {
    const extra = raw.split(":").slice(1).join(":").trim();
    return ERRORS[match[0]] + (extra && match[0] === "EMAIL_INVALIDE" ? " : " + extra : "");
  }
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return ERRORS.RESEAU;
  return raw || "Erreur inattendue.";
}

// ------------------------------------------------------------ formatage

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return bytes + " o";
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  // "3 Go" plutôt que "3,0 Go"
  return (value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "")).replace(".", ",") + " " + units[i];
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const s = Math.round(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return hh ? hh + ":" + String(mm).padStart(2, "0") + ":" + ss : mm + ":" + ss;
}

// "il y a 3 min" : en session, savoir si un son date de 2 minutes ou de
// 2 heures compte plus que l'heure exacte.
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 45) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return "il y a " + min + " min";
  const hours = Math.round(min / 60);
  if (hours < 24) return "il y a " + hours + " h";
  const days = Math.round(hours / 24);
  return days === 1 ? "hier" : "il y a " + days + " jours";
}

export function formatDate(iso, withTime) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const opts = { weekday: "long", day: "numeric", month: "long" };
  if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
  return new Intl.DateTimeFormat("fr-FR", opts).format(d);
}

export function daysLeft(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86400000);
}

export function plural(n, one, many) {
  return n + " " + (n > 1 ? many : one);
}

// ------------------------------------------------------ types de fichier

export const KINDS = [
  ["instru", "Instru"],
  ["voix", "Voix"],
  ["freestyle", "Freestyle"],
  ["mix", "Mix"],
  ["stems", "Stems"],
  ["autre", "Autre"]
];

export const KIND_LABEL = Object.fromEntries(KINDS);

export function kindBadge(kind) {
  const k = KIND_LABEL[kind] ? kind : "autre";
  return '<span class="kind kind-' + k + '">' + KIND_LABEL[k] + "</span>";
}

// Badge d'un fichier : le type musical pour l'audio (voix, mix...), la
// catégorie pour le reste (image, vidéo, projet...).
export function fileBadge(name, mime, kind) {
  const cat = categoryOf(name, mime);
  // un zip de stems reste "Stems" : le type musical prime sur le format
  if (cat === "audio" || (cat === "archive" && kind === "stems")) return kindBadge(kind);
  return '<span class="cat cat-' + cat + '">' + CATEGORY[cat].label + "</span>";
}

// Tuile d'icône colorée par catégorie (ou vignette d'image si url fournie).
export function fileTile(name, mime, thumbUrl) {
  const cat = categoryOf(name, mime);
  const ext = (extOf(name) || "").slice(0, 4).toUpperCase();
  const inner = thumbUrl
    ? '<img src="' + esc(thumbUrl) + '" alt="" loading="lazy">'
    : ext ? '<span class="ft-ext">' + esc(ext) + "</span>" : icon(CATEGORY[cat].icon, 18);
  return '<span class="ft ft-' + cat + '">' + inner + "</span>";
}

// Pastille avec initiale, couleur stable par pseudo.
export function avatar(pseudo, online) {
  const name = String(pseudo || "?");
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return '<span class="avatar' + (online ? " is-online" : "") + '" style="--hue:' + hue + '">' +
    esc(name.charAt(0).toUpperCase()) + "</span>";
}

// ------------------------------------------------------- presse-papiers

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
}

// Feuille de partage native sur mobile (WhatsApp, SMS, AirDrop...),
// copie du lien ailleurs.
export async function shareLink(data) {
  if (navigator.share) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") return "cancel";
    }
  }
  const ok = await copyText(data.url);
  toast(ok ? "Lien copié" : "Copie impossible", ok ? "ok" : "err");
  return ok ? "copied" : "fail";
}

export function canShare() {
  return typeof navigator.share === "function";
}

// Déclenche un téléchargement sans quitter la page.
export function triggerDownload(url, name) {
  const a = document.createElement("a");
  a.href = url;
  if (name) a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// --------------------------------------------------------------- feuilles
// Panneau qui monte du bas sur mobile, modale centrée sur grand écran.

export function openSheet(opts) {
  const root = document.getElementById("sheets") || document.body;
  const el = h(
    '<div class="sheet-wrap" role="dialog" aria-modal="true">' +
      '<div class="sheet-backdrop" data-close></div>' +
      '<div class="sheet">' +
        '<div class="sheet-grip" aria-hidden="true"></div>' +
        '<div class="sheet-head"><h2>' + esc(opts.title || "") + '</h2>' +
        '<button class="btn btn-ghost btn-icon" data-close aria-label="Fermer">' + icon("x") + "</button></div>" +
        '<div class="sheet-body"></div>' +
      "</div>" +
    "</div>"
  );
  const body = el.querySelector(".sheet-body");
  if (typeof opts.body === "string") body.innerHTML = opts.body;
  else if (opts.body) body.appendChild(opts.body);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    el.classList.remove("is-open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => el.remove(), 220);
    if (opts.onClose) opts.onClose();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);

  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-open"));
  return { el, body, close };
}

export function confirmSheet(message, options) {
  const o = options || {};
  return new Promise((resolve) => {
    let answered = false;
    const body = h(
      '<div><p class="sheet-text">' + esc(message) + "</p>" +
      '<div class="sheet-actions">' +
        '<button class="btn btn-block" data-no>' + esc(o.cancel || "Annuler") + "</button>" +
        '<button class="btn btn-block ' + (o.danger ? "btn-danger" : "btn-primary") + '" data-yes>' +
          esc(o.ok || "Confirmer") + "</button>" +
      "</div></div>"
    );
    const sheet = openSheet({
      title: o.title || "Confirmer",
      body,
      onClose: () => { if (!answered) resolve(false); }
    });
    body.querySelector("[data-no]").onclick = () => { answered = true; resolve(false); sheet.close(); };
    body.querySelector("[data-yes]").onclick = () => { answered = true; resolve(true); sheet.close(); };
  });
}

// Petite saisie texte dans une feuille (renommer un morceau...).
export function promptSheet(title, value, options) {
  const o = options || {};
  return new Promise((resolve) => {
    let answered = false;
    const body = h(
      '<form><input class="input" maxlength="' + (o.max || 80) + '" value="' + esc(value || "") + '">' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' +
      esc(o.ok || "Enregistrer") + "</button></div></form>"
    );
    const sheet = openSheet({ title, body, onClose: () => { if (!answered) resolve(null); } });
    const input = body.querySelector("input");
    setTimeout(() => { input.focus(); input.select(); }, 60);
    body.addEventListener("submit", (e) => {
      e.preventDefault();
      answered = true;
      resolve(input.value.trim());
      sheet.close();
    });
  });
}

// Menu d'actions (tap long / bouton "...").
export function actionSheet(title, actions) {
  const body = h('<div class="action-list"></div>');
  const sheet = openSheet({ title, body });
  for (const a of actions) {
    if (!a) continue;
    const btn = h('<button class="action-item' + (a.danger ? " is-danger" : "") + '">' +
      icon(a.icon || "chevron") + "<span>" + esc(a.label) + "</span></button>");
    btn.onclick = () => { sheet.close(); a.run(); };
    body.appendChild(btn);
  }
  return sheet;
}
