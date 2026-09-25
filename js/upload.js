// File d'upload : TUS résumable vers Supabase Storage, 2 fichiers à la fois,
// waveform calculée en parallèle, ligne en base créée à la fin.
//
// Pourquoi TUS : un WAV de 400 Mo envoyé en 4G depuis le fond du jardin
// va couper. TUS reprend là où ça s'est arrêté au lieu de tout recommencer.

import { Upload } from "https://cdn.jsdelivr.net/npm/tus-js-client@4.3.1/+esm";
import { sb, BUCKET } from "./db.js?v=53";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PEAKS_MAX_BYTES } from "./config.js?v=53";
import { extOf as fileExt, isBlocked, isAudio, mimeOf } from "./files.js?v=53";
import { computePeaks } from "./peaks.js?v=53";
import { insertFile, storageCall, storageConfig } from "./api.js?v=53";
import { errorText } from "./ui.js?v=53";

// Hôte de stockage direct : recommandé par Supabase pour les gros fichiers.
const ENDPOINT = SUPABASE_URL.replace(".supabase.co", ".storage.supabase.co") + "/storage/v1/upload/resumable";
const CHUNK = 6 * 1024 * 1024;   // imposé par Supabase pour TUS
const PARALLEL = 2;


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

export const extOf = fileExt;

export function checkFile(file, maxBytes) {
  if (isBlocked(file.name)) return "Les programmes (." + extOf(file.name) + ") ne sont pas acceptés";
  if (maxBytes && file.size > maxBytes) return "Trop lourd pour cet espace";
  if (!file.size) return "Fichier vide";
  return null;
}

// Devine le type depuis le nom : "NUIT_BLANCHE_voix_take3.wav" -> voix.
export function guessKind(name) {
  const n = (name || "").toLowerCase();
  if (/\.zip$/.test(n) || /(stem|multitrack|multipiste|trackout)/.test(n)) return "stems";
  // une pochette "cover_mix.png" n'est pas un mix : les types musicaux
  // ne concernent que l'audio
  if (!isAudio(name)) return "autre";
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
  if (job.b2) cancelB2(job);
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
  const ext = extOf(file.name) || "bin";
  let fileId = crypto.randomUUID();
  let path = "spaces/" + meta.spaceId + "/" + meta.projectId + "/" + fileId + "." + ext;
  let backend = "supabase";
  const mime = mimeOf(file.name, file.type);
  const audio = isAudio(file.name, mime);

  // La waveform se calcule pendant que ça monte : aucun temps perdu.
  const peaksPromise = !audio
    ? Promise.resolve({ peaks: null, duration: null })
    : computePeaks(file, { maxBytes: PEAKS_MAX_BYTES }).catch(() => ({ peaks: null, duration: null }));

  try {
    // Le serveur décide : B2 dès que ses identifiants sont en place,
    // Storage Supabase sinon.
    const conf = await storageConfig();
    if (conf.backend === "b2") {
      const done = await b2Upload(job, mime);
      fileId = done.fileId;
      path = done.key;
      backend = "b2";
    } else {
      await tusUpload(job, path, mime);
    }
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
      backend,
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

// ---------------------------------------------------------- upload B2
// Multipart S3 : le fichier est découpé en parties envoyées directement à
// B2 via des URLs signées par l'Edge Function storage. Une partie ratée
// est renvoyée seule ; un onglet fermé reprend où il en était (l'état est
// gardé dans localStorage, les parties déjà reçues sont relues sur B2).

const B2_PARALLEL = 3;
const B2_RETRIES = [1000, 2000, 4000, 8000, 15000, 30000];

function resumeKey(job) {
  const f = job.file;
  return "seminaire.up:" + [job.meta.projectId, f.name, f.size, f.lastModified].join("|");
}

function loadResume(k) {
  try { return JSON.parse(localStorage.getItem(k)); } catch (err) { return null; }
}

function saveResume(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (err) { /* privé */ }
}

function forgetResume(k) {
  try { localStorage.removeItem(k); } catch (err) { /* privé */ }
}

async function b2Upload(job, mime) {
  const file = job.file;
  const rk = resumeKey(job);
  let st = loadResume(rk);
  const done = new Map();   // numéro de partie -> taille reçue par B2

  if (st) {
    try {
      const status = await storageCall("upload-status", { key: st.key, upload_id: st.uploadId });
      for (const p of status.parts || []) done.set(p.part, p.size);
    } catch (err) {
      st = null;           // upload expiré côté B2 : on repart de zéro
      forgetResume(rk);
    }
  }
  if (!st) {
    const fileId = crypto.randomUUID();
    const init = await storageCall("upload-init", {
      project_id: job.meta.projectId,
      file_id: fileId,
      file_name: file.name,
      size: file.size,
      content_type: mime
    });
    st = { fileId, key: init.key, uploadId: init.upload_id, partSize: init.part_size };
    saveResume(rk, st);
  }

  job.b2 = { key: st.key, uploadId: st.uploadId, rk, xhrs: new Set() };
  const partSize = st.partSize;
  const total = Math.max(1, Math.ceil(file.size / partSize));
  const queue = [];
  for (let n = 1; n <= total; n++) if (!done.has(n)) queue.push(n);

  let confirmed = 0;
  for (const size of done.values()) confirmed += size;
  const inflight = new Map();
  const urls = {};
  let lastT = performance.now();
  let lastB = confirmed;

  const progress = () => {
    let sent = confirmed;
    for (const v of inflight.values()) sent += v;
    const now = performance.now();
    if (now - lastT > 700) {
      job.speed = ((sent - lastB) / (now - lastT)) * 1000;
      lastT = now;
      lastB = sent;
    }
    job.loaded = Math.min(sent, file.size);
    emit(job);
  };
  progress();

  // URLs signées par lots de 20, à la demande
  const urlFor = async (n) => {
    if (!urls[n]) {
      const batch = [n].concat(queue.filter((x) => !urls[x]).slice(0, 19));
      const res = await storageCall("upload-parts", { key: st.key, upload_id: st.uploadId, parts: batch });
      Object.assign(urls, res.urls || {});
    }
    return urls[n];
  };

  const putPart = (n) => new Promise((resolve, reject) => {
    const start = (n - 1) * partSize;
    // slice sans type : aucun Content-Type envoyé, donc aucune négociation
    // CORS supplémentaire avec B2
    const blob = file.slice(start, Math.min(start + partSize, file.size));
    urlFor(n).then((url) => {
      const xhr = new XMLHttpRequest();
      job.b2.xhrs.add(xhr);
      xhr.open("PUT", url);
      xhr.upload.onprogress = (e) => { inflight.set(n, e.loaded); progress(); };
      xhr.onload = () => {
        job.b2.xhrs.delete(xhr);
        if (xhr.status >= 200 && xhr.status < 300) {
          inflight.delete(n);
          confirmed += blob.size;
          progress();
          resolve();
        } else {
          if (xhr.status === 403) delete urls[n];   // URL expirée : on la resignera
          inflight.delete(n);
          reject(Object.assign(new Error("HTTP " + xhr.status), { status: xhr.status }));
        }
      };
      xhr.onerror = () => { job.b2.xhrs.delete(xhr); inflight.delete(n); reject(new Error("RESEAU")); };
      xhr.onabort = () => { job.b2.xhrs.delete(xhr); inflight.delete(n); reject(new Error("ANNULE")); };
      xhr.send(blob);
    }, reject);
  });

  const worker = async () => {
    while (queue.length && job.state !== "canceled") {
      const n = queue.shift();
      for (let attempt = 0; ; attempt++) {
        try {
          await putPart(n);
          break;
        } catch (err) {
          if (job.state === "canceled" || err.message === "ANNULE") throw err;
          if (attempt >= B2_RETRIES.length) throw err;
          await new Promise((r) => setTimeout(r, B2_RETRIES[attempt]));
        }
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(B2_PARALLEL, Math.max(1, queue.length)) }, worker));
  if (job.state === "canceled") throw new Error("ANNULE");

  await storageCall("upload-complete", { key: st.key, upload_id: st.uploadId });
  forgetResume(rk);
  return { fileId: st.fileId, key: st.key };
}

function cancelB2(job) {
  for (const xhr of job.b2.xhrs) xhr.abort();
  forgetResume(job.b2.rk);
  storageCall("upload-abort", { key: job.b2.key, upload_id: job.b2.uploadId }).catch(() => {});
}

function explain(err) {
  const code = String((err && err.message) || "");
  if (/TROP_LOURD/.test(code)) return "Trop lourd pour cet espace.";
  if (/QUOTA_|TROP_D_UPLOADS|TAILLE_INCOHERENTE|UPLOAD_INCONNU|ESPACE_PLEIN|TROP_RAPIDE/.test(code)) return errorText(err);
  if (/FICHIER_EXISTANT/.test(code)) return "Conflit d'identifiant, réessaie.";
  if (/NON_MEMBRE|NON_AUTHENTIFIE/.test(code)) return "Accès refusé : reconnecte-toi à l'espace.";
  if (/FORMAT_REFUSE/.test(code)) return "Format non accepté.";
  if (/RESEAU|Failed to fetch|Load failed/.test(code)) return "Réseau coupé. Touche réessayer : l'upload reprendra où il en était.";
  if (/ERREUR_STOCKAGE|B2/.test(code)) return "Le stockage ne répond pas, réessaie dans un instant.";
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
