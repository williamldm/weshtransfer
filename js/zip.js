// "Tout télécharger" en un zip, fabriqué dans le navigateur au fil de l'eau
// (client-zip) : les fichiers sont lus un par un et jamais tous en mémoire.
//
// Sur Chrome/Edge ordinateur, le zip part directement sur le disque
// (showSaveFilePicker) : aucune limite de taille. Ailleurs, il passe par un
// Blob en mémoire, raisonnable jusqu'à ~1,5 Go.

import { downloadZip, predictLength } from "https://cdn.jsdelivr.net/npm/client-zip@2.5.1/+esm";

export const MEMORY_LIMIT = 1.5 * 1024 * 1024 * 1024;

export function canStreamToDisk() {
  return typeof window.showSaveFilePicker === "function";
}

// Noms uniques dans l'archive : deux versions "beat.wav" ne doivent pas
// s'écraser à la décompression.
export function uniqueNames(entries) {
  const seen = new Map();
  return entries.map((e) => {
    const clean = e.name.replace(/[\\/:*?"<>|]+/g, "_");
    const n = seen.get(clean.toLowerCase()) || 0;
    seen.set(clean.toLowerCase(), n + 1);
    if (!n) return Object.assign({}, e, { name: clean });
    const dot = clean.lastIndexOf(".");
    const name = dot > 0
      ? clean.slice(0, dot) + " (" + (n + 1) + ")" + clean.slice(dot)
      : clean + " (" + (n + 1) + ")";
    return Object.assign({}, e, { name });
  });
}

// entries : [{ name, url, size }]
// À appeler DIRECTEMENT dans le gestionnaire de clic : le sélecteur de
// fichier exige un geste utilisateur, il doit être le premier await.
export async function saveZip(zipName, rawEntries, onProgress) {
  const entries = uniqueNames(rawEntries);
  const total = Number(predictLength(entries.map((e) => ({ name: e.name, size: e.size || 0 }))));

  let handle = null;
  if (canStreamToDisk()) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: zipName,
        types: [{ description: "Archive zip", accept: { "application/zip": [".zip"] } }]
      });
    } catch (err) {
      if (err && err.name === "AbortError") return false;
      handle = null;
    }
  }

  async function* files() {
    for (const e of entries) {
      const res = await fetch(e.url);
      if (!res.ok) throw new Error("Téléchargement impossible : " + e.name);
      yield { name: e.name, input: res, size: e.size || undefined };
    }
  }

  const zipped = downloadZip(files(), { length: total || undefined });
  let done = 0;
  const counter = new TransformStream({
    transform(chunk, ctrl) {
      done += chunk.byteLength;
      if (onProgress && total) onProgress(Math.min(1, done / total));
      ctrl.enqueue(chunk);
    }
  });
  const stream = zipped.body.pipeThrough(counter);

  if (handle) {
    const writable = await handle.createWritable();
    await stream.pipeTo(writable);
    return true;
  }

  const blob = await new Response(stream).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
