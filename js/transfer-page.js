// Page publique d'un envoi : ce que voit le destinataire.
// Pas de supabase-js ici : un simple appel à l'Edge Function transfer-open,
// qui vérifie le lien et renvoie des URLs signées. Page légère, rapide en 4G.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js?v=6";
import { Waveform, formatTime } from "./waveform.js?v=6";
import { saveZip, canStreamToDisk, MEMORY_LIMIT } from "./zip.js?v=6";
import { icon } from "./icons.js?v=6";
import { esc, kindBadge, formatBytes, formatDuration, formatDate, plural, toast, triggerDownload } from "./ui.js?v=6";

const root = document.getElementById("tp");
const k = new URLSearchParams(location.search).get("k") || "";
const ENDPOINT = SUPABASE_URL + "/functions/v1/transfer-open";

function call(body, keepalive) {
  const headers = { "Content-Type": "application/json" };
  if (SUPABASE_PUBLISHABLE_KEY) headers.apikey = SUPABASE_PUBLISHABLE_KEY;
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

function render(d) {
  const total = d.files.reduce((s, f) => s + (f.size || 0), 0);
  const single = d.files.length === 1;
  document.title = d.title + (d.sender ? " · de " + d.sender : "");

  root.innerHTML =
    '<section class="tp-hero">' +
      (d.space ? '<div class="eyebrow">' + esc(d.space) + "</div>" : "") +
      '<p class="tp-from">' + (d.sender ? "<strong>" + esc(d.sender) + "</strong> t'a envoyé " : "") +
        plural(d.files.length, "fichier", "fichiers") + "</p>" +
      "<h1>" + esc(d.title) + "</h1>" +
      (d.message ? '<blockquote class="tp-msg">' + esc(d.message) + "</blockquote>" : "") +
      (d.files.length
        ? '<button class="btn btn-primary btn-xl btn-block" data-all>' + icon("download", 22) +
            "<span>" + (single ? "Télécharger" : "Tout télécharger") + '</span><span class="btn-sub">' + formatBytes(total) + "</span></button>"
        : "") +
      '<p class="tp-exp">' + icon("clock", 14) + " Disponible jusqu'au " + esc(formatDate(d.expires_at)) + "</p>" +
    "</section>" +

    (d.files.length
      ? '<ul class="tp-files">' + d.files.map((f) => {
          const zip = /\.zip$/i.test(f.name);
          return '<li class="tp-file">' +
            '<div class="tp-top">' +
              (zip || !f.url
                ? '<span class="play-btn is-static">' + icon("archive", 20) + "</span>"
                : '<button class="play-btn" data-play="' + f.id + '" aria-label="Écouter">' + icon("play", 20) + "</button>") +
              '<div class="tp-main">' +
                '<div class="tp-name">' + esc(f.name) + "</div>" +
                '<div class="tp-meta">' + kindBadge(f.kind) + " " +
                  (f.duration ? '<span class="mono"><span data-time="' + f.id + '"></span>' + formatDuration(Number(f.duration)) + "</span> · " : "") +
                  formatBytes(f.size) + (f.uploader ? " · " + esc(f.uploader) : "") + "</div>" +
              "</div>" +
              (f.download_url ? '<button class="btn btn-ghost btn-icon" data-dl="' + f.id + '" aria-label="Télécharger ' + esc(f.name) + '">' + icon("download") + "</button>" : "") +
            "</div>" +
            (zip ? "" : '<div class="wave wave-sm"><canvas data-wave="' + f.id + '"></canvas></div>') +
          "</li>";
        }).join("") + "</ul>"
      : '<div class="tp-state"><p>Les fichiers de cet envoi ont été supprimés.</p></div>') +

    '<p class="tp-foot">Envoyé depuis Séminaire · les fichiers sont supprimés automatiquement après expiration.</p>';

  const cs = getComputedStyle(document.documentElement);
  for (const f of d.files) {
    const canvas = root.querySelector('[data-wave="' + f.id + '"]');
    if (!canvas) continue;
    const w = new Waveform(canvas, {
      barWidth: 2,
      barGap: 1,
      idleColor: cs.getPropertyValue("--wave-idle").trim(),
      playedColor: cs.getPropertyValue("--accent").trim(),
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

async function onClick(e) {
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
  if (!/^[0-9a-f]{32}$/.test(k)) {
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
