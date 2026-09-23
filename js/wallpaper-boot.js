// Chargé en tête de chaque page, avant le premier affichage (blocking=
// "render") : le bon décor est là dès la première image, sans clignoter,
// et la transition entre pages le garde immobile.
import { currentWallpaper, applyWallpaper } from "./wallpapers.js?v=34";

applyWallpaper(currentWallpaper());
