// Écoute d'une version : grande waveform, transport, commentaires
// horodatés façon SoundCloud ("à 1:23, la voix sature").

import { getFile, listComments, addComment, deleteComment, signFiles, cachedUrl, cachedDownload, deleteFile, updateFile } from "../api.js?v=74";
import { createReview } from "./review.js?v=74";
import { cover } from "./review-home.js?v=74";
import { coverOf } from "../cover.js?v=74";
import { Waveform, formatTime } from "../waveform.js?v=74";
import { play, toggle, isCurrent, onPlayer, seekRatio, seekSeconds, skip, state as playerState, trackFromFile } from "../player.js?v=74";
import { icon } from "../icons.js?v=74";
import { isAudio, canPreview, categoryOf } from "../files.js?v=74";
import {
  esc, h, fileBadge, fileTile, timeAgo, formatBytes, avatar, toast, errorText, triggerDownload, plural,
  confirmSheet, actionSheet, KINDS, openSheet
} from "../ui.js?v=74";

export const title = () => "Écoute";

const byTime = (a, b) => {
  if (a.at_ms == null && b.at_ms == null) return a.created_at < b.created_at ? -1 : 1;
  if (a.at_ms == null) return 1;
  if (b.at_ms == null) return -1;
  return a.at_ms - b.at_ms;
};

// Commentaire d'un salon. Les retours de mix ont leur propre rendu
// (review.js) : états, corrections, réponses.
export function renderComment(c, me, isHost) {
  const mine = c.author_id === me;
  return '<li class="comment" data-id="' + c.id + '">' +
    avatar(c.author ? c.author.pseudo : "?") +
    '<div class="c-body">' +
      '<div class="c-head">' +
        "<strong>" + esc(c.author ? c.author.pseudo : "?") + "</strong>" +
        (c.at_ms != null ? '<button class="ts" data-at="' + c.at_ms + '">' + formatTime(c.at_ms / 1000) + "</button>" : "") +
        '<span class="muted">' + timeAgo(c.created_at) + "</span></div>" +
      '<p class="c-text">' + esc(c.body) + "</p>" +
    "</div>" +
    (mine || isHost ? '<button class="btn btn-ghost btn-icon btn-sm" data-del aria-label="Supprimer">' + icon("trash", 16) + "</button>" : "") +
  "</li>";
}

export function renderComments(comments, me, isHost) {
  const shown = comments.filter((c) => !c.parent_id).sort(byTime);
  if (!shown.length) return '<li class="comment-empty">Pas encore de commentaire. Mets le son en pause au bon endroit et écris.</li>';
  return shown.map((c) => renderComment(c, me, isHost)).join("");
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

  if (review) return renderReviewShell(file, versions, audio, media, cat, mine, space);

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
          '<div class="wave wave-lg' + (review ? " has-pins" : "") + '"><canvas></canvas></div>' +
          '<div class="transport">' +
            '<span class="mono t-time" data-time>0:00</span>' +
            '<button class="btn btn-ghost btn-icon" data-back aria-label="Reculer de 10 secondes">' + icon("back10", 22) + "</button>" +
            '<button class="big-play" data-toggle aria-label="Lecture">' + icon("play", 30) + "</button>" +
            '<button class="btn btn-ghost btn-icon" data-fwd aria-label="Avancer de 10 secondes">' + icon("fwd10", 22) + "</button>" +
            '<span class="mono t-dur" data-dur>' + formatTime(Number(file.duration_sec) || 0) + "</span>" +
          "</div>" +
        "</section>") +
    '<div class="actions-row">' +
      '<button class="btn" data-dl>' + icon("download", 18) + "<span>Télécharger</span></button>" +
      '<a class="btn" href="#/send?f=' + file.id + '">' + icon("send", 18) + "<span>Envoyer</span></a>" +
      (mine || space.isHost ? '<button class="btn btn-ghost btn-icon" data-more aria-label="Plus">' + icon("more") + "</button>" : "") +
    "</div>" +

    (review
      ? '<div data-review-root></div>'
      : '<section class="comments">' +
          '<div class="section-head"><h2>Commentaires <span class="count" data-ccount>0</span></h2></div>' +
          '<form class="comment-form" data-form>' +
            '<textarea class="input" name="body" rows="2" maxlength="1000" placeholder="Ex : la voix est trop en avant ici"></textarea>' +
            '<div class="row">' +
              (!audio ? "" : '<button type="button" class="chip chip-time is-on" data-timechip>' + icon("clock", 14) + ' <span>à 0:00</span></button>') +
              '<span class="spacer"></span>' +
              '<button class="btn btn-primary btn-sm" type="submit">Publier</button>' +
            "</div>" +
          "</form>" +
          '<ul class="comment-list" data-comments></ul>' +
        "</section>")
  );
}

// Retours de mix : l'essentiel seulement. Le morceau et sa version en
// titre, les versions pour comparer, le lecteur, puis les retours.
function renderReviewShell(file, versions, audio, media, cat, mine, space) {
  const title = file.project ? file.project.title : file.original_name;
  return (
    '<header class="rv-top">' +
      '<span data-rv-cover>' + cover(title) + "</span>" +
      '<div class="rv-top-text"><h1>' + esc(title) + "</h1>" +
        '<p class="muted">v' + file.version_no + (file.uploader ? " · " + esc(file.uploader.pseudo) : "") + " · " + timeAgo(file.created_at) + "</p></div>" +
      '<button class="btn btn-ghost btn-icon" data-dl aria-label="Télécharger">' + icon("download", 20) + "</button>" +
      (mine || space.isHost ? '<button class="btn btn-ghost btn-icon" data-more aria-label="Plus">' + icon("more") + "</button>" : "") +
    "</header>" +
    (versions.length > 1
      ? '<nav class="version-switch" aria-label="Versions" title="Pendant la lecture, changer de version garde la position (comparaison A/B)">' + versions.map((v) =>
          '<a class="chip' + (v.id === file.id ? " is-on" : "") + '" data-version="' + v.id + '" href="#/f/' + v.id + '">' +
          (v.approved_at ? icon("check", 13) + " " : "") + "v" + v.version_no + "</a>").join("") + "</nav>"
      : "") +
    (!audio
      ? (media
          ? '<div class="player-card media-card">' +
              (cat === "image" ? '<img alt="" data-media>' : '<video controls playsinline preload="metadata" data-media></video>') + "</div>"
          : '<div class="player-card zip-card">' + fileTile(file.original_name, file.mime_type) + "<p>Pas d'aperçu pour ce type de fichier : télécharge-le.</p></div>")
      : '<section class="player-card">' +
          '<div class="wave wave-lg has-pins"><canvas></canvas></div>' +
          '<div class="transport">' +
            '<span class="mono t-time" data-time>0:00</span>' +
            '<button class="btn btn-ghost btn-icon" data-back aria-label="Reculer de 10 secondes">' + icon("back10", 22) + "</button>" +
            '<button class="big-play" data-toggle aria-label="Lecture">' + icon("play", 30) + "</button>" +
            '<button class="btn btn-ghost btn-icon" data-fwd aria-label="Avancer de 10 secondes">' + icon("fwd10", 22) + "</button>" +
            '<span class="mono t-dur" data-dur>' + formatTime(Number(file.duration_sec) || 0) + "</span>" +
          "</div>" +
        "</section>") +
    '<div data-review-root></div>'
  );
}

export async function mount(root, ctx, params) {
  const id = params.id;
  let file = null;
  let comments = [];
  let wave = null;
  let useTime = true;
  const review = ctx.space.mode === "revue";
  let rv = null;        // retours de mix (review.js)
  let markers = [];

  root.innerHTML = '<div class="skeleton tall"></div>';

  // retours : la pochette de l'espace suit le morceau jusqu'à l'écran verrouillé
  let artwork = null;
  const withArt = (tr) => (artwork ? Object.assign(tr, { artwork, album: ctx.space.name }) : tr);
  const track = () => withArt(trackFromFile(file, file.project ? file.project.title : ""));
  const durationSec = () => (isCurrent(file.id) && playerState().duration) || Number(file.duration_sec) || 0;

  function currentMs() {
    return isCurrent(file.id) ? Math.round(playerState().time * 1000) : 0;
  }

  function drawShell() {
    const audio = isAudio(file.original_name, file.mime_type) && canPreview(file.original_name, file.mime_type);
    root.innerHTML = renderFileShell(file, ctx.space);
    const coverSlot = root.querySelector("[data-rv-cover]");
    if (coverSlot) {
      coverOf(ctx.space.id).then((img) => {
        artwork = img;
        if (img && coverSlot.isConnected) coverSlot.innerHTML = cover("", "", img);
      });
    }

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
        onMarker: (m) => { if (rv) rv.focusMarker(m); },
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

    if (review) {
      rv = createReview({
        el: root.querySelector("[data-review-root]"),
        ctx,
        currentMs,
        playAt,
        // on écrit sur ce moment-là : le son s'arrête, l'horodatage aussi
        pause: () => { if (isCurrent(file.id) && playerState().playing) toggle(); },
        setMarkers: (list) => { markers = list; applyMarkers(); }
      });
      rv.setFile(file);
    }

    bind();
    syncTransport(playerState());
  }

  function applyMarkers() {
    if (wave) wave.setMarkers(markers, durationSec() * 1000);
  }

  // Lire CETTE version à un instant donné (vérifier une correction)
  function playAt(sec) {
    if (isCurrent(file.id)) { seekSeconds(sec); if (!playerState().playing) toggle(); }
    else play(track(), { at: sec });
  }

  function drawComments() {
    if (review) return;
    const me = ctx.space.participantId;
    root.querySelector("[data-comments]").innerHTML = renderComments(comments, me, ctx.space.isHost);
    root.querySelector("[data-ccount]").textContent = comments.filter((c) => !c.parent_id).length;
    markers = comments.filter((c) => c.at_ms != null).map((c) => ({ atMs: c.at_ms }));
    applyMarkers();
  }

  function syncTimeChip(ms) {
    const at = root.querySelector("[data-note-at]");
    if (at) at.textContent = formatTime((ms != null ? ms : currentMs()) / 1000);
    if (rv) rv.syncTime(ms);
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

    const noteHere = root.querySelector("[data-note-here]");
    if (noteHere) {
      noteHere.onclick = () => {
        if (isCurrent(file.id) && playerState().playing) toggle();   // pause : on écrit sur ce moment
        rv.focusComposer();
      };
    }

    const chip = root.querySelector("[data-timechip]");
    if (chip) chip.onclick = () => { useTime = !useTime; syncTimeChip(); };

    const form = root.querySelector("[data-form]");
    if (form) form.addEventListener("submit", async (e) => {
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
    if (form) form.querySelector("textarea").addEventListener("keydown", (e) => {
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
        play(withArt(trackFromFile(Object.assign({}, v, { uploader: file.uploader }), file.project.title)), { at });
        if (!wasPlaying) setTimeout(toggle, 0);
        ctx.navigate("#/f/" + v.id);
      });
    }

    const commentsEl = root.querySelector(".comments");
    if (commentsEl) commentsEl.addEventListener("click", async (e) => {
      const ts = e.target.closest("[data-at]");
      if (ts) { playAt(Number(ts.dataset.at) / 1000); return; }
      const del = e.target.closest("[data-del]");
      if (del) {
        const li = del.closest(".comment");
        try {
          await deleteComment(li.dataset.id);
          comments = comments.filter((c) => c.id !== li.dataset.id);
          drawComments();
        } catch (err) { toast(errorText(err), "err"); }
      }
    });
  }

  async function reloadComments() {
    if (rv) return rv.reload();
    comments = await listComments(id);
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
      [file, comments] = await Promise.all([getFile(id), review ? [] : listComments(id)]);
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
    if (rv) await rv.reload().catch((err) => toast(errorText(err), "err"));
    ctx.setTitle(file.project ? file.project.title : "Écoute");
    // retours : retour à la liste des morceaux (on n'est pas passé par les versions)
    if (review) ctx.setBack("#/projects");
    else if (file.project) ctx.setBack("#/p/" + file.project.id);
  }

  const offPlayer = onPlayer((type, s) => {
    if (!file) return;
    if (wave) wave.setProgress(isCurrent(file.id) ? s.ratio : 0);
    syncTransport(s);
    if (type === "time" && useTime) syncTimeChip();
    if (type === "time" && rv && isCurrent(file.id)) rv.onPlayback(currentMs());
    // durée connue seulement à la lecture : on replace les marqueurs
    if (type === "time" && wave && isCurrent(file.id) && s.duration && wave.markers.length === 0 && markers.length) {
      applyMarkers();
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
