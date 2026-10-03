// Envoyer un DOSSIER entier (session FL Studio, projet Logic .logicx, qui
// est un dossier pour macOS...). Un navigateur ne sait envoyer que des
// fichiers : le dossier est donc mis dans un zip, fabriqué ici (sans
// compression, c'est rapide), sous le nom "Mon dossier.zip". Le
// destinataire le décompresse et retrouve l'arborescence telle quelle.
//
// Deux entrées :
//   - glisser-déposer : readDrop(dataTransfer), à appeler TOUT DE SUITE
//     dans le gestionnaire "drop" (les éléments ne sont plus lisibles après
//     un await), puis fromEntries(...) ;
//   - bouton "un dossier" : fromFolderInput(input.files).
// Les deux rendent une liste de File (fichiers simples + un zip par dossier).

import { FILE_MAX, fileMaxLabel, isBlocked } from "./files.js?v=129";

const ZIP_MEMORY_MAX = 1024 * 1024 * 1024;   // 1 Go
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\.Spotlight-V100|\.Trashes|__MACOSX)(\/|$)|(^|\/)\._/;

function readAll(reader) {
  return new Promise((resolve, reject) => {
    const out = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(out); return; }
      out.push(...batch);
      next();   // readEntries rend les entrées par paquets de 100
    }, reject);
    next();
  });
}

async function walk(entry, path, out) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ path: path + entry.name, file });
    return;
  }
  const children = await readAll(entry.createReader());
  for (const child of children) await walk(child, path + entry.name + "/", out);
}

// [{ path, file }] -> File "nom.zip"
async function zipFolder(name, items) {
  const kept = items.filter((it) => !JUNK.test(it.path) && !isBlocked(it.file.name));
  if (!kept.length) throw new Error("DOSSIER_VIDE");
  const total = kept.reduce((n, it) => n + it.file.size, 0);
  if (total > FILE_MAX) throw new Error("DOSSIER_TROP_LOURD");
  // le zip se construit en mémoire : au-delà, l'onglet saute (Safari surtout)
  if (total > ZIP_MEMORY_MAX) throw new Error("DOSSIER_A_COMPRESSER");
  const { downloadZip } = await import("https://cdn.jsdelivr.net/npm/client-zip@2.5.1/+esm");
  const blob = await downloadZip(kept.map((it) => ({ name: it.path, input: it.file, lastModified: new Date(it.file.lastModified) }))).blob();
  return new File([blob], name + ".zip", { type: "application/zip", lastModified: Date.now() });
}

// Le dépôt contient-il un dossier ? (à appeler dans le gestionnaire "drop")
export function dropHasFolder(dt) {
  return Array.from((dt && dt.items) || []).some((it) => { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); return en && en.isDirectory; });
}
// À appeler dans le gestionnaire "drop", avant tout await.
export function readDrop(dt) {
  return Array.from((dt && dt.items) || []).filter((it) => it.kind === "file")
    .map((it) => ({ entry: it.webkitGetAsEntry ? it.webkitGetAsEntry() : null, file: it.getAsFile() }));
}
// entries : résultat de readDrop -> fichiers simples + un zip par dossier
export async function fromEntries(entries) {
  const out = [];
  for (const { entry, file } of entries) {
    if (entry && entry.isDirectory) {
      const list = [];
      await walk(entry, "", list);
      out.push(await zipFolder(entry.name, list));
    } else if (file) out.push(file);
  }
  return out;
}

// <input type="file" webkitdirectory> : tous les fichiers du dossier choisi
export async function fromFolderInput(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return [];
  const name = (files[0].webkitRelativePath || "Dossier").split("/")[0] || "Dossier";
  return [await zipFolder(name, files.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })))];
}

export function folderError(err) {
  const code = String((err && err.message) || err);
  if (/DOSSIER_VIDE/.test(code)) return "Ce dossier est vide.";
  if (/DOSSIER_A_COMPRESSER/.test(code)) return "Ce dossier dépasse 1 Go : compresse-le dans le Finder (clic droit, Compresser), puis envoie le .zip. Le navigateur n'a pas assez de mémoire pour le faire lui-même.";
  if (/DOSSIER_TROP_LOURD/.test(code)) return "Ce dossier dépasse " + fileMaxLabel() + " : envoie-le en plusieurs morceaux.";
  return "Impossible de lire ce dossier. Essaie de le compresser dans le Finder (clic droit, Compresser).";
}
