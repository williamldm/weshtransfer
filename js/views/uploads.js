// Rendu de la file d'upload (liste de progression), réutilisé par
// l'accueil et la page d'un morceau.

import { onUploads, getJobs, cancel, retry, dismiss } from "../upload.js?v=17";
import { icon } from "../icons.js?v=17";
import { esc, formatBytes } from "../ui.js?v=17";

const STATE_LABEL = {
  queued: "En attente",
  uploading: "",
  waiting: "Finalisation...",
  saving: "Finalisation...",
  done: "Uploadé",
  error: "Échec",
  canceled: "Annulé"
};

export function renderJob(job) {
  const pct = job.size ? Math.floor((job.loaded / job.size) * 100) : 0;
  const detail = job.state === "uploading"
    ? pct + " % · " + formatBytes(job.loaded) + " / " + formatBytes(job.size) +
      (job.speed > 0 ? " · " + formatBytes(job.speed) + "/s" : "")
    : job.state === "error" ? esc(job.error || "Échec")
    : STATE_LABEL[job.state] + (job.state === "queued" ? " · " + formatBytes(job.size) : "");

  const actions = job.state === "uploading" || job.state === "queued"
    ? '<button class="btn btn-ghost btn-icon btn-sm" data-cancel="' + job.id + '" aria-label="Annuler">' + icon("x", 18) + "</button>"
    : job.state === "error" || job.state === "canceled"
      ? '<button class="btn btn-ghost btn-icon btn-sm" data-retry="' + job.id + '" aria-label="Réessayer">' + icon("retry", 18) + "</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm" data-dismiss="' + job.id + '" aria-label="Retirer">' + icon("x", 18) + "</button>"
      : job.state === "done"
        ? '<span class="job-ok">' + icon("check", 18) + "</span>"
        : "";

  return '<div class="job is-' + job.state + '">' +
    '<div class="job-main">' +
      '<div class="job-name">' + esc(job.name) + "</div>" +
      '<div class="progress"><i style="width:' + (["done", "saving", "waiting"].includes(job.state) ? 100 : pct) + '%"></i></div>' +
      '<div class="job-detail">' + detail + "</div>" +
    "</div>" +
    '<div class="job-actions">' + actions + "</div>" +
  "</div>";
}

// Monte une file d'upload dans el ; filter(job) restreint l'affichage.
export function mountUploads(el, filter) {
  const draw = () => {
    const list = getJobs().filter((j) => !filter || filter(j));
    el.hidden = list.length === 0;
    el.innerHTML = list.length
      ? '<div class="section-head"><h2>Uploads</h2></div><div class="jobs">' + list.map(renderJob).join("") + "</div>"
      : "";
  };

  const onClick = (e) => {
    const c = e.target.closest("[data-cancel]");
    const r = e.target.closest("[data-retry]");
    const d = e.target.closest("[data-dismiss]");
    if (c) cancel(Number(c.dataset.cancel));
    if (r) retry(Number(r.dataset.retry));
    if (d) dismiss(Number(d.dataset.dismiss));
  };

  // redessin au plus une fois par frame : onProgress tombe très souvent
  let pending = false;
  const off = onUploads(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  });

  el.addEventListener("click", onClick);
  draw();
  return () => { off(); el.removeEventListener("click", onClick); };
}
