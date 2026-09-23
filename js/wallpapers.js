// Fonds d'écran : le même décor sur toutes les pages pendant une visite
// (accueil, appli, page destinataire), le suivant à la visite d'après, et
// un bouton "Fond suivant" sur l'accueil. Les scènes sont générées par
// tools/scenes.py, sauf la centrale (img/scene.svg), l'originale.

export const WALLPAPERS = [
  { file: "img/scenes/plateforme.svg", title: "Plateforme pétrolière, torchère allumée", joke: "Chaque envoi rallume la torchère." },
  { file: "img/scenes/serveurs.svg", title: "Ferme de serveurs dans le désert", joke: "Refroidie à l'eau potable, évidemment." },
  { file: "img/scene.svg", title: "Centrale thermique, la nuit", joke: "Ce fond d'écran consomme plus que ton frigo." },
  { file: "img/scenes/aeroport.svg", title: "Aéroport, jets privés", joke: "Un jet par fichier. Deux pour les WAV." },
  { file: "img/scenes/ski.svg", title: "Station de ski, en août", joke: "Neige artificielle, 24 degrés dehors." },
  { file: "img/scenes/autoroute.svg", title: "Périphérique, 23 h", joke: "Tous en SUV, clim à fond, seul à bord." }
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

// Accueil : légende "Fond d'écran n° x sur 6" et bouton "Fond suivant".
export function mountWallpaperNote(note) {
  if (!note) return;
  let i = currentWallpaper();
  const show = () => {
    const w = applyWallpaper(i);
    note.querySelector("[data-wp-text]").innerHTML =
      "Fond d'écran n° " + (i + 1) + " sur " + WALLPAPERS.length + " · " + w.title + ".<br>" + w.joke;
    const next = new Image();   // le suivant déjà en cache : changement instantané
    next.src = WALLPAPERS[(i + 1) % WALLPAPERS.length].file;
  };
  show();
  const btn = note.querySelector("[data-wp-next]");
  if (btn) {
    btn.onclick = () => {
      i = (i + 1) % WALLPAPERS.length;
      write(localStorage, KEY, String(i));
      show();
    };
  }
}
