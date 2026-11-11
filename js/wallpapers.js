// Fonds d'écran : le même décor sur toutes les pages pendant une visite
// (accueil, appli, page destinataire), le suivant à la visite d'après, et
// un bouton "Fond suivant" sur l'accueil. Les scènes sont générées par
// tools/scenes.py, sauf la centrale (img/scene.svg), l'originale. Le ?v=
// suit la version du site : un décor retouché s'affiche tout de suite.

import { isThc } from "./mode.js?v=139";

const POLLUTION = [
  { file: "img/scenes/plateforme.svg?v=139", title: "Plateforme pétrolière, torchère allumée", joke: "Chaque envoi rallume la torchère." },
  { file: "img/scenes/serveurs.svg?v=139", title: "Ferme de serveurs dans le désert", joke: "Refroidie à l'eau potable, évidemment." },
  { file: "img/scene.svg?v=139", title: "Centrale thermique, la nuit", joke: "Ce fond d'écran consomme plus que ton frigo." },
  { file: "img/scenes/aeroport.svg?v=139", title: "Aéroport, jets privés", joke: "Un jet par fichier. Deux pour les WAV." },
  { file: "img/scenes/ski.svg?v=139", title: "Station de ski, en août", joke: "Neige artificielle, 24 degrés dehors." },
  { file: "img/scenes/autoroute.svg?v=139", title: "Périphérique, 23 h", joke: "Tous en SUV, clim à fond, seul à bord." },
  { file: "img/scenes/croisiere.svg?v=139", title: "Paquebot de croisière, 6 000 cabines", joke: "Buffet à volonté. Fioul lourd aussi." },
  { file: "img/scenes/fusee.svg?v=139", title: "Tourisme spatial, vol de 11 minutes", joke: "Une vie d'émissions pour un selfie en apesanteur." },
  { file: "img/scenes/golf.svg?v=139", title: "Golf dans le désert", joke: "18 trous, 4 millions de litres d'eau par jour." }
];

// Mode THC (js/mode.js) : ses décors à lui, même mécanique.
const THC = [
  { file: "img/scenes/thc-salon.svg?v=139", title: "Le salon, tard", joke: "Il reste du fichier ? Non, c'était le dernier." },
  { file: "img/scenes/thc-serre.svg?v=139", title: "La serre, lampes allumées", joke: "Chaque envoi arrose une plante." },
  { file: "img/scenes/thc-toit.svg?v=139", title: "Le toit, 3 h du matin", joke: "Le Wi-Fi marche mieux ici. Enfin, je crois." },
  { file: "img/scenes/thc-champ.svg?v=139", title: "Champ de chanvre, pleine lune", joke: "Du chanvre industriel, monsieur l'agent." },
  { file: "img/scenes/thc-snack.svg?v=139", title: "Snack ouvert 24 h", joke: "La fringale n'a pas d'horaires." },
  { file: "img/scenes/thc-festival.svg?v=139", title: "Festival, scène principale", joke: "C'est la machine à fumée, promis." },
  { file: "img/scenes/thc-canal.svg?v=139", title: "Coffee shop, bord du canal", joke: "Ton fichier est parti il y a une heure. Ou dix minutes." }
];

export const WALLPAPERS = isThc ? THC : POLLUTION;
// le décor de la première visite : la centrale (la serre en mode THC)
const FIRST = isThc ? 0 : 2;

const KEY = isThc ? "seminaire.wallpaper.thc" : "seminaire.wallpaper";       // dernier décor vu (d'une visite à l'autre)
const VISIT = "seminaire.wallpaperVisit"; // déjà choisi pour cette visite (onglet)

function read(store, key) {
  try { return store.getItem(key); } catch (err) { return null; }
}
function write(store, key, value) {
  try { store.setItem(key, value); } catch (err) { /* navigation privée */ }
}

// Le décor de cette visite : on avance d'un cran une seule fois par visite,
// puis toutes les pages gardent le même.
export function currentWallpaper() {
  const n = WALLPAPERS.length;
  const last = Number(read(localStorage, KEY));
  const known = read(localStorage, KEY) !== null && Number.isInteger(last) && last >= 0 && last < n;
  if (read(sessionStorage, VISIT)) return known ? last : FIRST;
  const i = known ? (last + 1) % n : FIRST;
  write(localStorage, KEY, String(i));
  write(sessionStorage, VISIT, "1");
  return i;
}

// Posé en variable CSS sur <html> (adresse absolue : une url() relative
// dans une variable se résoudrait par rapport à la feuille de style).
export function applyWallpaper(i) {
  const w = WALLPAPERS[i] || WALLPAPERS[FIRST];
  document.documentElement.style.setProperty("--scene", 'url("' + new URL(w.file, document.baseURI).href + '")');
  return w;
}

// ------------------------------------------------------------- défilement
// Toutes les 20 s, le décor suivant arrive en fondu par-dessus l'actuel
// (préchargé avant, pour ne jamais montrer d'image à moitié chargée). Le
// décor courant est mémorisé : la page suivante reprend où on en était.
// En pause quand l'onglet est caché.

const ROTATE_MS = 20000;
const FADE_MS = 1400;
let rotation = null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
function preload(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
}

export function startRotation(scene) {
  if (rotation || !scene) return rotation;
  let i = currentWallpaper();
  let timer = 0;
  let busy = false;
  const listeners = new Set();
  const fade = document.createElement("div");
  fade.className = "scene-fade";
  fade.setAttribute("aria-hidden", "true");
  scene.appendChild(fade);

  async function go(next) {
    if (busy) return;
    busy = true;
    const url = new URL(WALLPAPERS[next].file, document.baseURI).href;
    await preload(url);
    fade.style.backgroundImage = 'url("' + url + '")';
    await frame();
    fade.classList.add("is-on");
    await wait(FADE_MS);
    // le décor du dessous devient le nouveau, puis le voile disparaît d'un coup
    applyWallpaper(next);
    write(localStorage, KEY, String(next));
    await frame();
    fade.classList.add("is-instant");
    fade.classList.remove("is-on");
    await frame();
    fade.classList.remove("is-instant");
    i = next;
    busy = false;
    for (const fn of listeners) fn(i);
  }

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!document.hidden) await go((i + 1) % WALLPAPERS.length);
      schedule();
    }, ROTATE_MS);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  schedule();

  rotation = {
    get index() { return i; },
    next: async () => { await go((i + 1) % WALLPAPERS.length); schedule(); },
    show: async (n) => { if (n !== i && WALLPAPERS[n]) { await go(n); schedule(); } },
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  return rotation;
}

// Accueil : légende du décor, une pastille par décor (on choisit le sien)
// et le bouton "Fond suivant".
export function mountWallpaperNote(note) {
  if (!note) return;
  const r = rotation || startRotation(document.querySelector(".scene"));
  const dots = note.querySelector("[data-wp-dots]");
  if (dots) {
    dots.innerHTML = WALLPAPERS.map((w, n) =>
      '<button type="button" data-wp="' + n + '" aria-label="Décor ' + (n + 1) + " : " + w.title + '" title="' + w.title + '"></button>').join("");
    dots.onclick = (e) => {
      const b = e.target.closest("[data-wp]");
      if (b && r) r.show(Number(b.dataset.wp));
    };
  }
  const show = (i) => {
    const w = WALLPAPERS[i];
    note.querySelector("[data-wp-title]").textContent = w.title;
    note.querySelector("[data-wp-joke]").textContent = w.joke;
    note.querySelector("[data-wp-n]").textContent = String(i + 1).padStart(2, "0") + " / " + String(WALLPAPERS.length).padStart(2, "0");
    if (dots) for (const b of dots.children) b.setAttribute("aria-current", String(Number(b.dataset.wp) === i));
  };
  show(r ? r.index : currentWallpaper());
  if (!r) return;
  r.onChange(show);
  const btn = note.querySelector("[data-wp-next]");
  if (btn) btn.onclick = () => r.next();
}
