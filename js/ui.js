// Briques d'interface partagees : messages, formatage.

export function toast(message, kind) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;

  const el = document.createElement("div");
  el.className = kind === "err" ? "toast err" : "toast";
  el.textContent = message;
  wrap.appendChild(el);

  setTimeout(() => el.remove(), kind === "err" ? 6000 : 3500);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return bytes + " o";
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return (value >= 10 ? Math.round(value) : value.toFixed(1)) + " " + units[i];
}

// "il y a 3 min" : en session, savoir si un son date de 2 minutes ou de
// 2 heures compte plus que l'heure exacte.
export function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";

  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 60) return "a l instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return "il y a " + min + " min";
  const hours = Math.floor(min / 60);
  if (hours < 24) return "il y a " + hours + " h";
  const days = Math.floor(hours / 24);
  return days === 1 ? "hier" : "il y a " + days + " jours";
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
