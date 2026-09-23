// Accueil de l'espace : gros boutons d'action, uploads en cours, morceaux
// triés par activité récente.

import { listProjects, createProject } from "../api.js?v=12";
import { mountUploads } from "./uploads.js?v=12";
import { openUploadSheet } from "./upload-sheet.js?v=12";
import { openPeopleSheet } from "./people.js?v=12";
import { icon } from "../icons.js?v=12";
import { esc, h, kindBadge, timeAgo, plural, promptSheet, toast, errorText, daysLeft, formatDate } from "../ui.js?v=12";

export const title = (ctx) => ctx.space.name;

export function renderProjects(projects) {
  if (!projects.length) {
    return '<div class="empty-state">' + icon("music", 36) +
      "<p><strong>Aucun morceau pour l'instant.</strong><br>Ajoute un premier son, il apparaîtra chez tout le monde.</p></div>";
  }
  return projects.map((p) => {
    const files = (p.files || []).filter((f) => f.status === "ready");
    const kinds = [...new Set(files.map((f) => f.kind))];
    const bits = [
      plural(files.length, "version", "versions"),
      timeAgo(p.last_activity_at),
      p.bpm ? p.bpm + " BPM" : "",
      p.musical_key || ""
    ].filter(Boolean);
    return '<a class="project" href="#/p/' + p.id + '">' +
      '<div class="row"><span class="name">' + esc(p.title) + "</span>" +
      '<span class="count">' + files.length + "</span></div>" +
      '<div class="meta">' + esc(bits.join(" · ")) + "</div>" +
      (kinds.length ? '<div class="kinds">' + kinds.map(kindBadge).join("") + "</div>" : "") +
    "</a>";
  }).join("");
}

export async function mount(root, ctx) {
  const s = ctx.space;
  root.innerHTML =
    '<section class="space-card">' +
      '<div class="space-top">' +
        '<div><div class="eyebrow">Espace</div><h1>' + esc(s.name) + "</h1></div>" +
        '<button class="code-chip" data-invite aria-label="Inviter">' +
          '<span class="mono">' + esc(s.code) + "</span>" + icon("share", 16) +
        "</button>" +
      "</div>" +
      '<div class="space-meta" data-meta></div>' +
    "</section>" +

    '<div class="hero-actions">' +
      '<label class="btn btn-primary btn-xl">' + icon("upload", 22) + "<span>Ajouter des sons</span>" +
        '<input type="file" multiple hidden data-pick>' +
      "</label>" +
      '<a class="btn btn-xl" href="#/send">' + icon("send", 22) + "<span>Envoyer par email</span></a>" +
    "</div>" +

    '<div data-uploads hidden></div>' +

    '<div class="section-head"><h2>Morceaux</h2>' +
      '<button class="btn btn-ghost btn-sm" data-new>' + icon("plus", 16) + " Nouveau</button>" +
    "</div>" +
    '<div data-list><div class="skeleton"></div><div class="skeleton"></div></div>' +

    '<a class="link-row" href="#/transfers">' + icon("mail", 18) + "<span>Envois par email et liens</span>" + icon("chevron", 18) + "</a>";

  const list = root.querySelector("[data-list]");
  const meta = root.querySelector("[data-meta]");

  const drawMeta = () => {
    const online = ctx.online.size;
    const left = s.purgeAt ? daysLeft(s.purgeAt) : null;
    meta.innerHTML =
      '<span class="dot-online"></span>' + plural(Math.max(online, 1), "personne en ligne", "personnes en ligne") +
      (left != null ? ' · <span title="' + esc(formatDate(s.purgeAt)) + '">fichiers supprimés dans ' + plural(left, "jour", "jours") + "</span>" : "");
  };

  let loading = false;
  let again = false;
  const load = async () => {
    if (loading) { again = true; return; }
    loading = true;
    try {
      list.innerHTML = renderProjects(await listProjects(s.id));
    } catch (err) {
      list.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
    }
    loading = false;
    if (again) { again = false; load(); }
  };

  root.querySelector("[data-pick]").addEventListener("change", (e) => {
    openUploadSheet(ctx, e.target.files);
    e.target.value = "";
  });

  root.querySelector("[data-invite]").onclick = () => openPeopleSheet(ctx);

  root.querySelector("[data-new]").onclick = async () => {
    const t = await promptSheet("Nouveau morceau", "", { ok: "Créer" });
    if (!t) return;
    try {
      const p = await createProject(s.id, t);
      ctx.navigate("#/p/" + p.id);
    } catch (err) {
      toast(errorText(err), "err");
    }
  };

  const offUploads = mountUploads(root.querySelector("[data-uploads]"));
  const offDb = ctx.bus.on("db", (e) => {
    if (e.table === "projects" || e.table === "files") load();
  });
  const offPresence = ctx.bus.on("presence", drawMeta);

  drawMeta();
  await load();

  return () => { offUploads(); offDb(); offPresence(); };
}
