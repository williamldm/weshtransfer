// Coquille de l'appli : démarrage, routeur à hash, en-tête, bus
// d'événements, temps réel. Chaque vue est un module avec mount().

import { restore, restoreFailure, getSpace, leaveSpace, switchTo } from "./session.js?v=126";
import { requireClient } from "./db.js?v=126";
import { connectSpace } from "./realtime.js?v=126";
import { startJam } from "./jam.js?v=126";
import { bindPlayerBar } from "./player.js?v=126";
import { activeCount, onUploads } from "./upload.js?v=126";
import { openPeopleSheet } from "./views/people.js?v=126";
import { openUploadSheet } from "./views/upload-sheet.js?v=126";
import { icon } from "./icons.js?v=126";
import { monogram } from "./brand.js?v=126";
import { toast, errorText, esc } from "./ui.js?v=126";

import * as home from "./views/home.js?v=126";
import * as project from "./views/project.js?v=126";
import * as file from "./views/file.js?v=126";
import * as send from "./views/send.js?v=126";
import * as transfers from "./views/transfers.js?v=126";

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

// Un lien vers un morceau ou une écoute (#/p/..., #/f/..., celui d'un email
// aussi) doit s'ouvrir DANS SON espace. Le lien ne porte pas l'espace : on
// le lit sur le morceau, et si ce n'est pas l'espace de cet onglet, on
// bascule dessus (ou on refuse), jamais on n'affiche un verdict avec
// l'en-tête, le retour et les droits d'un autre.
async function ensureSpaceFor(kind, id) {
  let spaceId = null;
  try {
    const { data } = await requireClient().from(kind === "f" ? "files" : "projects").select("space_id").eq("id", id).maybeSingle();
    spaceId = data ? data.space_id : null;
  } catch (err) { return true; }   // réseau : la vue affichera son erreur
  if (!spaceId || spaceId === ctx.space.id) return true;
  if (switchTo(spaceId)) { location.reload(); return false; }
  viewEl.innerHTML = '<div class="empty-state">' + icon("alert", 36) +
    "<p>Ce lien mène à un autre espace, que tu n'as pas ouvert sur cet appareil.<br>Rejoins-le depuis l'accueil avec son code ou son invitation.</p>" +
    '<a class="btn btn-primary" href="index.html">Accueil</a></div>';
  return false;
}

async function route() {
  const { path, query } = parse();
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) { navigate("#/projects"); return; }
  if (/^\/[pf]\//.test(path)) {
    const before = location.hash;
    const ok = await ensureSpaceFor(path[1], match.m[1]);
    if (!ok || before !== location.hash) return;   // bascule en cours, ou navigation entre-temps
  }

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
    const dt = e.dataTransfer;
    const give = (files) => {
      if (!files || !files.length) return;
      if (dropHandler) dropHandler(files);
      else if (!ctx.space.viewer) openUploadSheet(ctx, files);
    };
    // un dossier déposé part en zip (lu tout de suite, avant tout await)
    const hasDir = Array.from(dt.items || []).some((it) => { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); return en && en.isDirectory; });
    if (!hasDir) { give(dt.files); return; }
    const entries = Array.from(dt.items).filter((it) => it.kind === "file").map((it) => ({ entry: it.webkitGetAsEntry(), file: it.getAsFile() }));
    toast("Préparation du dossier (zip)...", "ok");
    import("./folders.js?v=126").then((m) => m.fromEntries(entries).then(give, (err) => toast(m.folderError(err), "err")));
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
    const why = restoreFailure();
    const code = saved && saved.code ? saved.code : "";
    // dit à l'accueil pourquoi on y revient (message, et pas de boucle)
    try { sessionStorage.setItem("seminaire.bounce", JSON.stringify({ why, code })); } catch (err) { /* privé */ }
    if (why === "session") {
      // Session perdue (révoquée ou expirée) : l'espace existe toujours et
      // l'appareil en fait toujours partie. On ne l'oublie pas et on ne
      // demande pas un code d'espace : il faut se reconnecter au compte.
      location.replace("index.html#connexion");
      return;
    }
    // espace disparu (purgé) ou on n'en fait plus partie : on l'oublie sur
    // cet appareil ; s'il existe encore, le code pré-rempli permet d'y revenir
    leaveSpace();
    location.replace(code ? "/c/" + encodeURIComponent(code) : "index.html");
    return;
  }

  const bus = createBus();
  ctx = { space, bus, navigate, setTitle, setBack, setDrop, online: new Set([space.participantId]) };
  // écoute seule (lien de partage) : les commandes de modification sont
  // masquées (la base les refuse de toute façon)
  document.body.classList.toggle("is-viewer", !!space.viewer);

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
    // formulaire d'envoi : le fichier apparaît dans la liste, pas besoin d'annonce
    const quiet = job && job.meta && String(job.meta.tag || "").startsWith("send-");
    if (job && job.state === "done" && !job.toasted && !quiet) {
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
  import("./session.js?v=126").then((m) => m.syncSpaces()).catch(() => {});
  // limite de taille de ce compte (2 Go, ou plus pour les comptes "gros envois")
  import("./api.js?v=126").then((m) => m.storageConfig()).catch(() => {});

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
