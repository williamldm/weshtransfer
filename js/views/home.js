// Accueil de l'espace : gros boutons d'action, uploads en cours, morceaux
// triés par activité récente.

import { listProjects, createProject, listOpenComments, deleteProject, deleteFile } from "../api.js?v=31";
import { mountUploads } from "./uploads.js?v=31";
import { openUploadSheet } from "./upload-sheet.js?v=31";
import { openPeopleSheet } from "./people.js?v=31";
import { icon } from "../icons.js?v=31";
import { esc, h, kindBadge, timeAgo, plural, promptSheet, toast, errorText, daysLeft, formatDate, actionSheet, confirmSheet } from "../ui.js?v=31";

export const title = (ctx) => ctx.space.name;

// Espace de retours : où en est chaque mix (dernière version validée,
// corrections encore ouvertes, ou en attente d'écoute).
function reviewStatus(files, openByFile) {
  const latest = files.slice().sort((a, b) => b.version_no - a.version_no)[0];
  if (!latest) return "";
  const open = files.reduce((sum, f) => sum + (openByFile.get(f.id) || 0), 0);
  if (latest.approved_at) return '<span class="status is-ok">' + icon("check", 14) + " v" + latest.version_no + " validée</span>";
  if (open) return '<span class="status is-todo">' + plural(open, "retour à corriger", "retours à corriger") + "</span>";
  return '<span class="status">v' + latest.version_no + " en attente d'écoute</span>";
}

export function renderProjects(projects, openByFile, canEdit) {
  const review = !!openByFile;
  if (!projects.length) {
    return '<div class="empty-state">' + icon(review ? "check" : "music", 36) +
      (review
        ? "<p><strong>Aucun mix pour l'instant.</strong><br>Dépose ton premier mix : l'artiste pourra l'écouter et commenter à la seconde près.</p></div>"
        : "<p><strong>Aucun morceau pour l'instant.</strong><br>Ajoute un premier son, il apparaîtra chez tout le monde.</p></div>");
  }
  return projects.map((p) => {
    const files = (p.files || []).filter((f) => f.status === "ready");
    const menu = canEdit && canEdit(p) ? '<button class="btn btn-ghost btn-icon btn-sm row-menu" data-project-menu="' + p.id + '" aria-label="Options">' + icon("more", 18) + "</button>" : "";
    if (review) {
      return '<div class="project-row"><a class="project" href="#/p/' + p.id + '">' +
        '<div class="row"><span class="name">' + esc(p.title) + "</span>" +
        '<span class="count">v' + (files.reduce((m, f) => Math.max(m, f.version_no), 0) || 0) + "</span></div>" +
        '<div class="meta">' + esc(timeAgo(p.last_activity_at)) + "</div>" +
        '<div class="kinds">' + reviewStatus(files, openByFile) + "</div>" +
      "</a>" + menu + "</div>";
    }
    const kinds = [...new Set(files.map((f) => f.kind))];
    const bits = [
      plural(files.length, "version", "versions"),
      timeAgo(p.last_activity_at),
      p.bpm ? p.bpm + " BPM" : "",
      p.musical_key || ""
    ].filter(Boolean);
    return '<div class="project-row"><a class="project" href="#/p/' + p.id + '">' +
      '<div class="row"><span class="name">' + esc(p.title) + "</span>" +
      '<span class="count">' + files.length + "</span></div>" +
      '<div class="meta">' + esc(bits.join(" · ")) + "</div>" +
      (kinds.length ? '<div class="kinds">' + kinds.map(kindBadge).join("") + "</div>" : "") +
    "</a>" + menu + "</div>";
  }).join("");
}

export async function mount(root, ctx) {
  const s = ctx.space;
  const review = s.mode === "revue";
  root.innerHTML =
    '<section class="space-card">' +
      '<div class="space-top">' +
        '<div><div class="eyebrow">' + (review ? "Retours de mix" : "Espace") + "</div><h1>" + esc(s.name) + "</h1></div>" +
        '<button class="code-chip" data-invite aria-label="Inviter">' +
          '<span class="mono">' + esc(s.code) + "</span>" + icon("share", 16) +
        "</button>" +
      "</div>" +
      '<div class="space-meta" data-meta></div>' +
    "</section>" +

    (review && !s.isHost
      ? '<p class="review-hint">' + icon("comment", 18) + "<span>Écoute les mix, mets le son en pause là où quelque chose cloche, et écris ton retour : il sera accroché à la seconde près.</span></p>"
      : "") +
    '<div class="hero-actions">' +
      '<label class="btn btn-primary btn-xl">' + icon("upload", 22) + "<span>" + (review ? "Déposer un mix" : "Ajouter des sons") + "</span>" +
        '<input type="file" multiple hidden data-pick>' +
      "</label>" +
      (review
        ? '<button class="btn btn-xl" data-invite>' + icon("share", 22) + "<span>Inviter l'artiste</span></button>"
        : '<a class="btn btn-xl" href="#/send">' + icon("send", 22) + "<span>Envoyer par email</span></a>") +
    "</div>" +

    '<div data-uploads hidden></div>' +

    '<div class="section-head"><h2>' + (review ? "Mix" : "Morceaux") + "</h2>" +
      '<button class="btn btn-ghost btn-sm" data-new>' + icon("plus", 16) + " Nouveau</button>" +
    "</div>" +
    '<div class="rows" data-list><div class="skeleton"></div><div class="skeleton"></div></div>' +

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

  let lastProjects = [];
  // supprimer : l'auteur du morceau ou le host
  const canEdit = (p) => p.created_by === s.participantId || s.isHost;

  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-project-menu]");
    if (!b) return;
    const p = lastProjects.find((x) => x.id === b.dataset.projectMenu);
    if (!p) return;
    actionSheet(p.title, [
      {
        label: review ? "Supprimer ce mix et toutes ses versions" : "Supprimer le morceau et ses versions", icon: "trash", danger: true,
        run: async () => {
          const ok = await confirmSheet("Toutes les versions, leurs fichiers et leurs commentaires seront effacés.",
            { ok: "Supprimer", danger: true, title: "Supprimer " + p.title });
          if (!ok) return;
          try {
            for (const f of p.files || []) await deleteFile({ id: f.id }).catch(() => {});
            await deleteProject(p.id);
            toast(p.title + " supprimé", "ok");
            load();
          } catch (err) { toast(errorText(err), "err"); }
        }
      }
    ]);
  });

  let loading = false;
  let again = false;
  const load = async () => {
    if (loading) { again = true; return; }
    loading = true;
    try {
      if (review) {
        const [projects, open] = await Promise.all([listProjects(s.id), listOpenComments(s.id)]);
        const byFile = new Map();
        for (const c of open) byFile.set(c.file_id, (byFile.get(c.file_id) || 0) + 1);
        lastProjects = projects;
        list.innerHTML = renderProjects(projects, byFile, canEdit);
      } else {
        lastProjects = await listProjects(s.id);
        list.innerHTML = renderProjects(lastProjects, null, canEdit);
      }
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

  for (const b of root.querySelectorAll("[data-invite]")) b.onclick = () => openPeopleSheet(ctx);

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
    if (e.table === "projects" || e.table === "files" || (review && e.table === "comments")) load();
  });
  const offPresence = ctx.bus.on("presence", drawMeta);

  drawMeta();
  await load();

  return () => { offUploads(); offDb(); offPresence(); };
}
