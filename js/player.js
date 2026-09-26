// Lecteur global : un seul <audio> pour toute l'appli, qui survit à la
// navigation entre les vues. Les vues l'écoutent pour animer leurs
// waveforms, la barre du bas l'affiche en permanence.

import { cachedUrl, signFiles } from "./api.js?v=93";
import { icon } from "./icons.js?v=93";
import { formatDuration, toast } from "./ui.js?v=93";

const audio = new Audio();
audio.preload = "metadata";

let track = null;   // { fileId, path, title, subtitle, duration, mime }
// File d'écoute : les morceaux s'enchaînent (fin d'un titre = suivant).
let queue = [];
let qIndex = -1;
let queueTag = null;   // d'où vient la file (ex. "jam:<espace>")
const listeners = new Set();
let raf = 0;

export function onPlayer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(type) {
  const s = state();
  for (const fn of listeners) fn(type, s);
}

export function state() {
  const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (track && track.duration) || 0;
  return {
    track,
    playing: !audio.paused && !audio.ended,
    time: audio.currentTime || 0,
    duration: d,
    ratio: d ? Math.min(1, (audio.currentTime || 0) / d) : 0
  };
}

export function queueInfo() {
  return { length: queue.length, index: qIndex, tag: queueTag, hasNext: queue.length > 0 && qIndex < queue.length - 1, hasPrev: qIndex > 0 };
}

// Lance une file (album, liste de mix) à partir de `index`. Les URLs sont
// signées d'avance : le suivant part sans attendre le réseau.
export function playQueue(tracks, index, tag) {
  queue = (tracks || []).slice();
  queueTag = tag || null;
  qIndex = Math.max(0, Math.min(index || 0, queue.length - 1));
  signFiles(queue.map((t) => t.fileId)).catch(() => {});
  return play(queue[qIndex], { keepQueue: true, at: 0 });
}

// La file suit sa source en direct (un son ajouté à la jam arrive en fin
// de file) sans couper le morceau en cours.
export function refreshQueue(tag, tracks) {
  if (!tag || tag !== queueTag) return;
  const cur = track ? track.fileId : null;
  const i = tracks.findIndex((t) => t.fileId === cur);
  // morceau en cours retiré de la source : on reprend juste après lui
  qIndex = i !== -1 ? i : Math.min(qIndex, tracks.length) - 1;
  queue = tracks.slice();
  emit("queue");
}

export function next() {
  if (!queue.length || qIndex >= queue.length - 1) return;
  qIndex++;
  play(queue[qIndex], { keepQueue: true, at: 0 });
}

export function prev() {
  // comme partout : au-delà de 3 s, on revient au début du titre
  if ((audio.currentTime || 0) > 3 || qIndex <= 0) { seekSeconds(0); return; }
  qIndex--;
  play(queue[qIndex], { keepQueue: true, at: 0 });
}

export function isCurrent(fileId) {
  return !!track && track.fileId === fileId;
}

// Pas d'await avant audio.play() quand l'URL est déjà en cache : iOS
// n'autorise la lecture que dans la continuité directe du tap.
export function play(next, options) {
  const opts = options || {};
  // lecture isolée d'un titre hors de la file : la file s'arrête là
  // "solo" : lecture pilotée d'ailleurs (jam suivie), sans file locale
  if (opts.solo) { queue = []; qIndex = -1; queueTag = null; }
  else if (!opts.keepQueue) {
    const i = queue.findIndex((t) => t.fileId === next.fileId);
    if (i === -1) { queue = []; qIndex = -1; queueTag = null; } else qIndex = i;
  }
  if (!track || track.fileId !== next.fileId) {
    const url = next.url || cachedUrl(next.fileId);
    if (!url) {
      return signFiles([next.fileId]).then((urls) => {
        if (!urls[next.fileId]) throw new Error("URL indisponible");
        return play(Object.assign({}, next, { url: urls[next.fileId] }), Object.assign({}, opts, { keepQueue: true }));
      }).catch((err) => toast("Lecture impossible : " + err.message, "err"));
    }
    track = next;
    audio.src = url;
    emit("track");
    updateMediaSession();
  }
  if (opts.at != null) seekSeconds(opts.at);
  const p = audio.play();
  if (p && p.catch) {
    p.catch((err) => {
      if (err && err.name === "NotAllowedError") toast("Touche encore lecture pour démarrer le son");
    });
  }
  return p;
}

export function toggle() {
  if (!track) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function pause() {
  audio.pause();
}

export function seekSeconds(sec) {
  const apply = () => {
    const d = state().duration;
    audio.currentTime = Math.max(0, d ? Math.min(sec, d - 0.05) : sec);
    emit("time");
    emit("seek");
  };
  // Avant les métadonnées, Safari ignore le seek : on attend.
  if (audio.readyState >= 1) apply();
  else audio.addEventListener("loadedmetadata", apply, { once: true });
}

export function seekRatio(ratio) {
  const d = state().duration;
  if (d) seekSeconds(ratio * d);
}

export function skip(delta) {
  seekSeconds((audio.currentTime || 0) + delta);
}

export function close() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  track = null;
  queue = [];
  qIndex = -1;
  queueTag = null;
  emit("track");
}

// ------------------------------------------------------ boucle d'animation

function tick() {
  emit("time");
  raf = audio.paused ? 0 : requestAnimationFrame(tick);
}

audio.addEventListener("play", () => {
  emit("state");
  if (!raf) raf = requestAnimationFrame(tick);
});
audio.addEventListener("pause", () => { emit("state"); updatePosition(); });
audio.addEventListener("ended", () => {
  if (queue.length && qIndex < queue.length - 1) next();
  else emit("state");
});
audio.addEventListener("loadedmetadata", () => { emit("time"); updatePosition(); });
audio.addEventListener("seeked", updatePosition);
audio.addEventListener("error", () => {
  if (!track) return;
  const aiff = /aif/i.test(track.mime || track.path || "");
  toast(aiff
    ? "Ce navigateur ne lit pas l'AIFF : télécharge le fichier (Safari le lit)."
    : "Lecture impossible pour ce fichier.", "err");
  emit("state");
});

// ------------------------------------------- écran verrouillé / casque BT

function updateMediaSession() {
  if (!("mediaSession" in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.subtitle || "",
      album: track.album || "WeshTransfer",
      artwork: track.artwork ? [{ src: track.artwork, sizes: "640x640", type: "image/jpeg" }] : []
    });
  } catch (err) { /* navigateur ancien */ }
}

function updatePosition() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  const s = state();
  if (!s.duration) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: s.duration,
      position: Math.min(s.time, s.duration),
      playbackRate: audio.playbackRate || 1
    });
  } catch (err) { /* valeurs transitoires */ }
}

if ("mediaSession" in navigator) {
  const set = (action, fn) => {
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (err) { /* non supporté */ }
  };
  set("play", () => audio.play());
  set("pause", () => audio.pause());
  set("seekbackward", () => skip(-10));
  set("seekforward", () => skip(10));
  set("seekto", (d) => seekSeconds(d.seekTime));
  set("stop", close);
  set("nexttrack", () => next());
  set("previoustrack", () => prev());
}

// --------------------------------------------------------- barre du bas

export function bindPlayerBar(navigate) {
  const bar = document.getElementById("player");
  if (!bar) return;

  bar.innerHTML =
    '<div class="player-progress"><i></i></div>' +
    '<button class="btn btn-ghost btn-icon player-skip" data-prev aria-label="Précédent" hidden>' + icon("prev", 20) + "</button>" +
    '<button class="player-play" data-toggle aria-label="Lecture">' + icon("play", 22) + "</button>" +
    '<button class="btn btn-ghost btn-icon player-skip" data-next aria-label="Suivant" hidden>' + icon("next", 20) + "</button>" +
    '<button class="player-info" data-open>' +
      '<span class="t" data-title></span>' +
      '<span class="s"><span data-sub></span> <span class="mono" data-time>0:00</span></span>' +
    "</button>" +
    '<button class="btn btn-ghost btn-icon" data-close aria-label="Fermer le lecteur">' + icon("x") + "</button>";

  const fill = bar.querySelector(".player-progress > i");
  const toggleBtn = bar.querySelector("[data-toggle]");
  const titleEl = bar.querySelector("[data-title]");
  const subEl = bar.querySelector("[data-sub]");
  const timeEl = bar.querySelector("[data-time]");

  toggleBtn.onclick = toggle;
  const prevBtn = bar.querySelector("[data-prev]");
  const nextBtn = bar.querySelector("[data-next]");
  prevBtn.onclick = prev;
  nextBtn.onclick = next;
  bar.querySelector("[data-close]").onclick = close;
  bar.querySelector("[data-open]").onclick = () => { if (track) navigate("#/f/" + track.fileId); };

  // Appui sur la barre de progression = seek
  bar.querySelector(".player-progress").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seekRatio((e.clientX - r.left) / r.width);
  });

  onPlayer((type, s) => {
    if (type === "track" || type === "queue") {
      bar.classList.toggle("is-open", !!s.track);
      document.body.classList.toggle("has-player", !!s.track);
      titleEl.textContent = s.track ? s.track.title : "";
      subEl.textContent = s.track ? (s.track.subtitle || "") : "";
      const qi = queueInfo();
      prevBtn.hidden = qi.length < 2;
      nextBtn.hidden = qi.length < 2;
      nextBtn.disabled = !qi.hasNext;
    }
    if (type === "state" || type === "track") {
      toggleBtn.innerHTML = icon(s.playing ? "pause" : "play", 22);
      toggleBtn.setAttribute("aria-label", s.playing ? "Pause" : "Lecture");
    }
    fill.style.width = (s.ratio * 100).toFixed(2) + "%";
    timeEl.textContent = formatDuration(s.time) + (s.duration ? " / " + formatDuration(s.duration) : "");
  });

  // Espace = lecture/pause, sauf quand on tape du texte
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || !track) return;
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(tag) || (e.target && e.target.isContentEditable)) return;
    e.preventDefault();
    toggle();
  });
}

// Construit la description de piste à partir d'une ligne files.
export function trackFromFile(file, projectTitle) {
  return {
    fileId: file.id,
    path: file.storage_path,
    title: (projectTitle ? projectTitle + " · " : "") + "v" + file.version_no + (file.label ? " " + file.label : ""),
    subtitle: file.uploader ? file.uploader.pseudo : "",
    album: projectTitle || "",
    duration: file.duration_sec ? Number(file.duration_sec) : 0,
    mime: file.mime_type || file.original_name
  };
}

