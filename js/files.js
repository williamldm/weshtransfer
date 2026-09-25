// Types de fichiers : tout est accepté, sauf les programmes et scripts.
// Chaque fichier est rangé dans une catégorie qui décide de son aperçu
// (lecteur audio, vignette, vidéo, document...) et de son icône.

// Refusés : ce qui s'exécute. Un lien de partage ne doit pas pouvoir
// servir à distribuer un virus sous le nom du service.
export const BLOCKED_EXT = [
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "dll", "sys", "msc",
  "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "ps1", "psm1", "reg", "lnk",
  "jar", "apk", "app", "dmg", "pkg", "sh", "command"
];

const GROUPS = {
  audio: ["mp3", "wav", "aif", "aiff", "m4a", "flac", "ogg", "oga", "opus", "aac", "wma", "caf"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg", "psd"],
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpg", "mpeg"],
  document: ["pdf", "doc", "docx", "txt", "rtf", "md", "odt", "pages", "xls", "xlsx", "csv", "numbers", "key", "ppt", "pptx"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"],
  // sessions et fichiers de travail des logiciels de musique
  project: ["als", "alp", "adg", "adv", "flp", "fst", "logic", "logicx", "ptx", "ptf", "cpr", "npr",
            "rpp", "song", "band", "aup3", "mid", "midi", "fxp", "fxb", "nki", "nmsv", "sfz", "sf2"]
};

export const CATEGORY = {
  audio:    { label: "Audio",    icon: "music" },
  image:    { label: "Image",    icon: "image" },
  video:    { label: "Vidéo",    icon: "video" },
  document: { label: "Document", icon: "doc" },
  archive:  { label: "Archive",  icon: "archive" },
  project:  { label: "Projet",   icon: "layers" },
  other:    { label: "Fichier",  icon: "file" }
};

const MIME = {
  mp3: "audio/mpeg", wav: "audio/wav", aif: "audio/aiff", aiff: "audio/aiff", m4a: "audio/mp4",
  flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", heic: "image/heic", heif: "image/heif", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  zip: "application/zip", mid: "audio/midi", midi: "audio/midi"
};

// 2 Go par fichier, partout (le serveur applique la même limite)
export const FILE_MAX = 2 * 1024 * 1024 * 1024;

export function extOf(name) {
  const m = /\.([a-z0-9]{1,10})$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

export function categoryOf(name, mime) {
  const ext = extOf(name);
  for (const [cat, list] of Object.entries(GROUPS)) {
    if (list.includes(ext)) return cat;
  }
  const m = String(mime || "");
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  return "other";
}

export function mimeOf(name, browserType) {
  const ext = extOf(name);
  // le navigateur mobile donne souvent application/octet-stream : on préfère
  // notre table quand elle connaît l'extension
  if (MIME[ext]) return MIME[ext];
  if (browserType && browserType !== "application/octet-stream") return browserType;
  return "application/octet-stream";
}

export function isBlocked(name) {
  return BLOCKED_EXT.includes(extOf(name));
}

// Ce que le navigateur sait afficher directement (sinon : icône + téléchargement)
export function canPreview(name, mime) {
  const cat = categoryOf(name, mime);
  const ext = extOf(name);
  if (cat === "audio") return !["wma", "caf"].includes(ext);
  if (cat === "image") return ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(ext);
  if (cat === "video") return ["mp4", "m4v", "webm", "mov"].includes(ext);
  return ext === "pdf";
}

export function isAudio(name, mime) {
  return categoryOf(name, mime) === "audio";
}
