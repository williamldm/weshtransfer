// Séminaire façon jam (Spotify) : une file commune où chacun ajoute ses
// sons, lue dans l'ordre d'ajout. Celui qui lance la jam fait tourner,
// les autres peuvent écouter avec lui en direct. Chaque son disparaît
// 5 jours après son ajout.

import { deleteProject, deleteFile } from "../api.js?v=74";
import { mountUploads } from "./uploads.js?v=74";
import { openUploadSheet } from "./upload-sheet.js?v=74";
import { cover } from "./review-home.js?v=74";
import { onJam, jamInfo, jamTracks, jamTag, reloadJam, followDj, unfollow, expiresAt, JAM_DAYS } from "../jam.js?v=74";
import { playQueue, onPlayer, isCurrent, state as playerState, toggle, queueInfo } from "../player.js?v=74";
import { icon } from "../icons.js?v=74";
import { esc, plural, toast, errorText, formatDuration, actionSheet, confirmSheet, kindBadge } from "../ui.js?v=74";

function hueOf(text) {
  let h = 0;
  for (const ch of String(text || "?")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}

function avatar(pseudo, me) {
  return '<span class="jam-avatar' + (me ? " is-me" : "") + '" style="--hue:' + hueOf(pseudo) + '" title="' + esc(pseudo) + '">' +
    esc(String(pseudo || "?").charAt(0).toUpperCase()) + "</span>";
}

function timeLeft(file) {
  const ms = expiresAt(file).getTime() - Date.now();
  if (ms < 3600000) return "part bientôt";
  if (ms < 86400000) return "encore " + Math.floor(ms / 3600000) + " h";
  return "encore " + Math.ceil(ms / 86400000) + " j";
}

function names(list) {
  if (list.length === 1) return list[0];
  return list.slice(0, -1).join(", ") + " et " + list[list.length - 1];
}

export async function mountJam(root, ctx) {
  const s = ctx.space;

  root.innerHTML =
    '<section class="rh-hero jam-hero">' +
      '<div class="jam-art" data-art></div>' +
      '<div class="rh-info">' +
        '<p class="eyebrow">Séminaire · Jam</p>' +
        "<h1>" + esc(s.name) + "</h1>" +
        '<p class="rh-meta" data-meta></p>' +
        '<div class="jam-people" data-people></div>' +
        '<div class="rh-actions">' +
          '<button class="btn btn-primary" data-play-all disabled>' + icon("play", 18) + "<span>Lancer la jam</span></button>" +
          '<label class="btn">' + icon("plus", 18) + "<span>Ajouter un son</span>" +
            '<input type="file" multiple hidden data-pick></label>' +
        "</div>" +
      "</div>" +
    "</section>" +
    '<div class="jam-live" data-live hidden></div>' +
    '<div data-uploads hidden></div>' +
    '<div data-list><ol class="tracklist"><li class="skeleton"></li><li class="skeleton"></li></ol></div>' +
    '<a class="link-row" href="#/transfers">' + icon("mail", 18) + "<span>Envois par email et liens</span>" + icon("chevron", 18) + "</a>";

  const art = root.querySelector("[data-art]");
  const meta = root.querySelector("[data-meta]");
  const people = root.querySelector("[data-people]");
  const live = root.querySelector("[data-live]");
  const listBox = root.querySelector("[data-list]");
  const playAll = root.querySelector("[data-play-all]");
  let loaded = false;

  const canEdit = (p) => p.created_by === s.participantId || s.isHost;

  function row(it, playables, cls) {
    const p = it.project, f = it.file;
    const cur = isCurrent(f.id);
    const playing = cur && playerState().playing;
    const who = p.creator ? p.creator.pseudo : "";
    const i = playables.findIndex((t) => t.fileId === f.id);
    return '<li class="track' + (cls ? " " + cls : "") + (cur ? " is-current" : "") + (playing ? " is-playing" : "") + '" data-id="' + p.id + '">' +
      (it.playable
        ? '<button class="track-art" data-play="' + i + '" aria-label="Écouter ' + esc(p.title) + '">' +
            cover(p.title) + '<span class="track-play">' + icon(playing ? "pause" : "play", 18) + "</span>" +
            '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span></button>'
        : '<span class="track-art">' + cover(p.title) + "</span>") +
      '<a class="track-main" href="#/f/' + f.id + '">' +
        '<span class="track-title">' + esc(p.title) + "</span>" +
        '<span class="track-sub">' +
          (who ? '<span class="jam-who" style="--hue:' + hueOf(who) + '">' + esc(who) + "</span> · " : "") +
          (it.playable ? "" : kindBadge(f.kind) + " ") +
          (f.version_no > 1 ? "v" + f.version_no + " · " : "") +
          "<em>" + timeLeft(f) + "</em>" +
        "</span>" +
      "</a>" +
      '<span class="track-dur mono">' + (f.duration_sec ? formatDuration(Number(f.duration_sec)) : "") + "</span>" +
      (canEdit(p) ? '<button class="btn btn-ghost btn-icon btn-sm" data-menu aria-label="Options">' + icon("more", 18) + "</button>" : "") +
    "</li>";
  }

  function draw() {
    const info = jamInfo();
    const items = info.items;
    const audio = items.filter((it) => it.playable);
    const others = items.filter((it) => !it.playable);
    const playables = jamTracks();
    const total = audio.reduce((sum, it) => sum + (Number(it.file.duration_sec) || 0), 0);

    // pochette : mosaïque des 4 premiers sons, sinon les initiales
    art.innerHTML = audio.length >= 4
      ? '<div class="jam-mosaic">' + audio.slice(0, 4).map((it) => cover(it.project.title)).join("") + "</div>"
      : cover(s.name, "cover-xl");

    meta.textContent = [plural(audio.length, "son", "sons"), total ? formatDuration(total) : "",
      "chaque son disparaît " + JAM_DAYS + " jours après son ajout"].filter(Boolean).join(" · ");

    // qui est là
    const here = info.online.length ? info.online : [{ id: info.me, pseudo: s.pseudo }];
    const others2 = here.filter((o) => o.id !== info.me).map((o) => o.pseudo || "Quelqu'un");
    people.innerHTML = '<span class="jam-avatars">' + here.slice(0, 6).map((o) => avatar(o.pseudo || "?", o.id === info.me)).join("") + "</span>" +
      "<span>" + (others2.length ? esc(names(others2)) + (others2.length > 1 ? " sont" : " est") + " dans la jam" : "Personne d'autre pour l'instant") + "</span>";

    // lancer / pause
    const mineJam = queueInfo().tag === jamTag() && !info.following;
    const st = playerState();
    playAll.disabled = !audio.length;
    playAll.innerHTML = mineJam && st.track
      ? icon(st.playing ? "pause" : "play", 18) + "<span>" + (st.playing ? "Pause" : "Reprendre") + "</span>"
      : icon("play", 18) + "<span>Lancer la jam</span>";

    // bandeau : qui fait tourner quoi
    const title = (fid) => { const it = items.find((x) => x.file.id === fid); return it ? it.project.title : "un son"; };
    const followed = info.following && info.djs.find((d) => d.id === info.following);
    const dj = !followed && info.djs[0];
    if (followed) {
      live.hidden = false;
      live.className = "jam-live is-following";
      live.innerHTML = icon("headphones", 20) + "<span>Tu écoutes avec <b>" + esc(followed.pseudo) + "</b> · <i>" + esc(title(followed.fileId)) + "</i></span>" +
        '<button class="btn btn-sm" data-unfollow>Quitter</button>';
    } else if (dj) {
      live.hidden = false;
      live.className = "jam-live";
      live.innerHTML = '<span class="jam-pulse' + (dj.playing ? "" : " is-paused") + '"></span>' +
        "<span><b>" + esc(dj.pseudo) + "</b> " + (dj.playing ? "fait tourner" : "est en pause sur") + " <i>" + esc(title(dj.fileId)) + "</i></span>" +
        '<button class="btn btn-primary btn-sm" data-follow="' + esc(dj.id) + '">' + icon("headphones", 16) + "<span>Écouter avec " + esc(dj.pseudo) + "</span></button>";
    } else if (info.dj && others2.length) {
      live.hidden = false;
      live.className = "jam-live is-dj";
      live.innerHTML = '<span class="jam-pulse"></span><span>Tu fais tourner la jam : ' + esc(names(others2)) + " " + (others2.length > 1 ? "peuvent" : "peut") + " écouter avec toi.</span>";
    } else {
      live.hidden = true;
      live.innerHTML = "";
    }

    if (!loaded) return;
    if (!items.length) {
      listBox.innerHTML = '<p class="tracklist-empty">La file est vide. Ajoute un premier son : il arrive chez tout le monde, et disparaît dans ' + JAM_DAYS + " jours.</p>";
      return;
    }

    // En cours / À suivre / Déjà passés, comme une file d'attente
    const cur = info.current;
    const at = audio.findIndex((it) => it.file.id === cur);
    let html = "";
    const section = (label, list, cls) => list.length
      ? '<h2 class="jam-section">' + label + '</h2><ol class="tracklist">' + list.map((it) => row(it, playables, cls)).join("") + "</ol>"
      : "";
    if (at !== -1) {
      html += section("En cours", [audio[at]]);
      html += section("À suivre", audio.slice(at + 1));
      html += section("Déjà passés", audio.slice(0, at), "is-past");
    } else {
      html += section("La file", audio);
    }
    html += section("Autres fichiers", others);
    listBox.innerHTML = html;
  }

  listBox.addEventListener("click", (e) => {
    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      const i = Number(playBtn.dataset.play);
      const tracks = jamTracks();
      const t = tracks[i];
      if (!t) return;
      if (isCurrent(t.fileId)) { toggle(); return; }
      unfollow();
      playQueue(tracks, i, jamTag());
      return;
    }
    const menu = e.target.closest("[data-menu]");
    if (!menu) return;
    const it = jamInfo().items.find((x) => x.project.id === menu.closest(".track").dataset.id);
    if (!it) return;
    const p = it.project;
    actionSheet(p.title, [
      { label: "Toutes les versions", icon: "layers", run: () => ctx.navigate("#/p/" + p.id) },
      {
        label: "Retirer de la jam", icon: "trash", danger: true,
        run: async () => {
          const ok = await confirmSheet("Le son, ses versions et ses commentaires seront effacés pour tout le monde.",
            { ok: "Retirer", danger: true, title: "Retirer " + p.title });
          if (!ok) return;
          try {
            for (const f of p.files || []) await deleteFile({ id: f.id }).catch(() => {});
            await deleteProject(p.id).catch(() => {});
            toast(p.title + " retiré", "ok");
            reloadJam();
          } catch (err) { toast(errorText(err), "err"); }
        }
      }
    ]);
  });

  live.addEventListener("click", (e) => {
    const f = e.target.closest("[data-follow]");
    if (f) { followDj(f.dataset.follow); return; }
    if (e.target.closest("[data-unfollow]")) unfollow();
  });

  playAll.onclick = () => {
    const info = jamInfo();
    if (queueInfo().tag === jamTag() && !info.following && playerState().track) { toggle(); return; }
    const tracks = jamTracks();
    if (!tracks.length) return;
    unfollow();
    playQueue(tracks, 0, jamTag());
  };

  root.querySelector("[data-pick]").addEventListener("change", (e) => {
    openUploadSheet(ctx, e.target.files);
    e.target.value = "";
  });
  ctx.setDrop((files) => openUploadSheet(ctx, files));

  const offUploads = mountUploads(root.querySelector("[data-uploads]"));
  const offJam = onJam(draw);
  const offPlayer = onPlayer((type) => { if (type === "track" || type === "state") draw(); });

  draw();
  await reloadJam();
  loaded = true;
  draw();
  return () => { offUploads(); offJam(); offPlayer(); };
}
