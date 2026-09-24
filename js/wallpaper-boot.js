// Chargé en tête de chaque page, avant le premier affichage (blocking=
// "render") : le bon décor est là dès la première image, sans clignoter,
// et la transition entre pages le garde immobile.
import { currentWallpaper, applyWallpaper, startRotation } from "./wallpapers.js?v=40";

applyWallpaper(currentWallpaper());
// puis les décors défilent tout seuls, sur toutes les pages
startRotation(document.querySelector(".scene"));
