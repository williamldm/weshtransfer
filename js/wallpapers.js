// Fonds d'écran de l'accueil et de la page destinataire : un décor
// différent à chaque visite (dans l'ordre, pour tous les voir), et un
// bouton pour passer au suivant. Les scènes sont générées par
// tools/scenes.py, sauf la centrale (img/scene.svg), l'originale.

export const WALLPAPERS = [
  { file: "img/scenes/plateforme.svg", title: "Plateforme pétrolière, torchère allumée", joke: "Chaque envoi rallume la torchère." },
  { file: "img/scenes/serveurs.svg", title: "Ferme de serveurs dans le désert", joke: "Refroidie à l'eau potable, évidemment." },
  { file: "img/scene.svg", title: "Centrale thermique, la nuit", joke: "Ce fond d'écran consomme plus que ton frigo." },
  { file: "img/scenes/aeroport.svg", title: "Aéroport, jets privés", joke: "Un jet par fichier. Deux pour les WAV." },
  { file: "img/scenes/ski.svg", title: "Station de ski, en août", joke: "Neige artificielle, 24 degrés dehors." },
  { file: "img/scenes/autoroute.svg", title: "Périphérique, 23 h", joke: "Tous en SUV, clim à fond, seul à bord." }
];

const KEY = "seminaire.wallpaper";

function stored() {
  try { return Number(localStorage.getItem(KEY)); } catch (err) { return NaN; }
}

function remember(i) {
  try { localStorage.setItem(KEY, String(i)); } catch (err) { /* navigation privée */ }
}

// scene : l'élément .scene ; note : le texte "Fond d'écran n°..." (facultatif)
export function mountWallpaper(scene, note) {
  if (!scene) return;
  const last = stored();
  let i = Number.isInteger(last) && last >= 0 ? (last + 1) % WALLPAPERS.length : 2;

  const show = () => {
    const w = WALLPAPERS[i];
    scene.style.backgroundImage = 'url("' + w.file + '")';
    remember(i);
    if (note) {
      note.querySelector("[data-wp-text]").innerHTML =
        "Fond d'écran n° " + (i + 1) + " sur " + WALLPAPERS.length + " · " + w.title + ".<br>" + w.joke;
    }
    // le suivant, déjà en cache pour un changement instantané
    const next = new Image();
    next.src = WALLPAPERS[(i + 1) % WALLPAPERS.length].file;
  };

  show();
  const btn = note && note.querySelector("[data-wp-next]");
  if (btn) btn.onclick = () => { i = (i + 1) % WALLPAPERS.length; show(); };
}
