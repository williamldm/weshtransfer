// Coquille de l'appli : démarrage, routeur à hash, en-tête, bus
// d'événements, temps réel. Chaque vue est un module avec mount().

import { restore, getSpace } from "./session.js?v=2";
import { connectSpace } from "./realtime.js?v=2";
import { bindPlayerBar } from "./player.js?v=2";
import { activeCount, onUploads } from "./upload.js?v=2";
import { openPeopleSheet } from "./views/people.js?v=2";
import { icon } from "./icons.js?v=2";
import { toast, errorText, esc } from "./ui.js?v=2";

import * as home from "./views/home.js?v=2";
import * as project from "./views/project.js?v=2";
import * as file from "./views/file.js?v=2";
import * as send from "./views/send.js?v=2";
import * as transfers from "./views/transfers.js?v=2";

const ROUTES = [
  { re: /^\/projects$/, view: home, root: true },
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

const view = document.getElementById("view");
const header = document.getElementById("header");
let ctx = null;
let unmount = null;
let token = 0;
let backHash = "#/projects";

function setBack(hash) {
  backHash = hash || "#/projects";
}

function drawHeader(isRoot) {
  header.innerHTML =
    (isRoot
      ? '<span class="brand-dot" aria-hidden="true"></span>'
      : '<button class="btn btn-ghost btn-icon" data-back aria-label="Retour">' + icon("back") + "</button>") +
    '<div class="title" data-title></div>' +
    '<span class="up-pill" data-up hidden></span>' +
    '<a class="btn btn-ghost btn-icon" href="#/send" aria-label="Envoyer">' + icon("send") + "</a>" +
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
  document.title = (text ? text + " · " : "") + "Séminaire";
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

  backHash = "#/projects";
  drawHeader(!!match.r.root);
  setTitle(match.r.view.title(ctx));
  window.scrollTo(0, 0);

  try {
    const cleanup = await match.r.view.mount(view, ctx, { id: match.m[1], query });
    // une navigation a eu lieu pendant le chargement : on démonte aussitôt
    if (my !== token) { if (cleanup) cleanup(); return; }
    unmount = cleanup || null;
  } catch (err) {
    console.error(err);
    view.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
  }
}

// ------------------------------------------------------------- démarrage

async function boot() {
  let space;
  try {
    space = await restore();
  } catch (err) {
    const config = /CONFIG_MANQUANTE|CLE_SECRETE/.test(err.message);
    view.innerHTML = '<div class="empty-state">' + icon("alert", 36) +
      "<p>" + esc(errorText(err)) + "</p>" +
      (config ? "" : '<button class="btn btn-primary" onclick="location.reload()">Réessayer</button>') + "</div>";
    return;
  }

  if (!space) {
    const saved = getSpace();
    location.replace("index.html" + (saved && saved.code ? "?c=" + encodeURIComponent(saved.code) : ""));
    return;
  }

  const bus = createBus();
  ctx = { space, bus, navigate, setTitle, setBack, online: new Set([space.participantId]) };

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
  connectSpace(space, bus);
  window.addEventListener("hashchange", route);
  window.addEventListener("offline", () => toast("Hors ligne : les uploads reprendront au retour du réseau", "err"));
  window.addEventListener("online", () => toast("De retour en ligne", "ok"));

  await route();
}

boot();
