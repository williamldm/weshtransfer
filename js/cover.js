// Pochette d'un espace de retours : chargée une fois, partagée entre
// l'accueil "album", la page d'un morceau et l'écran verrouillé.
// L'image est recadrée au carré et compressée ici, avant l'envoi.

import { getCover, saveCover, removeCover } from "./api.js?v=62";

const cache = new Map();      // spaceId -> Promise<string|null>
const listeners = new Set();

export function coverOf(spaceId) {
  if (!cache.has(spaceId)) cache.set(spaceId, getCover(spaceId).catch(() => null));
  return cache.get(spaceId);
}

export function onCover(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(spaceId, image) {
  cache.set(spaceId, Promise.resolve(image));
  for (const fn of listeners) fn(spaceId, image);
}

const SIZE = 640;
const MAX_CHARS = 280000;

function loadImage(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file).catch(() => loadWithElement(file));
  }
  return loadWithElement(file);
}

function loadWithElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible : essaie en JPG ou PNG.")); };
    img.src = url;
  });
}

// Recadrage carré au centre, 640 px, JPEG : quelques dizaines de Ko.
export async function coverFromFile(file) {
  if (!file || !/^image\//.test(file.type || "")) throw new Error("Choisis une image (JPG, PNG...).");
  if (file.size > 30 * 1024 * 1024) throw new Error("Image trop lourde (30 Mo max).");
  const img = await loadImage(file);
  const w = img.width, h = img.height;
  const side = Math.min(w, h);
  const out = Math.min(SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const g = canvas.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, out, out);
  g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  if (img.close) img.close();
  for (const quality of [0.86, 0.75, 0.62, 0.5]) {
    const data = canvas.toDataURL("image/jpeg", quality);
    if (data.length <= MAX_CHARS) return data;
  }
  throw new Error("Image trop détaillée, essaie une autre.");
}

export async function setCover(spaceId, file) {
  const image = await coverFromFile(file);
  await saveCover(spaceId, image);
  changed(spaceId, image);
  return image;
}

export async function clearCover(spaceId) {
  await removeCover(spaceId);
  changed(spaceId, null);
}
