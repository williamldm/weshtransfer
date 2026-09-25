// Un morceau : ses versions de la plus récente à la plus ancienne, chacune
// avec sa mini-waveform jouable d'un tap.

import { getProject, signFiles, cachedUrl, cachedDownload, updateProject, deleteProject, deleteFile } from "../api.js?v=67";
import { mountUploads } from "./uploads.js?v=67";
import { openUploadSheet } from "./upload-sheet.js?v=67";
import { Waveform } from "../waveform.js?v=67";
import { play, toggle, isCurrent, onPlayer, seekRatio, state as playerState, trackFromFile } from "../player.js?v=67";
import { saveZip, canStreamToDisk, MEMORY_LIMIT } from "../zip.js?v=67";
import { icon } from "../icons.js?v=67";
import { isAudio, canPreview } from "../files.js?v=67";
import {
  esc, fileBadge, fileTile, timeAgo, formatBytes, formatDuration, plural, promptSheet,
  confirmSheet, actionSheet, toast, errorText, triggerDownload
} from "../ui.js?v=67";

export const title = () => "Morceau";

function waveColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    idleColor: cs.getPropertyValue("--wave-idle").trim() || "#3a4150",
    playedColor: cs.getPropertyValue("--wave-played").trim() || "#a78bfa",
    markerColor: cs.getPropertyValue("--accent-hi").trim() || "#c4b5fd"
  };
}

// review : en retours de mix, { fixed } = retours corrigés DANS cette
// version (quelle que soit la version où ils avaient été écrits).
export function renderVersion(f, me, review) {
  const comments = (Array.isArray(f.comments) ? f.comments : []).filter((c) => !c.parent_id);
  const n = comments.length;
  const open = comments.filter((c) => !c.resolved_at).length;
  const fixed = review && review.fixed ? review.fixed : 0;
  const bits = [
    f.uploader ? f.uploader.pseudo : "?",
    timeAgo(f.created_at),
    f.duration_sec ? formatDuration(Number(f.duration_sec)) : "",
    formatBytes(f.size_bytes)
  ].filter(Boolean);
  const playable = isAudio(f.original_name, f.mime_type) && canPreview(f.original_name, f.mime_type);
  return '<article class="version' + (isCurrent(f.id) ? " is-current" : "") + '" data-id="' + f.id + '">' +
    '<div class="version-top">' +
      (playable
        ? '<button class="play-btn" data-play aria-label="Lire">' + icon(isCurrent(f.id) && playerState().playing ? "pause" : "play", 20) + "</button>"
        : fileTile(f.original_name, f.mime_type)) +
      '<a class="version-main" href="#/f/' + f.id + '">' +
        '<div class="version-title"><span class="vno">v' + f.version_no + "</span>" +
          (f.label ? '<span class="vlabel">' + esc(f.label) + "</span>" : "") + fileBadge(f.original_name, f.mime_type, f.kind) + "</div>" +
        '<div class="version-meta">' + esc(bits.join(" · ")) +
          (review
            ? (fixed ? ' · <span class="ccount is-ok">' + icon("check", 13) + plural(fixed, "corrigé ici", "corrigés ici") + "</span>" : "") +
              (open ? ' · <span class="ccount is-todo">' + icon("comment", 13) + plural(open, "à corriger", "à corriger") + "</span>"
                : n ? ' · <span class="ccount">' + icon("comment", 13) + plural(n, "retour", "retours") + "</span>" : "")
            : (n ? ' · <span class="ccount">' + icon("comment", 13) + n + "</span>" : "")) + "</div>" +
          (review && f.changelog ? '<p class="version-note">' + esc(f.changelog) + "</p>" : "") +
          (f.approved_at ? '<div class="approved">' + icon("check", 14) + " Validée" + (f.approved_by ? " par " + esc(f.approved_by) : "") + "</div>" : "") +
      "</a>" +
      '<button class="btn btn-ghost btn-icon" data-more aria-label="Actions">' + icon("more") + "</button>" +
    "</div>" +
    (playable ? '<div class="wave wave-sm"><canvas></canvas></div>' : '<div class="wave-none">' + esc(f.original_name) + "</div>") +
  "</article>";
}

export async function mount(root, ctx, params) {
  const id = params.id;
  let project = null;
  let waves = new Map();

  root.innerHTML = '<div class="skeleton tall"></div><div class="skeleton"></div>';

  const readyFiles = () => (project ? project.files.filter((f) => f.status === "ready") : []);

  function destroyWaves() {
    for (const w of waves.values()) w.destroy();
    waves = new Map();
  }

  function draw() {
    const files = readyFiles();
    const mine = project.created_by === ctx.space.participantId;
    const meta = [
      plural(files.length, "version", "versions"),
      project.bpm ? project.bpm + " BPM" : "",
      project.musical_key || "",
      project.creator ? "créé par " + project.creator.pseudo : ""
    ].filter(Boolean).join(" · ");

    destroyWaves();
    root.innerHTML =
      '<header class="page-head">' +
        '<div class="eyebrow">Morceau</div>' +
        '<h1 class="editable" data-rename>' + esc(project.title) + icon("edit", 16) + "</h1>" +
        '<div class="meta">' + esc(meta) + "</div>" +
      "</header>" +
      '<div class="actions-row">' +
        '<label class="btn btn-primary">' + icon("plus", 18) + "<span>Nouvelle version</span>" +
          '<input type="file" multiple hidden data-pick></label>' +
        '<a class="btn" href="#/send?p=' + project.id + '">' + icon("send", 18) + "<span>Envoyer</span></a>" +
        (files.length ? '<button class="btn" data-zip>' + icon("download", 18) + "<span>Tout (zip)</span></button>" : "") +
        (mine || ctx.space.isHost ? '<button class="btn btn-ghost btn-icon" data-pmore aria-label="Plus">' + icon("more") + "</button>" : "") +
      "</div>" +
      '<div data-uploads hidden></div>' +
      '<div class="versions" data-versions>' +
        (files.length
          ? files.map((f) => renderVersion(f, ctx.space.participantId, ctx.space.mode === "revue"
              ? { fixed: files.reduce((sum, x) => sum + (x.comments || []).filter((c) => !c.parent_id && c.resolved_in === f.id).length, 0) }
              : null)).join("")
          : '<div class="empty-state">' + icon("upload", 32) + "<p>Pas encore de version. Ajoute le premier son.</p></div>") +
      "</div>";

    // Mini-waveforms : un tap lance la lecture à cet endroit.
    const colors = waveColors();
    for (const f of files) {
      const card = root.querySelector('.version[data-id="' + f.id + '"]');
      const canvas = card && card.querySelector("canvas");
      if (!canvas) continue;
      const w = new Waveform(canvas, Object.assign({}, colors, {
        barWidth: 2,
        barGap: 1,
        onSeek: (ratio, done) => {
          if (!isCurrent(f.id)) {
            if (!done) return;
            const d = Number(f.duration_sec) || 0;
            play(trackFromFile(f, project.title), { at: d ? ratio * d : 0 });
          } else if (done) {
            seekRatio(ratio);
          }
        }
      }));
      w.setPeaks(f.peaks);
      if (isCurrent(f.id)) w.setProgress(playerState().ratio);
      waves.set(f.id, w);
    }

    bind();
    ctx.setTitle(project.title);
    // fichiers glissés ici = nouvelles versions de CE morceau
    ctx.setDrop((files) => openUploadSheet(ctx, files, {
      projectId: project.id,
      onQueued: () => toast("Upload lancé", "ok")
    }));
    offUploads();
    offUploads = mountUploads(root.querySelector("[data-uploads]"), (j) => j.meta.projectId === project.id);
  }

  function bind() {
    root.querySelector("[data-pick]").addEventListener("change", (e) => {
      openUploadSheet(ctx, e.target.files, {
        projectId: project.id,
        onQueued: () => toast("Upload lancé", "ok")
      });
      e.target.value = "";
    });

    root.querySelector("[data-rename]").onclick = async () => {
      const t = await promptSheet("Renommer le morceau", project.title);
      if (!t || t === project.title) return;
      try { await updateProject(project.id, { title: t }); await load(); }
      catch (err) { toast(errorText(err), "err"); }
    };

    const zipBtn = root.querySelector("[data-zip]");
    if (zipBtn) zipBtn.onclick = () => zipAll(zipBtn);

    const pmore = root.querySelector("[data-pmore]");
    if (pmore) {
      pmore.onclick = () => actionSheet(project.title, [
        {
          label: "Supprimer le morceau et ses versions", icon: "trash", danger: true,
          run: async () => {
            const ok = await confirmSheet("Toutes les versions et leurs commentaires seront supprimés.", { ok: "Supprimer", danger: true });
            if (!ok) return;
            try {
              for (const f of project.files) await deleteFile(f).catch(() => {});
              await deleteProject(project.id);
              ctx.navigate("#/projects");
            } catch (err) { toast(errorText(err), "err"); }
          }
        }
      ]);
    }

    root.querySelector("[data-versions]").addEventListener("click", onVersionClick);
  }

  function onVersionClick(e) {
    const card = e.target.closest(".version");
    if (!card) return;
    const f = project.files.find((x) => x.id === card.dataset.id);
    if (!f) return;

    if (e.target.closest("[data-play]")) {
      if (isCurrent(f.id)) toggle();
      else play(trackFromFile(f, project.title));
      return;
    }

    if (e.target.closest("[data-more]")) {
      const canDelete = f.uploaded_by === ctx.space.participantId || ctx.space.isHost;
      actionSheet("v" + f.version_no + (f.label ? " " + f.label : ""), [
        { label: "Télécharger", icon: "download", run: () => downloadOne(f) },
        { label: "Envoyer par email", icon: "send", run: () => ctx.navigate("#/send?f=" + f.id) },
        { label: "Écouter et commenter", icon: "comment", run: () => ctx.navigate("#/f/" + f.id) },
        canDelete ? {
          label: "Supprimer cette version", icon: "trash", danger: true,
          run: async () => {
            const ok = await confirmSheet("Supprimer v" + f.version_no + " (" + f.original_name + ") ?", { ok: "Supprimer", danger: true });
            if (!ok) return;
            try { await deleteFile(f); toast("Version supprimée", "ok"); await load(); }
            catch (err) { toast(errorText(err), "err"); }
          }
        } : null
      ]);
    }
  }

  async function downloadOne(f) {
    try {
      await signFiles([f.id]);
      triggerDownload(cachedDownload(f.id), f.original_name);
    } catch (err) { toast(errorText(err), "err"); }
  }

  async function zipAll(btn) {
    const files = readyFiles();
    const total = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    if (!canStreamToDisk() && total > MEMORY_LIMIT) {
      toast("Trop lourd pour un zip sur cet appareil (" + formatBytes(total) + "). Télécharge les versions une par une, ou depuis Chrome sur ordinateur.", "err");
      return;
    }
    // URLs déjà signées au rendu : le sélecteur de fichier reste dans le geste.
    const entries = files.map((f) => ({
      name: "v" + f.version_no + " - " + f.original_name,
      url: cachedUrl(f.id),
      size: f.size_bytes
    }));
    if (entries.some((e) => !e.url)) {
      await signFiles(files.map((f) => f.id));
      entries.forEach((e, i) => { e.url = cachedUrl(files[i].id); });
    }
    const label = btn.innerHTML;
    btn.disabled = true;
    try {
      const saved = await saveZip(project.title + ".zip", entries, (r) => {
        btn.innerHTML = icon("download", 18) + "<span>" + Math.round(r * 100) + " %</span>";
      });
      if (saved) toast("Zip prêt", "ok");
    } catch (err) {
      toast(errorText(err), "err");
    }
    btn.disabled = false;
    btn.innerHTML = label;
  }

  async function load() {
    try {
      project = await getProject(id);
    } catch (err) {
      root.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
      return;
    }
    if (!project) {
      root.innerHTML = '<div class="empty-state">' + icon("alert", 32) + "<p>Ce morceau n'existe plus.</p>" +
        '<a class="btn" href="#/projects">Retour aux morceaux</a></div>';
      return;
    }
    // Pré-signature : le premier tap sur lecture part sans attendre.
    signFiles(readyFiles().map((f) => f.id)).catch(() => {});
    draw();
  }

  let offUploads = () => {};

  const offPlayer = onPlayer((type, s) => {
    if (type === "time") {
      for (const [fid, w] of waves) w.setProgress(isCurrent(fid) ? s.ratio : 0);
      return;
    }
    // changement de piste ou lecture/pause : icônes et surbrillance
    for (const card of root.querySelectorAll(".version")) {
      const cur = isCurrent(card.dataset.id);
      card.classList.toggle("is-current", cur);
      const btn = card.querySelector("[data-play]");
      if (btn) btn.innerHTML = icon(cur && s.playing ? "pause" : "play", 20);
      if (!cur && waves.get(card.dataset.id)) waves.get(card.dataset.id).setProgress(0);
    }
  });

  let timer = 0;
  const offDb = ctx.bus.on("db", (e) => {
    const rid = (e.row && (e.row.project_id || e.row.id)) || (e.old && (e.old.project_id || e.old.id));
    const relevant = (e.table === "files" && (!rid || rid === id || e.type === "DELETE"))
      || (e.table === "projects" && (rid === id))
      || e.table === "comments";
    if (!relevant) return;
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });

  await load();

  return () => {
    clearTimeout(timer);
    destroyWaves();
    offUploads();
    offPlayer();
    offDb();
  };
}
