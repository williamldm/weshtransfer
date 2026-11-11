// Mode THC : une direction artistique en option, comme un mode sombre.
// Même site, autre palette (vert, lampes violettes), autres décors, autres
// blagues. Mémorisé sur l'appareil seulement ; jamais dans un lien, jamais
// côté serveur. Posé sur <html data-mode="thc"> avant le premier affichage
// (ce module est chargé par wallpaper-boot.js, qui bloque le rendu).

const KEY = "weshtransfer.mode";

function read() {
  try { return localStorage.getItem(KEY) === "thc" ? "thc" : ""; } catch (err) { return ""; }
}

export const MODE = read();
export const isThc = MODE === "thc";

if (isThc) {
  document.documentElement.dataset.mode = "thc";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#0B0F0C";
}

// Changer de mode recharge la page : décors, textes et titre repartent du
// bon pied, sans état à moitié changé.
export function setMode(thc) {
  try {
    if (thc) localStorage.setItem(KEY, "thc");
    else localStorage.removeItem(KEY);
  } catch (err) { /* navigation privée : le mode ne tient pas */ }
  location.reload();
}
