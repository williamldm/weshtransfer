// Fonds d'écran : le même décor sur toutes les pages pendant une visite
// (accueil, appli, page destinataire), le suivant à la visite d'après, et
// un bouton "Fond suivant" sur l'accueil. Les scènes sont générées par
// tools/scenes.py, sauf la centrale (img/scene.svg), l'originale. Le ?v=
// suit la version du site : un décor retouché s'affiche tout de suite.

export const WALLPAPERS = [
  { file: "img/scenes/plateforme.svg?v=76", title: "Plateforme pétrolière, torchère allumée", joke: "Chaque envoi rallume la torchère." },
  { file: "img/scenes/serveurs.svg?v=76", title: "Ferme de serveurs dans le désert", joke: "Refroidie à l'eau potable, évidemment." },
  { file: "img/scene.svg?v=76", title: "Centrale thermique, la nuit", joke: "Ce fond d'écran consomme plus que ton frigo." },
  { file: "img/scenes/aeroport.svg?v=76", title: "Aéroport, jets privés", joke: "Un jet par fichier. Deux pour les WAV." },
  { file: "img/scenes/ski.svg?v=76", title: "Station de ski, en août", joke: "Neige artificielle, 24 degrés dehors." },
  { file: "img/scenes/autoroute.svg?v=76", title: "Périphérique, 23 h", joke: "Tous en SUV, clim à fond, seul à bord." }
];

const KEY = "seminaire.wallpaper";       // dernier décor vu (d'une visite à l'autre)
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
  if (read(sessionStorage, VISIT)) return known ? last : 2;
  const i = known ? (last + 1) % n : 2;
  write(localStorage, KEY, String(i));
  write(sessionStorage, VISIT, "1");
  return i;
}

// Posé en variable CSS sur <html> (adresse absolue : une url() relative
// dans une variable se résoudrait par rapport à la feuille de style).
export function applyWallpaper(i) {
  const w = WALLPAPERS[i] || WALLPAPERS[2];
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
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
  return rotation;
}

// Accueil : légende "Fond d'écran n° x sur 6" et bouton "Fond suivant".
export function mountWallpaperNote(note) {
  if (!note) return;
  const r = rotation || startRotation(document.querySelector(".scene"));
  const show = (i) => {
    const w = WALLPAPERS[i];
    note.querySelector("[data-wp-text]").innerHTML =
      "Fond d'écran n° " + (i + 1) + " sur " + WALLPAPERS.length + " · " + w.title + ".<br>" + w.joke;
  };
  show(r ? r.index : currentWallpaper());
  if (!r) return;
  r.onChange(show);
  const btn = note.querySelector("[data-wp-next]");
  if (btn) btn.onclick = () => r.next();
}
