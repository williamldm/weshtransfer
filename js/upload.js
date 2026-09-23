// File d'upload : TUS résumable vers Supabase Storage, 2 fichiers à la fois,
// waveform calculée en parallèle, ligne en base créée à la fin.
//
// Pourquoi TUS : un WAV de 400 Mo envoyé en 4G depuis le fond du jardin
// va couper. TUS reprend là où ça s'est arrêté au lieu de tout recommencer.

import { Upload } from "https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/+esm";
import { sb, BUCKET } from "./db.js?v=6";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_EXT, PEAKS_MAX_BYTES } from "./config.js?v=6";
import { computePeaks } from "./peaks.js?v=6";
import { insertFile } from "./api.js?v=6";

// Hôte de stockage direct : recommandé par Supabase pour les gros fichiers.
const ENDPOINT = SUPABASE_URL.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";
const CHUNK = 6 * 1024 * 1024;   // imposé par Supabase pour TUS
const PARALLEL = 2;

const MIME = {
  mp3: "audio/mpeg", wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff",
  m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg", zip: "application/zip"
};

const jobs = [];
const listeners = new Set();
let seq = 0;

export function onUploads(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(job) {
  for (const fn of listeners) fn(job, jobs);
  syncWakeLock();
}

export function getJobs() {
  return jobs.slice();
}

const ACTIVE = ["queued", "uploading", "waiting", "saving"];

export function activeCount() {
  return jobs.filter((j) => ACTIVE.includes(j.state)).length;
}

// ------------------------------------------------------------ validation

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

export function checkFile(file, maxBytes) {
  const ext = extOf(file.name);
  if (!ALLOWED_EXT.includes(ext)) return "Format non accepté (." + (ext || "?") + ")";
  if (maxBytes && file.size > maxBytes) return "Trop lourd pour cet espace";
  if (!file.size) return "Fichier vide";
  return null;
}

// Devine le type depuis le nom : "NUIT_BLANCHE_voix_take3.wav" -> voix.
export function guessKind(name) {
  const n = (name || "").toLowerCase();
  if (/\.zip$/.test(n) || /(stem|multitrack|multipiste|trackout)/.test(n)) return "stems";
  if (/(freestyle|impro)/.test(n)) return "freestyle";
  if (/(master|mixdown|\bmix\b|_mix|mix_|final|bounce)/.test(n)) return "mix";
  if (/(voix|vocal|\bvox|take|prise|couplet|refrain|hook|verse|topline)/.test(n)) return "voix";
  if (/(instru|beat|\bprod|instrumental)/.test(n)) return "instru";
  return "autre";
}

export function guessBpm(name) {
  const m = /(?:^|[^0-9])(\d{2,3})\s?bpm/i.exec(name || "");
  const bpm = m ? parseInt(m[1], 10) : NaN;
  return bpm >= 40 && bpm <= 300 ? bpm : null;
}

// Titre de morceau plausible depuis un nom de fichier :
// "NUIT_BLANCHE_voix_take3_92bpm.wav" -> "NUIT BLANCHE".
const NOISE = /^(voix|vocal|vocals|vox|voc|take\d*|prise\d*|instru|instrumental|beat|prod|mix|mixdown|master|final|bounce|stems?|couplet\d*|refrain|hook|v\d+|version\d*|\d+)$/i;

export function titleFromName(name) {
  const base = (name || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/\d{2,3}\s?bpm/ig, " ")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  const kept = base.split(" ").filter((w) => w && !NOISE.test(w)).join(" ");
  return (kept || base || "Sans titre").slice(0, 80);
}

// ------------------------------------------------------------------ file

// meta : { spaceId, projectId, projectTitle, kind, label, bpm, musicalKey, tag }
export function enqueue(files, meta) {
  const added = [];
  // Les numéros de version suivent l'ordre de sélection, pas l'ordre
  // d'arrivée : chaque fichier attend que le précédent du lot soit
  // enregistré avant de s'enregistrer à son tour (l'envoi, lui, reste
  // parallèle).
  let previous = Promise.resolve();
  for (const file of files) {
    let release;
    const turn = new Promise((resolve) => { release = resolve; });
    const job = {
      waitTurn: previous,
      releaseTurn: release,
      id: ++seq,
      file,
      name: file.name,
      size: file.size,
      meta,
      state: "queued",
      loaded: 0,
      speed: 0,
      error: null,
      result: null,
      tus: null
    };
    previous = turn;
    jobs.push(job);
    added.push(job);
    emit(job);
  }
  pump();
  return added;
}

export function cancel(jobId) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return;
  if (job.tus) job.tus.abort(true).catch(() => {});
  job.state = "canceled";
  job.releaseTurn();
  emit(job);
  pump();
}

export function retry(jobId) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job || (job.state !== "error" && job.state !== "canceled")) return;
  job.state = "queued";
  job.error = null;
  emit(job);
  pump();
}

export function dismiss(jobId) {
  const i = jobs.findIndex((j) => j.id === jobId);
  if (i >= 0 && !["uploading", "waiting", "saving"].includes(jobs[i].state)) {
    const [job] = jobs.splice(i, 1);
    job.state = "dismissed";
    emit(job);
  }
}

export function clearFinished() {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].state === "done") jobs.splice(i, 1);
  }
  emit(null);
}

function pump() {
  // "waiting" ne compte pas : un fichier monté qui attend son tour
  // d'enregistrement libère sa place pour le suivant.
  const running = jobs.filter((j) => j.state === "uploading" || j.state === "saving").length;
  const free = PARALLEL - running;
  const next = jobs.filter((j) => j.state === "queued").slice(0, Math.max(0, free));
  for (const job of next) run(job);
}

async function run(job) {
  job.state = "uploading";
  job.loaded = 0;
  emit(job);

  const { file, meta } = job;
  const ext = extOf(file.name);
  const fileId = crypto.randomUUID();
  const path = "spaces/" + meta.spaceId + "/" + meta.projectId + "/" + fileId + "." + ext;
  const mime = file.type && file.type !== "application/octet-stream" ? file.type : (MIME[ext] || "application/octet-stream");

  // La waveform se calcule pendant que ça monte : aucun temps perdu.
  const peaksPromise = ext === "zip"
    ? Promise.resolve({ peaks: null, duration: null })
    : computePeaks(file, { maxBytes: PEAKS_MAX_BYTES }).catch(() => ({ peaks: null, duration: null }));

  try {
    await tusUpload(job, path, mime);
    if (job.state === "canceled") return;

    job.state = "waiting";
    emit(job);
    pump();
    await job.waitTurn;

    job.state = "saving";
    emit(job);

    const { peaks, duration } = await peaksPromise;
    job.result = await insertFile({
      id: fileId,
      project_id: meta.projectId,
      storage_path: path,
      original_name: file.name.slice(0, 200),
      mime_type: mime,
      size_bytes: file.size,
      duration_sec: duration ? Math.round(duration * 100) / 100 : null,
      peaks,
      kind: meta.kind || guessKind(file.name),
      label: meta.label || null,
      bpm: meta.bpm || guessBpm(file.name),
      musical_key: meta.musicalKey || null,
      status: "ready"
    });
    job.state = "done";
    job.file = null;   // libère la mémoire
    // la ligne de progression disparaît d'elle-même une fois le son en ligne
    setTimeout(() => dismiss(job.id), 4000);
  } catch (err) {
    if (job.state === "canceled") return;
    job.state = "error";
    job.error = explain(err);
  } finally {
    job.releaseTurn();
  }
  emit(job);
  pump();
}

function tusUpload(job, path, mime) {
  return new Promise((resolve, reject) => {
    let lastT = performance.now();
    let lastB = 0;

    const upload = new Upload(job.file, {
      endpoint: ENDPOINT,
      chunkSize: CHUNK,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "x-upsert": "false"
      },
      metadata: {
        bucketName: BUCKET,
        objectName: path,
        contentType: mime,
        cacheControl: "3600"
      },
      // Jeton relu à chaque requête : un upload d'une heure survit
      // au renouvellement de session.
      onBeforeRequest: async (req) => {
        const { data } = await sb.auth.getSession();
        if (data.session) req.setHeader("Authorization", "Bearer " + data.session.access_token);
      },
      onProgress: (sent, total) => {
        const now = performance.now();
        if (now - lastT > 700) {
          job.speed = ((sent - lastB) / (now - lastT)) * 1000;
          lastT = now;
          lastB = sent;
        }
        job.loaded = sent;
        job.size = total;
        emit(job);
      },
      onError: reject,
      onSuccess: resolve
    });

    job.tus = upload;
    // Reprise d'un envoi interrompu (même fichier resélectionné).
    upload.findPreviousUploads()
      .then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

function explain(err) {
  const res = err && err.originalResponse;
  const status = res && res.getStatus ? res.getStatus() : 0;
  const body = res && res.getBody ? String(res.getBody() || "") : "";
  if (status === 413 || /maximum allowed size|too large/i.test(body)) {
    return "Trop lourd pour la limite de stockage du projet (50 Mo par fichier en plan Free).";
  }
  if (status === 401 || status === 403) return "Accès refusé : reconnecte-toi à l'espace.";
  if (status === 409) return "Ce fichier existe déjà.";
  if (!status) return "Réseau coupé. L'upload reprendra où il en était.";
  return (err && err.message ? err.message : "Erreur").slice(0, 160);
}

// ------------------------------------- l'écran ne doit pas s'éteindre

let wakeLock = null;

async function syncWakeLock() {
  const busy = activeCount() > 0;
  try {
    if (busy && !wakeLock && navigator.wakeLock && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } else if (!busy && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (err) { /* refusé (économie d'énergie) : sans conséquence */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncWakeLock();
});

window.addEventListener("beforeunload", (e) => {
  if (activeCount() > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});
