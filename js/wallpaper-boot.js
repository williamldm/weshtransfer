// Chargé en tête de chaque page, avant le premier affichage (blocking=
// "render") : le bon décor est là dès la première image, sans clignoter,
// et la transition entre pages le garde immobile.
import { isThc } from "./mode.js?v=142";
import { currentWallpaper, applyWallpaper, startRotation } from "./wallpapers.js?v=142";

applyWallpaper(currentWallpaper());
// puis les décors défilent tout seuls, sur toutes les pages
const scene = document.querySelector(".scene");
const rotation = startRotation(scene);
// décor interactif (profondeur, traînées) : chargé après le premier
// affichage, pour ne pas le retarder
if (scene) {
  import("./scene-fx.js?v=142").then((m) => {
    m.startSceneFx(scene, rotation);
    // mode THC : le décor se joue (cueillir, rouler, allumer)
    if (isThc) return import("./thc-play.js?v=142").then((p) => p.startThcPlay(scene, rotation));
  }).catch(() => {});
}
