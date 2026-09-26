// Page publique d'un envoi : ce que voit le destinataire.
// Pas de supabase-js ici : un simple appel à l'Edge Function transfer-open,
// qui vérifie le lien et renvoie des URLs signées. Page légère, rapide en 4G.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=85";
import { Waveform, formatTime } from "./waveform.js?v=85";
import { saveZip, canStreamToDisk, MEMORY_LIMIT } from "./zip.js?v=85";
import { icon } from "./icons.js?v=85";
import { esc, formatBytes, formatDuration, formatDate, plural, toast, triggerDownload, avatar, fileBadge, fileTile } from "./ui.js?v=85";
import { categoryOf, canPreview } from "./files.js?v=85";

const root = document.getElementById("tp");
// le jeton : lien court /t/<jeton>, ou ancien t.html?k=<jeton>
const k = (location.pathname.match(/^\/t\/([A-Za-z0-9]+)\/?$/) || [])[1] || new URLSearchParams(location.search).get("k") || "";
const ENDPOINT = SUPABASE_URL + "/functions/v1/transfer-open";

// Session de l'appli sur cet appareil, s'il y en a une : sert seulement à
// reconnaître l'expéditeur qui ouvre son propre lien (pas d'avis "ouvert").
function session() {
  try {
    const s = JSON.parse(localStorage.getItem("seminaire.auth") || "null");
    return (s && s.access_token) || "";
  } catch (err) {
    return "";
  }
}

function call(body, keepalive) {
  const headers = { "Content-Type": "application/json" };
  if (SUPABASE_PUBLISHABLE_KEY) headers.apikey = SUPABASE_PUBLISHABLE_KEY;
  const token = session();
  if (token) headers.Authorization = "Bearer " + token;
  return fetch(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body), keepalive: !!keepalive });
}

// Compté côté serveur (l'expéditeur est prévenu au premier téléchargement).
// keepalive : la requête survit au départ vers le fichier.
function registerDownload() {
  call({ k, action: "download" }, true).catch(() => {});
}

function fail(title, text) {
  root.innerHTML = '<div class="tp-state">' + icon("alert", 40) + "<h1>" + esc(title) + "</h1><p>" + esc(text) + "</p></div>";
}

// ------------------------------------------------------------ lecture

const audio = new Audio();
audio.preload = "none";
let current = null;       // id du fichier en cours
const waves = new Map();
let data = null;

function playFile(f, ratio) {
  if (current !== f.id) {
    current = f.id;
    audio.src = f.url;
    for (const [id, w] of waves) if (id !== f.id) w.setProgress(0);
  }
  if (ratio != null) {
    const seek = () => { if (audio.duration) audio.currentTime = ratio * audio.duration; };
    if (audio.readyState >= 1) seek(); else audio.addEventListener("loadedmetadata", seek, { once: true });
  }
  audio.play().catch(() => toast("Lecture impossible dans ce navigateur, télécharge le fichier.", "err"));
  drawButtons();
}

function drawButtons() {
  for (const btn of root.querySelectorAll("[data-play]")) {
    const on = btn.dataset.play === current && !audio.paused;
    btn.innerHTML = icon(on ? "pause" : "play", 20);
    btn.closest(".tp-file").classList.toggle("is-current", btn.dataset.play === current);
  }
}

let raf = 0;
function tick() {
  const w = waves.get(current);
  if (w && audio.duration) w.setProgress(audio.currentTime / audio.duration);
  const t = root.querySelector('[data-time="' + current + '"]');
  if (t) t.textContent = formatTime(audio.currentTime) + " / ";
  raf = audio.paused ? 0 : requestAnimationFrame(tick);
}
audio.addEventListener("play", () => { drawButtons(); if (!raf) raf = requestAnimationFrame(tick); });
audio.addEventListener("pause", drawButtons);
audio.addEventListener("ended", drawButtons);
audio.addEventListener("error", () => {
  if (current) toast("Ce navigateur ne lit pas ce format, télécharge-le.", "err");
});

// ------------------------------------------------------------- rendu

// Chaque fichier va dans un groupe selon ce que le navigateur sait en
// montrer : lecteur audio, lecteur vidéo, galerie d'images, ou liste.
function groupOf(f) {
  const cat = categoryOf(f.name, f.mime);
  if (!f.url) return "other";
  if (cat === "audio" && canPreview(f.name, f.mime)) return "audio";
  if (cat === "video" && canPreview(f.name, f.mime)) return "video";
  if (cat === "image" && canPreview(f.name, f.mime)) return "image";
  return "other";
}

function dlButton(f) {
  return f.download_url
    ? '<button class="btn btn-ghost btn-icon" data-dl="' + f.id + '" aria-label="Télécharger ' + esc(f.name) + '">' + icon("download") + "</button>"
    : "";
}

function renderAudio(f) {
  return '<li class="tp-file tp-audio">' +
    '<div class="tp-top">' +
      '<button class="play-btn" data-play="' + f.id + '" aria-label="Écouter">' + icon("play", 20) + "</button>" +
      '<div class="tp-main">' +
        '<div class="tp-name">' + esc(f.name) + "</div>" +
        '<div class="tp-meta">' + fileBadge(f.name, f.mime, f.kind) + " " +
          (f.duration ? '<span class="mono"><span data-time="' + f.id + '"></span>' + formatDuration(Number(f.duration)) + "</span> · " : "") +
          formatBytes(f.size) + (f.uploader ? " · " + esc(f.uploader) : "") + "</div>" +
      "</div>" + dlButton(f) +
    "</div>" +
    '<div class="wave wave-sm"><canvas data-wave="' + f.id + '"></canvas></div>' +
  "</li>";
}

function renderVideo(f) {
  return '<li class="tp-file tp-video">' +
    '<video controls playsinline preload="metadata" src="' + esc(f.url) + '"></video>' +
    '<div class="tp-top">' + fileTile(f.name, f.mime) +
      '<div class="tp-main"><div class="tp-name">' + esc(f.name) + "</div>" +
      '<div class="tp-meta">' + fileBadge(f.name, f.mime) + " " + formatBytes(f.size) + "</div></div>" + dlButton(f) +
    "</div>" +
  "</li>";
}

function renderImage(f) {
  return '<button class="tp-thumb" data-open="' + f.id + '" aria-label="Voir ' + esc(f.name) + '">' +
    '<img src="' + esc(f.url) + '" alt="" loading="lazy">' +
    '<span class="tp-thumb-name">' + esc(f.name) + "</span>" +
  "</button>";
}

function renderOther(f) {
  const pdf = /\.pdf$/i.test(f.name) && f.url;
  return '<li class="tp-file tp-row">' +
    '<div class="tp-top">' + fileTile(f.name, f.mime) +
      '<div class="tp-main"><div class="tp-name">' + esc(f.name) + "</div>" +
      '<div class="tp-meta">' + fileBadge(f.name, f.mime, f.kind) + " " + formatBytes(f.size) + "</div></div>" +
      (pdf ? '<a class="btn btn-ghost btn-icon" href="' + esc(f.url) + '" target="_blank" rel="noopener" aria-label="Ouvrir">' + icon("external") + "</a>" : "") +
      dlButton(f) +
    "</div>" +
  "</li>";
}

function render(d) {
  const total = d.files.reduce((sum, f) => sum + (f.size || 0), 0);
  const single = d.files.length === 1;
  document.title = d.title + (d.sender ? " · de " + d.sender : "");

  const groups = { audio: [], video: [], image: [], other: [] };
  for (const f of d.files) groups[groupOf(f)].push(f);
  const several = Object.values(groups).filter((g) => g.length).length > 1;
  const head = (label, n) => several ? '<h2 class="tp-group">' + label + ' <span class="count">' + n + "</span></h2>" : "";

  root.innerHTML =
    '<section class="tp-hero">' +
      '<div class="tp-from">' + avatar(d.sender || "?") +
        "<div><div>" + (d.sender ? "<strong>" + esc(d.sender) + "</strong> t'a envoyé " : "") +
          plural(d.files.length, "fichier", "fichiers") + "</div>" +
        (d.space ? '<div class="tp-space">' + esc(d.space) + "</div>" : "") + "</div>" +
      "</div>" +
      "<h1>" + esc(d.title) + "</h1>" +
      (d.message ? '<blockquote class="tp-msg">' + esc(d.message) + "</blockquote>" : "") +
      '<div class="tp-stats">' +
        "<span>" + icon("file", 14) + plural(d.files.length, "fichier", "fichiers") + "</span>" +
        "<span>" + icon("archive", 14) + formatBytes(total) + "</span>" +
        "<span>" + icon("clock", 14) + "jusqu'au " + esc(formatDate(d.expires_at)) + "</span>" +
      "</div>" +
      (d.files.length
        ? '<button class="btn btn-primary btn-xl btn-block" data-all>' + icon("download", 22) +
            "<span>" + (single ? "Télécharger" : "Tout télécharger") + "</span></button>"
        : "") +
    "</section>" +

    (d.files.length ? "" : '<div class="tp-state"><p>Les fichiers de cet envoi ont été supprimés.</p></div>') +
    (groups.audio.length ? '<section class="tp-section">' + head("Sons", groups.audio.length) + '<ul class="tp-files">' + groups.audio.map(renderAudio).join("") + "</ul></section>" : "") +
    (groups.video.length ? '<section class="tp-section">' + head("Vidéos", groups.video.length) + '<ul class="tp-files">' + groups.video.map(renderVideo).join("") + "</ul></section>" : "") +
    (groups.image.length ? '<section class="tp-section">' + head("Images", groups.image.length) + '<div class="tp-gallery">' + groups.image.map(renderImage).join("") + "</div></section>" : "") +
    (groups.other.length ? '<section class="tp-section">' + head("Autres fichiers", groups.other.length) + '<ul class="tp-files">' + groups.other.map(renderOther).join("") + "</ul></section>" : "") +

    '<a class="tp-cta" href="index.html"><span><strong>Toi aussi, gaspille de la bande passante.</strong>' +
      "<br>Envoie tes fichiers avec WeshTransfer, sans compte.</span>" + icon("chevron", 20) + "</a>" +
    '<p class="tp-foot">WeshTransfer, le transfert le moins écoresponsable du marché. ' +
      "(En vrai, tes fichiers sont supprimés automatiquement à expiration.)</p>";

  const cs = getComputedStyle(document.documentElement);
  for (const f of groups.audio) {
    const canvas = root.querySelector('[data-wave="' + f.id + '"]');
    if (!canvas) continue;
    const w = new Waveform(canvas, {
      barWidth: 2,
      barGap: 1,
      idleColor: cs.getPropertyValue("--wave-idle").trim(),
      playedColor: cs.getPropertyValue("--wave-played").trim() || "#a78bfa",
      onSeek: (ratio, done) => {
        if (!done) return;
        if (current === f.id && audio.duration) audio.currentTime = ratio * audio.duration;
        else playFile(f, ratio);
      }
    });
    w.setPeaks(f.peaks);
    waves.set(f.id, w);
  }

  root.addEventListener("click", onClick);
}

// ------------------------------------------------------ visionneuse

let viewer = null;

function openViewer(id) {
  const images = data.files.filter((f) => groupOf(f) === "image");
  let i = Math.max(0, images.findIndex((f) => f.id === id));
  closeViewer();
  viewer = document.createElement("div");
  viewer.className = "lightbox";
  viewer.innerHTML =
    '<div class="lb-bar"><span class="lb-name"></span>' +
      '<button class="btn btn-ghost btn-icon" data-lb-dl aria-label="Télécharger">' + icon("download") + "</button>" +
      '<button class="btn btn-ghost btn-icon" data-lb-close aria-label="Fermer">' + icon("x") + "</button></div>" +
    '<div class="lb-stage"><img alt=""></div>' +
    (images.length > 1
      ? '<button class="lb-nav lb-prev" data-lb-prev aria-label="Précédente">' + icon("back", 22) + "</button>" +
        '<button class="lb-nav lb-next" data-lb-next aria-label="Suivante">' + icon("chevron", 22) + "</button>"
      : "");
  document.body.appendChild(viewer);
  document.body.style.overflow = "hidden";

  const show = () => {
    const f = images[i];
    viewer.querySelector("img").src = f.url;
    viewer.querySelector(".lb-name").textContent = f.name + (images.length > 1 ? "  ·  " + (i + 1) + " / " + images.length : "");
  };
  const step = (d) => { i = (i + d + images.length) % images.length; show(); };

  viewer.addEventListener("click", (e) => {
    if (e.target.closest("[data-lb-close]") || e.target.classList.contains("lb-stage")) closeViewer();
    else if (e.target.closest("[data-lb-prev]")) step(-1);
    else if (e.target.closest("[data-lb-next]")) step(1);
    else if (e.target.closest("[data-lb-dl]")) { registerDownload(); triggerDownload(images[i].download_url, images[i].name); }
  });
  viewer.onkey = (e) => {
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  };
  document.addEventListener("keydown", viewer.onkey);

  // balayage au doigt pour passer d'une image à l'autre
  let x0 = null;
  viewer.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  viewer.addEventListener("touchend", (e) => {
    if (x0 == null || images.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    x0 = null;
  });
  show();
}

function closeViewer() {
  if (!viewer) return;
  document.removeEventListener("keydown", viewer.onkey);
  viewer.remove();
  viewer = null;
  document.body.style.overflow = "";
}

async function onClick(e) {
  const thumb = e.target.closest("[data-open]");
  if (thumb) { openViewer(thumb.dataset.open); return; }

  const play = e.target.closest("[data-play]");
  if (play) {
    const f = data.files.find((x) => x.id === play.dataset.play);
    if (current === f.id && !audio.paused) audio.pause();
    else playFile(f);
    return;
  }

  const dl = e.target.closest("[data-dl]");
  if (dl) {
    const f = data.files.find((x) => x.id === dl.dataset.dl);
    registerDownload();
    triggerDownload(f.download_url, f.name);
    return;
  }

  const all = e.target.closest("[data-all]");
  if (all) {
    if (data.files.length === 1) {
      registerDownload();
      triggerDownload(data.files[0].download_url, data.files[0].name);
      return;
    }
    const total = data.files.reduce((s, f) => s + (f.size || 0), 0);
    if (!canStreamToDisk() && total > MEMORY_LIMIT) {
      toast("Trop lourd pour un zip sur cet appareil (" + formatBytes(total) + ") : télécharge les fichiers un par un, ou ouvre ce lien dans Chrome sur ordinateur.", "err");
      return;
    }
    const label = all.innerHTML;
    all.disabled = true;
    try {
      const saved = await saveZip(data.title + ".zip",
        data.files.filter((f) => f.url).map((f) => ({ name: f.name, url: f.url, size: f.size })),
        (r) => { all.innerHTML = icon("download", 22) + "<span>Préparation du zip " + Math.round(r * 100) + " %</span>"; });
      if (saved) { registerDownload(); toast("Téléchargement terminé", "ok"); }
    } catch (err) {
      toast(err.message || "Échec du téléchargement", "err");
    }
    all.disabled = false;
    all.innerHTML = label;
  }
}

// ---------------------------------------------------------- chargement

async function load() {
  if (!/^(?:[0-9a-f]{32}|[A-Za-z0-9]{12})$/.test(k)) {
    fail("Lien incomplet", "Le lien semble tronqué. Réessaie depuis l'email ou le message reçu.");
    return;
  }
  let res;
  try {
    res = await call({ k });
  } catch (err) {
    fail("Pas de réseau", "Impossible de charger l'envoi. Vérifie ta connexion et recharge la page.");
    return;
  }
  const body = await res.json().catch(() => ({}));

  if (res.status === 410) {
    fail("Ce lien a expiré", (body.title ? "\"" + body.title + "\"" + (body.sender ? " de " + body.sender : "") + " n'est plus disponible. " : "") +
      "Demande à l'expéditeur de te le renvoyer.");
    return;
  }
  if (!res.ok) {
    fail("Lien introuvable", "Ce lien n'existe pas ou a été supprimé.");
    return;
  }
  data = body;
  render(data);
}

load();

