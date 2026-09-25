// Coquille de l'appli : démarrage, routeur à hash, en-tête, bus
// d'événements, temps réel. Chaque vue est un module avec mount().

import { restore, getSpace, leaveSpace } from "./session.js?v=55";
import { connectSpace } from "./realtime.js?v=55";
import { startJam } from "./jam.js?v=55";
import { bindPlayerBar } from "./player.js?v=55";
import { activeCount, onUploads } from "./upload.js?v=55";
import { openPeopleSheet } from "./views/people.js?v=55";
import { openUploadSheet } from "./views/upload-sheet.js?v=55";
import { icon } from "./icons.js?v=55";
import { monogram } from "./brand.js?v=55";
import { toast, errorText, esc } from "./ui.js?v=55";

import * as home from "./views/home.js?v=55";
import * as project from "./views/project.js?v=55";
import * as file from "./views/file.js?v=55";
import * as send from "./views/send.js?v=55";
import * as transfers from "./views/transfers.js?v=55";

// L'accueil dépend du mode de l'espace : morceaux (séminaire) ou
// directement le composeur d'envoi (espace dédié aux envois).
const ROUTES = [
  { re: /^\/projects$/, view: () => (ctx.space.mode === "envoi" ? send : home), root: true },
  { re: /^\/p\/([\w-]+)$/, view: project },
  { re: /^\/f\/([\w-]+)$/, view: file },
  { re: /^\/send$/, view: send },
  { re: /^\/transfers$/, view: transfers }
];

// ----------------------------------------------------------------- bus

function createBus() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type).delete(fn);
    },
    emit(type, payload) {
      for (const fn of map.get(type) || []) {
        try { fn(payload); } catch (err) { console.error(err); }
      }
    }
  };
}

// ------------------------------------------------------------- en-tête

const viewEl = document.getElementById("view");
const header = document.getElementById("header");
let ctx = null;
let unmount = null;
let token = 0;
let backHash = "#/projects";
let dropHandler = null;

function setBack(hash) {
  backHash = hash || "#/projects";
}

// Une vue peut prendre la main sur les fichiers glissés (le composeur
// d'envoi, un morceau...). Sinon : feuille d'upload classique.
function setDrop(fn) {
  dropHandler = fn || null;
}

function drawHeader(isRoot) {
  header.innerHTML =
    (isRoot
      ? '<a class="brand-link" href="index.html" aria-label="Accueil WeshTransfer">' + monogram(19) + "</a>"
      : '<button class="btn btn-ghost btn-icon" data-back aria-label="Retour">' + icon("back") + "</button>") +
    '<div class="title" data-title></div>' +
    '<span class="up-pill" data-up hidden></span>' +
    (ctx.space.mode === "envoi" || ctx.space.mode === "revue" ? "" : '<a class="btn btn-ghost btn-icon" href="#/send" aria-label="Envoyer">' + icon("send") + "</a>") +
    '<button class="btn btn-ghost btn-icon people-btn" data-people aria-label="Participants">' + icon("users") +
      '<span class="badge" data-online></span></button>';

  // Retour = parent logique (écoute -> morceau -> accueil), prévisible
  // même quand la page a été ouverte directement depuis un lien.
  const back = header.querySelector("[data-back]");
  if (back) back.onclick = () => navigate(backHash);
  header.querySelector("[data-people]").onclick = () => openPeopleSheet(ctx);
  drawOnline();
  drawUploads();
}

function setTitle(text) {
  const el = header.querySelector("[data-title]");
  if (el) el.textContent = text || "";
  document.title = (text ? text + " · " : "") + "WeshTransfer";
}

function drawOnline() {
  const el = header.querySelector("[data-online]");
  if (el && ctx) el.textContent = ctx.online.size > 1 ? String(ctx.online.size) : "";
}

// pastille "2 uploads" visible partout, pour ne pas perdre de vue ce qui monte
function drawUploads() {
  const el = header.querySelector("[data-up]");
  if (!el) return;
  const n = activeCount();
  el.hidden = n === 0;
  el.innerHTML = n ? icon("upload", 14) + " " + n : "";
}

// ------------------------------------------------------------- routeur

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// Changement de vue en fondu (View Transitions) : l'ancienne vue reste
// affichée le temps que la nouvelle se prépare, 300 ms au plus, puis on
// passe de l'une à l'autre. Sans l'API, ou si l'utilisateur demande moins
// d'animations : changement direct.
function routeSmoothly() {
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || calm || document.hidden) { route(); return; }
  document.startViewTransition(() => Promise.race([route(), new Promise((r) => setTimeout(r, 300))]));
}

function parse() {
  const raw = (location.hash || "#/projects").slice(1);
  const [path, qs] = raw.split("?");
  return { path, query: new URLSearchParams(qs || "") };
}

async function route() {
  const { path, query } = parse();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) { navigate("#/projects"); return; }

  const my = ++token;
  if (unmount) { try { unmount(); } catch (err) { console.error(err); } unmount = null; }

  const view = typeof match.r.view === "function" ? match.r.view() : match.r.view;
  backHash = "#/projects";
  dropHandler = null;
  drawHeader(!!match.r.root);
  setTitle(view.title(ctx));
  window.scrollTo(0, 0);

  try {
    const cleanup = await view.mount(viewEl, ctx, { id: match.m[1], query });
    // une navigation a eu lieu pendant le chargement : on démonte aussitôt
    if (my !== token) { if (cleanup) cleanup(); return; }
    unmount = cleanup || null;
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
  }
}

// ----------------------------------------------------- glisser-déposer
// Des fichiers lâchés n'importe où sur la page (ordinateur) : voile
// "Dépose tes sons", puis la vue courante décide où ils vont.

function bindDrop() {
  const veil = document.createElement("div");
  veil.className = "drop-veil";
  veil.innerHTML = '<div class="drop-box">' + icon("upload", 40) + "<strong>Dépose tes sons</strong></div>";
  veil.hidden = true;
  document.body.appendChild(veil);

  let depth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    veil.hidden = false;
  });
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) veil.hidden = true;
  });
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    veil.hidden = true;
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    if (dropHandler) dropHandler(files);
    else openUploadSheet(ctx, files);
  });
}

// ------------------------------------------------------------- démarrage

async function boot() {
  let space;
  try {
    space = await restore();
  } catch (err) {
    const config = /CONFIG_MANQUANTE|CLE_SECRETE/.test(err.message);
    viewEl.innerHTML = '<div class="empty-state">' + icon("alert", 36) +
      "<p>" + esc(errorText(err)) + "</p>" +
      (config ? "" : '<button class="btn btn-primary" data-reload>Réessayer</button>') + "</div>";
    // pas de onclick="" en ligne : la CSP du site l'interdit
    const retry = viewEl.querySelector("[data-reload]");
    if (retry) retry.onclick = () => location.reload();
    return;
  }

  if (!space) {
    const saved = getSpace();
    // espace disparu (purgé) ou session perdue : on l'oublie sur cet
    // appareil ; s'il existe encore, le code pré-rempli permet d'y revenir
    leaveSpace();
    location.replace("index.html" + (saved && saved.code ? "?c=" + encodeURIComponent(saved.code) : ""));
    return;
  }

  const bus = createBus();
  ctx = { space, bus, navigate, setTitle, setBack, setDrop, online: new Set([space.participantId]) };

  bus.on("presence", (ids) => {
    ctx.online = new Set(ids.length ? ids : [space.participantId]);
    drawOnline();
  });

  let wasDown = false;
  bus.on("realtime", (status) => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      if (!wasDown) toast("Connexion temps réel perdue, reconnexion...", "err");
      wasDown = true;
    } else if (status === "SUBSCRIBED" && wasDown) {
      wasDown = false;
      toast("Reconnecté", "ok");
      route();   // rattrape ce qui a pu être manqué
    }
  });

  // Nouveau son d'un autre participant : petit signal, même hors de la vue.
  bus.on("db", (e) => {
    if (e.table === "files" && e.type === "INSERT" && e.row && e.row.uploaded_by !== space.participantId) {
      toast("Nouveau son : " + (e.row.original_name || ""), "ok");
    }
  });

  onUploads((job) => {
    drawUploads();
    if (job && job.state === "done" && !job.toasted) {
      job.toasted = true;
      toast(job.name + " est en ligne", "ok");
    }
    if (job && job.state === "error" && !job.toastedErr) {
      job.toastedErr = true;
      toast(job.name + " : " + job.error, "err");
    }
  });

  bindPlayerBar(navigate);
  bindDrop();
  connectSpace(space, bus);
  if (space.mode === "seminaire") startJam(space, bus);
  window.addEventListener("hashchange", routeSmoothly);

  // compte : "Mes espaces" à jour depuis le serveur (autres appareils)
  import("./session.js?v=55").then((m) => m.syncSpaces()).catch(() => {});

  // message laissé par l'accueil (ex. réglage refusé à la création)
  try {
    const flash = sessionStorage.getItem("seminaire.flash");
    if (flash) { sessionStorage.removeItem("seminaire.flash"); toast(flash, "err"); }
  } catch (err) { /* privé */ }
  window.addEventListener("offline", () => toast("Hors ligne : les uploads reprendront au retour du réseau", "err"));
  window.addEventListener("online", () => toast("De retour en ligne", "ok"));

  await route();
}

boot();
