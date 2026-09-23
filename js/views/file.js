// Écoute d'une version : grande waveform, transport, commentaires
// horodatés façon SoundCloud ("à 1:23, la voix sature").

import { getFile, listComments, listCommentsOf, addComment, deleteComment, setCommentResolved, setFileApproved, signFiles, cachedUrl, cachedDownload, deleteFile, updateFile } from "../api.js?v=28";
import { Waveform, formatTime } from "../waveform.js?v=28";
import { play, toggle, isCurrent, onPlayer, seekRatio, seekSeconds, skip, state as playerState, trackFromFile } from "../player.js?v=28";
import { icon } from "../icons.js?v=28";
import { isAudio, canPreview, categoryOf } from "../files.js?v=28";
import {
  esc, h, fileBadge, fileTile, timeAgo, formatBytes, avatar, toast, errorText, triggerDownload, plural,
  confirmSheet, actionSheet, KINDS, openSheet
} from "../ui.js?v=28";

export const title = () => "Écoute";

const byTime = (a, b) => {
  if (a.at_ms == null && b.at_ms == null) return a.created_at < b.created_at ? -1 : 1;
  if (a.at_ms == null) return 1;
  if (b.at_ms == null) return -1;
  return a.at_ms - b.at_ms;
};

// opts.review : mode retours de mix (case "corrigé", état barré)
// opts.version : étiquette de version à afficher (retours d'une autre version)
export function renderComment(c, me, isHost, opts) {
  const o = opts || {};
  const mine = c.author_id === me;
  const done = !!c.resolved_at;
  return '<li class="comment' + (done ? " is-done" : "") + '" data-id="' + c.id + '">' +
    (o.review
      ? '<button class="c-check" data-resolve aria-pressed="' + done + '" aria-label="' + (done ? "Rouvrir" : "Marquer comme corrigé") + '">' + icon("check", 16) + "</button>"
      : avatar(c.author ? c.author.pseudo : "?")) +
    '<div class="c-body">' +
      '<div class="c-head">' +
        (o.version ? '<span class="vtag">' + esc(o.version) + "</span>" : "") +
        "<strong>" + esc(c.author ? c.author.pseudo : "?") + "</strong>" +
        (c.at_ms != null ? '<button class="ts" data-at="' + c.at_ms + '">' + formatTime(c.at_ms / 1000) + "</button>" : "") +
        '<span class="muted">' + timeAgo(c.created_at) + "</span></div>" +
      '<p class="c-text">' + esc(c.body) + "</p>" +
      (done ? '<p class="c-done">' + icon("check", 12) + " Corrigé" + (c.resolved_by ? " par " + esc(c.resolved_by) : "") + " " + timeAgo(c.resolved_at) + "</p>" : "") +
    "</div>" +
    (mine || isHost ? '<button class="btn btn-ghost btn-icon btn-sm" data-del aria-label="Supprimer">' + icon("trash", 16) + "</button>" : "") +
  "</li>";
}

export function renderComments(comments, me, isHost, opts) {
  const o = opts || {};
  const filter = o.review ? (o.filter || "open") : "all";
  const shown = comments
    .filter((c) => filter === "all" || (filter === "open" ? !c.resolved_at : !!c.resolved_at))
    .sort(byTime);
  if (!shown.length) {
    const empty = !comments.length
      ? (o.review ? "Pas encore de retour. Mets le son en pause là où quelque chose cloche, et écris." : "Pas encore de commentaire. Mets le son en pause au bon endroit et écris.")
      : filter === "open" ? "Tout est corrigé sur cette version." : "Rien de corrigé pour l'instant.";
    return '<li class="comment-empty">' + empty + "</li>";
  }
  return shown.map((c) => renderComment(c, me, isHost, o)).join("");
}

export function renderFileShell(file, space) {
  const versions = (file.project && file.project.files ? file.project.files : [])
    .filter((v) => v.status === "ready")
    .sort((a, b) => a.version_no - b.version_no);
  const mine = file.uploaded_by === space.participantId;
  const audio = isAudio(file.original_name, file.mime_type) && canPreview(file.original_name, file.mime_type);
  const cat = categoryOf(file.original_name, file.mime_type);
  const media = !audio && canPreview(file.original_name, file.mime_type) && (cat === "image" || cat === "video");
  const review = space.mode === "revue";

  return (
    '<header class="page-head">' +
      (file.project ? '<a class="eyebrow link" href="#/p/' + file.project.id + '">' + icon("back", 14) + " " + esc(file.project.title) + "</a>" : "") +
      '<h1 class="break">' + esc(file.original_name) + "</h1>" +
      '<div class="meta">' + fileBadge(file.original_name, file.mime_type, file.kind) + " v" + file.version_no +
        (file.label ? " · " + esc(file.label) : "") + " · " + esc(file.uploader ? file.uploader.pseudo : "?") +
        " · " + timeAgo(file.created_at) + " · " + formatBytes(file.size_bytes) +
        (file.bpm ? " · " + file.bpm + " BPM" : "") + (file.musical_key ? " · " + esc(file.musical_key) : "") +
      "</div>" +
    "</header>" +

    (versions.length > 1
      ? '<nav class="version-switch" aria-label="Versions" title="Pendant la lecture, changer de version garde la position (comparaison A/B)">' + versions.map((v) =>
          '<a class="chip' + (v.id === file.id ? " is-on" : "") + '" data-version="' + v.id + '" href="#/f/' + v.id + '">' +
          (v.approved_at ? icon("check", 13) + " " : "") + "v" + v.version_no +
          (v.label ? " " + esc(v.label) : "") + "</a>").join("") + "</nav>"
      : "") +

    (!audio
      ? (media
          ? '<div class="player-card media-card">' +
              (cat === "image" ? '<img alt="" data-media>' : '<video controls playsinline preload="metadata" data-media></video>') + "</div>"
          : '<div class="player-card zip-card">' + fileTile(file.original_name, file.mime_type) +
              "<p>Pas d'aperçu pour ce type de fichier : télécharge-le.</p></div>")
      : '<section class="player-card">' +
          '<div class="wave wave-lg"><canvas></canvas></div>' +
          '<div class="transport">' +
            '<span class="mono t-time" data-time>0:00</span>' +
            '<button class="btn btn-ghost btn-icon" data-back aria-label="Reculer de 10 secondes">' + icon("back10", 22) + "</button>" +
            '<button class="big-play" data-toggle aria-label="Lecture">' + icon("play", 30) + "</button>" +
            '<button class="btn btn-ghost btn-icon" data-fwd aria-label="Avancer de 10 secondes">' + icon("fwd10", 22) + "</button>" +
            '<span class="mono t-dur" data-dur>' + formatTime(Number(file.duration_sec) || 0) + "</span>" +
          "</div>" +
        "</section>") +

    (review
      ? '<div class="approve' + (file.approved_at ? " is-on" : "") + '">' +
          (file.approved_at
            ? '<div class="approve-text">' + icon("check", 18) + "<span><strong>Mix validé</strong>" +
                (file.approved_by ? " par " + esc(file.approved_by) : "") + " · " + timeAgo(file.approved_at) + "</span></div>" +
              '<button class="btn btn-ghost btn-sm" data-approve>Retirer</button>'
            : '<button class="btn btn-primary btn-block" data-approve>' + icon("check", 18) + "<span>Valider ce mix</span></button>") +
        "</div>"
      : "") +
    '<div class="actions-row">' +
      '<button class="btn" data-dl>' + icon("download", 18) + "<span>Télécharger</span></button>" +
      '<a class="btn" href="#/send?f=' + file.id + '">' + icon("send", 18) + "<span>Envoyer</span></a>" +
      (mine || space.isHost ? '<button class="btn btn-ghost btn-icon" data-more aria-label="Plus">' + icon("more") + "</button>" : "") +
    "</div>" +

    '<section class="comments">' +
      (review
        ? '<div class="section-head"><h2>Retours</h2><div class="chips" data-filters>' +
            '<button type="button" class="chip is-on" data-filter="open">À corriger <span class="count" data-n-open>0</span></button>' +
            '<button type="button" class="chip" data-filter="done">Corrigés <span class="count" data-n-done>0</span></button>' +
          "</div></div>"
        : '<div class="section-head"><h2>Commentaires <span class="count" data-ccount>0</span></h2></div>') +
      '<form class="comment-form" data-form>' +
        '<textarea class="input" name="body" rows="2" maxlength="1000" placeholder="' + (review ? "Ex : la voix est trop en arrière ici" : "Ex : la voix est trop en avant ici") + '"></textarea>' +
        '<div class="row">' +
          (!audio ? "" : '<button type="button" class="chip chip-time is-on" data-timechip>' + icon("clock", 14) + ' <span>à 0:00</span></button>') +
          '<span class="spacer"></span>' +
          '<button class="btn btn-primary btn-sm" type="submit">Publier</button>' +
        "</div>" +
      "</form>" +
      '<ul class="comment-list" data-comments></ul>' +
      (review ? '<section class="carry" data-carry hidden></section>' : "") +
    "</section>"
  );
}

export async function mount(root, ctx, params) {
  const id = params.id;
  let file = null;
  let comments = [];
  let wave = null;
  let useTime = true;
  const review = ctx.space.mode === "revue";
  let filter = "open";
  let earlier = [];   // retours encore ouverts sur les versions précédentes

  root.innerHTML = '<div class="skeleton tall"></div>';

  const track = () => trackFromFile(file, file.project ? file.project.title : "");
  const durationSec = () => (isCurrent(file.id) && playerState().duration) || Number(file.duration_sec) || 0;

  function currentMs() {
    return isCurrent(file.id) ? Math.round(playerState().time * 1000) : 0;
  }

  function drawShell() {
    const audio = isAudio(file.original_name, file.mime_type) && canPreview(file.original_name, file.mime_type);
    root.innerHTML = renderFileShell(file, ctx.space);

    // image ou vidéo : l'URL signée arrive juste après le rendu
    const mediaEl = root.querySelector("[data-media]");
    if (mediaEl) {
      signFiles([file.id]).then(() => { mediaEl.src = cachedUrl(file.id) || ""; }).catch(() => {});
    }

    if (audio) {
      const cs = getComputedStyle(document.documentElement);
      wave = new Waveform(root.querySelector(".wave canvas"), {
        idleColor: cs.getPropertyValue("--wave-idle").trim(),
        playedColor: cs.getPropertyValue("--wave-played").trim() || "#a78bfa",
        markerColor: cs.getPropertyValue("--accent-hi").trim() || "#c4b5fd",
        onSeek: (ratio, done) => {
          if (!isCurrent(file.id)) {
            if (done) play(track(), { at: ratio * durationSec() });
          } else if (done) {
            seekRatio(ratio);
          }
          syncTimeChip(Math.round(ratio * durationSec() * 1000));
        }
      });
      wave.setPeaks(file.peaks);
      if (isCurrent(file.id)) wave.setProgress(playerState().ratio);
    }

    bind();
    syncTransport(playerState());
  }

  function drawComments() {
    const me = ctx.space.participantId;
    root.querySelector("[data-comments]").innerHTML = renderComments(comments, me, ctx.space.isHost, { review, filter });
    if (review) {
      root.querySelector("[data-n-open]").textContent = comments.filter((c) => !c.resolved_at).length;
      root.querySelector("[data-n-done]").textContent = comments.filter((c) => c.resolved_at).length;
      for (const b of root.querySelectorAll("[data-filter]")) b.classList.toggle("is-on", b.dataset.filter === filter);
      drawEarlier();
    } else {
      root.querySelector("[data-ccount]").textContent = comments.length;
    }
    if (wave) {
      // en retours de mix, seuls les points encore à corriger sont marqués
      const marked = comments.filter((c) => c.at_ms != null && (!review || !c.resolved_at));
      wave.setMarkers(marked.map((c) => ({ atMs: c.at_ms })), durationSec() * 1000);
    }
  }

  // Ce qui a été demandé sur la v2 et pas encore coché, affiché sur la v3 :
  // un tap sur l'horodatage lit CETTE version au même endroit pour vérifier.
  function drawEarlier() {
    const el = root.querySelector("[data-carry]");
    if (!el) return;
    const open = earlier.filter((c) => !c.resolved_at).sort((a, b) => (a.at_ms ?? 1e12) - (b.at_ms ?? 1e12));
    el.hidden = !open.length;
    if (!open.length) { el.innerHTML = ""; return; }
    const versionOf = new Map(((file.project && file.project.files) || []).map((v) => [v.id, "v" + v.version_no]));
    el.innerHTML =
      '<div class="carry-head">' + icon("retry", 16) + "<span>" +
        plural(open.length, "retour encore ouvert", "retours encore ouverts") + " sur les versions précédentes. " +
        "Touche l'horodatage pour vérifier sur la v" + file.version_no + ".</span></div>" +
      '<ul class="comment-list">' +
        open.map((c) => renderComment(c, ctx.space.participantId, ctx.space.isHost, { review: true, version: versionOf.get(c.file_id) })).join("") +
      "</ul>";
  }

  function syncTimeChip(ms) {
    const chip = root.querySelector("[data-timechip]");
    if (!chip) return;
    chip.querySelector("span").textContent = "à " + formatTime((ms != null ? ms : currentMs()) / 1000);
    chip.classList.toggle("is-on", useTime);
  }

  function syncTransport(s) {
    const cur = isCurrent(file.id);
    const btn = root.querySelector("[data-toggle]");
    if (btn) btn.innerHTML = icon(cur && s.playing ? "pause" : "play", 30);
    const t = root.querySelector("[data-time]");
    if (t) t.textContent = formatTime(cur ? s.time : 0);
    if (cur && s.duration) {
      const d = root.querySelector("[data-dur]");
      if (d) d.textContent = formatTime(s.duration);
    }
  }

  function bind() {
    const toggleBtn = root.querySelector("[data-toggle]");
    if (toggleBtn) {
      toggleBtn.onclick = () => (isCurrent(file.id) ? toggle() : play(track()));
      root.querySelector("[data-back]").onclick = () => isCurrent(file.id) && skip(-10);
      root.querySelector("[data-fwd]").onclick = () => isCurrent(file.id) && skip(10);
    }

    root.querySelector("[data-dl]").onclick = async () => {
      try {
        await signFiles([file.id]);
        triggerDownload(cachedDownload(file.id), file.original_name);
      } catch (err) { toast(errorText(err), "err"); }
    };

    const more = root.querySelector("[data-more]");
    if (more) {
      more.onclick = () => actionSheet("v" + file.version_no, [
        { label: "Changer le type / l'étiquette", icon: "edit", run: editMeta },
        {
          label: "Supprimer cette version", icon: "trash", danger: true,
          run: async () => {
            const ok = await confirmSheet("Supprimer " + file.original_name + " ?", { ok: "Supprimer", danger: true });
            if (!ok) return;
            try {
              await deleteFile(file);
              ctx.navigate(file.project ? "#/p/" + file.project.id : "#/projects");
            } catch (err) { toast(errorText(err), "err"); }
          }
        }
      ]);
    }

    const chip = root.querySelector("[data-timechip]");
    if (chip) chip.onclick = () => { useTime = !useTime; syncTimeChip(); };

    const form = root.querySelector("[data-form]");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ta = form.querySelector("textarea");
      const body = ta.value.trim();
      if (!body) return;
      const at = chip && useTime ? currentMs() : null;
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await addComment(file.id, body, at);
        ta.value = "";
        comments = await listComments(file.id);
        drawComments();
      } catch (err) { toast(errorText(err), "err"); }
      btn.disabled = false;
    });

    // Entrée = publier (Maj+Entrée = retour à la ligne), pratique au clavier
    form.querySelector("textarea").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Comparaison A/B : changer de version pendant la lecture reprend au
    // même endroit. Les URLs des versions sont signées d'avance, donc le
    // son repart dans le geste (iOS).
    const switcher = root.querySelector(".version-switch");
    if (switcher) {
      switcher.addEventListener("click", (e) => {
        const a = e.target.closest("[data-version]");
        if (!a || a.dataset.version === file.id || !isCurrent(file.id)) return;
        const v = (file.project.files || []).find((x) => x.id === a.dataset.version);
        if (!v || !isAudio(v.original_name, v.mime_type)) return;
        e.preventDefault();
        const at = playerState().time;
        const wasPlaying = playerState().playing;
        play(trackFromFile(Object.assign({}, v, { uploader: file.uploader }), file.project.title), { at });
        if (!wasPlaying) setTimeout(toggle, 0);
        ctx.navigate("#/f/" + v.id);
      });
    }

    for (const b of root.querySelectorAll("[data-filter]")) {
      b.onclick = () => { filter = b.dataset.filter; drawComments(); };
    }

    const approve = root.querySelector("[data-approve]");
    if (approve) {
      approve.onclick = async () => {
        approve.disabled = true;
        try {
          await setFileApproved(file.id, !file.approved_at);
          if (!file.approved_at) toast("Mix validé. L'ingé son le voit tout de suite.", "ok");
          await load();
        } catch (err) { toast(errorText(err), "err"); approve.disabled = false; }
      };
    }

    root.querySelector(".comments").addEventListener("click", async (e) => {
      const check = e.target.closest("[data-resolve]");
      if (check) {
        const cid = check.closest(".comment").dataset.id;
        const c = comments.concat(earlier).find((x) => x.id === cid);
        if (!c) return;
        const done = !c.resolved_at;
        c.resolved_at = done ? new Date().toISOString() : null;   // affichage immédiat
        c.resolved_by = done ? ctx.space.pseudo : null;
        drawComments();
        try { await setCommentResolved(cid, done); }
        catch (err) { toast(errorText(err), "err"); await reloadComments(); }
      }
    });

    root.querySelector(".comments").addEventListener("click", async (e) => {
      const ts = e.target.closest("[data-at]");
      if (ts) {
        const sec = Number(ts.dataset.at) / 1000;
        if (isCurrent(file.id)) { seekSeconds(sec); if (!playerState().playing) toggle(); }
        else play(track(), { at: sec });
        return;
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const li = del.closest(".comment");
        try {
          await deleteComment(li.dataset.id);
          comments = comments.filter((c) => c.id !== li.dataset.id);
          earlier = earlier.filter((c) => c.id !== li.dataset.id);
          drawComments();
        } catch (err) { toast(errorText(err), "err"); }
      }
    });
  }

  async function reloadComments() {
    comments = await listComments(id);
    if (review) {
      const earlierIds = ((file.project && file.project.files) || [])
        .filter((v) => v.version_no < file.version_no).map((v) => v.id);
      earlier = earlierIds.length ? await listCommentsOf(earlierIds) : [];
    }
    drawComments();
  }

  function editMeta() {
    const body = h(
      '<form>' +
        '<div class="field"><span class="label">Type</span><div class="chips">' +
          KINDS.map(([k, label]) => '<label class="chip kind-chip kind-' + k + '"><input type="radio" name="kind" value="' + k + '"' +
            (k === file.kind ? " checked" : "") + "><span>" + label + "</span></label>").join("") +
        "</div></div>" +
        '<label class="field"><span class="label">Étiquette</span><input class="input" name="label" maxlength="40" value="' + esc(file.label || "") + '"></label>' +
        '<button class="btn btn-primary btn-block" type="submit">Enregistrer</button>' +
      "</form>"
    );
    const sheet = openSheet({ title: "v" + file.version_no, body });
    body.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(body);
      try {
        await updateFile(file.id, { kind: fd.get("kind"), label: String(fd.get("label") || "").trim() || null });
        sheet.close();
        await load();
      } catch (err) { toast(errorText(err), "err"); }
    });
  }

  async function load() {
    try {
      [file, comments] = await Promise.all([getFile(id), listComments(id)]);
      if (file && review) {
        const earlierIds = ((file.project && file.project.files) || [])
          .filter((v) => v.version_no < file.version_no && v.status === "ready").map((v) => v.id);
        earlier = earlierIds.length ? await listCommentsOf(earlierIds) : [];
      }
    } catch (err) {
      root.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
      return;
    }
    if (!file) {
      root.innerHTML = '<div class="empty-state">' + icon("alert", 32) + "<p>Ce fichier n'existe plus.</p>" +
        '<a class="btn" href="#/projects">Retour</a></div>';
      return;
    }
    // toutes les versions signées d'avance : la comparaison A/B repart
    // sans attendre le réseau
    signFiles([file.id].concat(((file.project && file.project.files) || []).map((v) => v.id))).catch(() => {});
    if (wave) { wave.destroy(); wave = null; }
    drawShell();
    drawComments();
    ctx.setTitle(file.project ? file.project.title : "Écoute");
    if (file.project) ctx.setBack("#/p/" + file.project.id);
  }

  const offPlayer = onPlayer((type, s) => {
    if (!file) return;
    if (wave) wave.setProgress(isCurrent(file.id) ? s.ratio : 0);
    syncTransport(s);
    if (type === "time" && useTime) syncTimeChip();
    if (type === "time" && wave && isCurrent(file.id) && s.duration && wave.markers.length === 0 && comments.some((c) => c.at_ms != null)) {
      drawComments();
    }
  });

  let timer = 0;
  const offDb = ctx.bus.on("db", (e) => {
    if (e.table === "comments") {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try { await reloadComments(); } catch (err) { /* réseau */ }
      }, 200);
    }
    if (e.table === "files" && ((e.row && e.row.id === id) || (e.old && e.old.id === id))) {
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    }
  });

  await load();

  return () => {
    clearTimeout(timer);
    if (wave) wave.destroy();
    offPlayer();
    offDb();
  };
}
