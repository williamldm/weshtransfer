// Jam : l'écoute partagée d'un séminaire, à la Spotify. Chacun ajoute ses
// sons à la file ; celui qui lance la jam "fait tourner" : son lecteur
// diffuse ce qu'il joue (morceau, position, pause) aux autres membres,
// qui peuvent se caler dessus. Rien en base : des messages broadcast sur
// le canal temps réel de l'espace, qui vivent tant que l'appli est ouverte.

import { listProjects, signFiles } from "./api.js?v=92";
import { isAudio, canPreview } from "./files.js?v=92";
import { onPlayer, state, play, toggle, seekSeconds, queueInfo, refreshQueue, trackFromFile } from "./player.js?v=92";
import { sendJam } from "./realtime.js?v=92";

export const JAM_DAYS = 5;
const HEARTBEAT = 4000;
const GONE_AFTER = 120000;   // filet : un DJ muet depuis 2 min a quitté
const DRIFT = 2.5;           // secondes d'écart tolérées avant recalage

export const expiresAt = (file) => new Date(new Date(file.created_at).getTime() + JAM_DAYS * 86400000);

let sp = null;
let items = [];                 // la file : un élément par son, ordre d'ajout
let online = [];                // présence : [{ id, pseudo }]
const djs = new Map();          // participantId -> dernier état reçu
let following = null;           // participantId suivi
let djOn = false;               // je fais tourner la jam
const listeners = new Set();

export const jamTag = () => (sp ? "jam:" + sp.id : null);

export function onJam(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

// ------------------------------------------------------------- la file

// Dernière version prête de chaque son, sons expirés exclus, dans l'ordre
// où ils ont été ajoutés (une playlist, pas un classement).
export function jamItems(projects) {
  const now = Date.now();
  return projects.map((p) => {
    const file = (p.files || [])
      .filter((f) => f.status === "ready" && (!f.created_at || expiresAt(f).getTime() > now))
      .sort((a, b) => b.version_no - a.version_no)[0] || null;
    return {
      project: p,
      file,
      playable: !!file && isAudio(file.original_name, file.mime_type) && canPreview(file.original_name, file.mime_type)
    };
  }).filter((it) => it.file).sort((a, b) => (a.project.created_at < b.project.created_at ? -1 : 1));
}

export function trackOf(item) {
  const t = trackFromFile(Object.assign({}, item.file, { uploader: null }), item.project.title);
  t.title = item.project.title;
  t.subtitle = item.project.creator ? "ajouté par " + item.project.creator.pseudo : "";
  t.album = sp ? sp.name : "";
  return t;
}

export const jamTracks = () => items.filter((it) => it.playable).map(trackOf);

let reloading = null;
let reloadTimer = 0;
export function reloadJam() {
  if (!sp) return Promise.resolve();
  if (reloading) return reloading;
  reloading = listProjects(sp.id).then((ps) => {
    items = jamItems(ps);
    refreshQueue(jamTag(), jamTracks());
    // URLs signées d'avance : suivre un DJ démarre sans attendre le réseau
    const ids = items.filter((it) => it.playable).map((it) => it.file.id);
    if (ids.length) signFiles(ids).catch(() => {});
    emit();
  }).catch(() => {}).finally(() => { reloading = null; });
  return reloading;
}
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(reloadJam, 400);
}

// ------------------------------------------------------------- état

// Le son qui "tourne" pour moi : celui du DJ suivi, ou le mien si je
// joue la file de la jam.
export function currentFileId() {
  if (following && djs.has(following)) return djs.get(following).fileId;
  const s = state();
  return s.track && queueInfo().tag === jamTag() ? s.track.fileId : null;
}

export function jamInfo() {
  const names = new Map(online.map((o) => [o.id, o.pseudo]));
  return {
    items,
    online,
    me: sp ? sp.participantId : null,
    following,
    dj: djOn,
    current: currentFileId(),
    djs: [...djs.entries()].map(([id, d]) => ({
      id, pseudo: names.get(id) || d.pseudo || "Quelqu'un", fileId: d.fileId, playing: d.playing
    }))
  };
}

// ------------------------------------------------ diffusion (je fais tourner)

function broadcast() {
  const s = state();
  if (!sp || !s.track) return;
  sendJam({ kind: "now", by: sp.participantId, pseudo: sp.pseudo, fileId: s.track.fileId, pos: s.time, playing: s.playing, at: Date.now() });
}

function stopBroadcast() {
  if (!djOn) return;
  djOn = false;
  sendJam({ kind: "stop", by: sp.participantId });
}

function onLocal(type, s) {
  if (type === "time") return;
  // on suivait quelqu'un, et on a changé de morceau soi-même (ou fermé
  // le lecteur) : on reprend la main
  if (following && type === "track") {
    const d = djs.get(following);
    if (!s.track || (d && s.track.fileId !== d.fileId)) following = null;
  }
  const mine = !following && !!s.track && queueInfo().tag === jamTag();
  if (mine) {
    const was = djOn;
    djOn = true;
    if (type !== "queue" || !was) broadcast();
  } else {
    stopBroadcast();
  }
  if (type === "track" || type === "state" || type === "queue") emit();
}

// ------------------------------------------------ réception (je suis)

function apply(d) {
  const lag = d.playing ? Math.min(Math.max(Date.now() - d.at, 0), 2000) / 1000 : 0;
  const target = d.pos + lag;
  const s = state();
  if (!s.track || s.track.fileId !== d.fileId) {
    const it = items.find((i) => i.file.id === d.fileId);
    if (!it) { scheduleReload(); }
    const t = it ? trackOf(it) : { fileId: d.fileId, title: "Jam", subtitle: "", album: sp.name, duration: 0 };
    const p = play(t, { at: target, solo: true });
    if (!d.playing && p && p.then) p.then(() => { if (state().playing) toggle(); }).catch(() => {});
    return;
  }
  if (Math.abs(s.time - target) > DRIFT) seekSeconds(target);
  if (d.playing !== s.playing) toggle();
}

function onRemote(m) {
  if (!sp || !m || typeof m !== "object" || typeof m.by !== "string" || m.by === sp.participantId) return;
  if (m.kind === "stop") {
    djs.delete(m.by);
    if (following === m.by) following = null;
    emit();
    return;
  }
  if (m.kind !== "now" || typeof m.fileId !== "string") return;
  const prev = djs.get(m.by);
  const d = {
    fileId: m.fileId,
    pos: Math.max(0, Number(m.pos) || 0),
    playing: !!m.playing,
    at: Number(m.at) || Date.now(),
    seen: Date.now(),
    pseudo: String(m.pseudo || "").slice(0, 24)
  };
  djs.set(m.by, d);
  if (following === m.by) apply(d);
  if (!prev || prev.fileId !== d.fileId || prev.playing !== d.playing) emit();
}

// À appeler depuis un clic (le navigateur n'autorise le son qu'après un
// geste de l'utilisateur).
export function followDj(id) {
  const d = djs.get(id);
  if (!d) return;
  stopBroadcast();
  following = id;
  apply(d);
  emit();
}

export function unfollow() {
  if (!following) return;
  following = null;
  emit();
}

// ------------------------------------------------------------ démarrage

export function startJam(space, bus) {
  sp = space;
  bus.on("jam", onRemote);
  bus.on("presence-list", (list) => {
    online = list;
    const here = new Set(list.map((o) => o.id));
    for (const id of [...djs.keys()]) {
      if (!here.has(id)) {
        djs.delete(id);
        if (following === id) following = null;
      }
    }
    // un nouveau venu voit tout de suite ce qui tourne
    if (djOn) broadcast();
    emit();
  });
  bus.on("db", (e) => {
    if (e.table === "projects" || e.table === "files") scheduleReload();
  });
  bus.on("realtime", (status) => { if (status === "SUBSCRIBED" && djOn) broadcast(); });
  onPlayer(onLocal);

  setInterval(() => {
    if (djOn) broadcast();
    const now = Date.now();
    let changed = false;
    for (const [id, d] of djs) {
      if (now - d.seen > GONE_AFTER) {
        djs.delete(id);
        if (following === id) following = null;
        changed = true;
      }
    }
    if (changed) emit();
  }, HEARTBEAT);

  window.addEventListener("pagehide", stopBroadcast);
  reloadJam();
}
