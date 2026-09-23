// Fichiers déposés sur l'accueil, transmis au composeur de la page
// suivante. Un File ne survit pas à une navigation : on le confie à
// IndexedDB le temps du trajet (quelques secondes), puis on l'efface.
// Au-delà de MAX_BYTES, on ne stocke pas : on les redemandera.

const DB = "weshtransfer";
const STORE = "pending";
export const MAX_BYTES = 1.5 * 1024 * 1024 * 1024;
const TTL = 10 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const out = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(out && out.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

// true si les fichiers ont pu être mis de côté
export async function putPending(files) {
  const list = Array.from(files || []);
  const total = list.reduce((s, f) => s + f.size, 0);
  if (!list.length || total > MAX_BYTES || !("indexedDB" in window)) return false;
  try {
    await run("readwrite", (store) => store.put({ at: Date.now(), files: list }, "files"));
    return true;
  } catch (err) {
    return false;   // navigation privée, quota : on les redemandera
  }
}

export async function takePending() {
  if (!("indexedDB" in window)) return [];
  try {
    const entry = await run("readonly", (store) => store.get("files"));
    await run("readwrite", (store) => store.delete("files"));
    if (!entry || Date.now() - entry.at > TTL) return [];
    return entry.files || [];
  } catch (err) {
    return [];
  }
}
