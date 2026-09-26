// Accueil d'un espace de retours, présenté comme un album : grande
// pochette, "Tout écouter", liste des morceaux avec un seul statut chacun.
// Toucher un morceau ouvre directement sa page de retours (dernière
// version) ; toucher sa pochette le joue, et les suivants s'enchaînent.

import {
  listProjects, listReviewComments, deleteProject, deleteFile, listParticipants, updateProject,
  reviewNotifyStatus, reviewSubscribe, reviewUnsubscribe
} from "../api.js?v=90";
import { mountUploads } from "./uploads.js?v=90";
import { openUploadSheet } from "./upload-sheet.js?v=90";
import { stateOf, isEngineerOf } from "./review.js?v=90";
import { ensureVerified } from "../verify.js?v=90";
import { accountEmail } from "../session.js?v=90";
import { albumOf, onCover, setCover, clearCover, setAlbumTitle } from "../cover.js?v=90";
import { playQueue, onPlayer, isCurrent, state as playerState, toggle, trackFromFile } from "../player.js?v=90";
import { icon } from "../icons.js?v=90";
import { esc, h, plural, toast, errorText, formatDuration, actionSheet, confirmSheet, promptSheet, openSheet } from "../ui.js?v=90";

// Pochette générée : un aplat dont la teinte dépend du nom, les initiales
// en grand. Pas de dégradé (identité sobre).
function hueOf(text) {
  let h = 0;
  for (const ch of String(text || "?")) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 360;
}
function initials(text) {
  const words = String(text || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0] || "?").charAt(0) + (words[1] ? words[1].charAt(0) : (words[0] || "").charAt(1) || "")).toUpperCase();
}
// `image` : la pochette déposée (data URL), sinon les initiales.
export function cover(text, cls, image) {
  if (image) return '<span class="cover has-img ' + (cls || "") + '" aria-hidden="true"><img src="' + esc(image) + '" alt=""></span>';
  return '<span class="cover ' + (cls || "") + '" style="--hue:' + hueOf(text) + '" aria-hidden="true">' + esc(initials(text)) + "</span>";
}

const latestOf = (p) => (p.files || []).filter((f) => f.status === "ready").sort((a, b) => b.version_no - a.version_no)[0] || null;

// Une phrase par morceau, en italique sous le titre : ce qu'il reste à
// faire, vu par l'ingé ou par l'artiste.
function statusOf(p, stats, engineer) {
  const latest = latestOf(p);
  if (!latest) return { text: "", cls: "" };
  if (latest.approved_at) return { text: "Validé, plus rien à modifier", cls: "is-ok" };
  let open = 0, verify = 0, any = 0;
  for (const f of p.files || []) {
    const s = stats.get(f.id);
    if (s) { open += s.open; verify += s.verify; any += s.all; }
  }
  if (engineer) {
    if (open) return { text: plural(open, "modif à faire", "modifs à faire"), cls: "is-todo" };
    if (verify) return { text: "Corrigé, l'artiste vérifie", cls: "is-verify" };
    return { text: any ? "Rien à modifier, attend la validation" : "Pas encore de retour de l'artiste", cls: "" };
  }
  if (verify) return { text: plural(verify, "correction à vérifier", "corrections à vérifier"), cls: "is-verify" };
  if (open) return { text: plural(open, "modif demandée", "modifs demandées") + ", l'ingé s'en occupe", cls: "" };
  return { text: any ? "Plus rien à modifier ? Valide-le" : "Des modifs à demander ? Ouvre-le", cls: "is-new" };
}

// Fond d'en-tête façon plateforme de streaming : la pochette, floutée et
// assombrie ; sans pochette, un aplat de la teinte du titre.
export function backdrop(image, text) {
  return image
    ? '<div class="rv-backdrop" style="background-image:url(\'' + esc(image) + '\')" aria-hidden="true"></div>'
    : '<div class="rv-backdrop is-flat" style="--hue:' + hueOf(text) + '" aria-hidden="true"></div>';
}

const HELP_KEY = "weshtransfer.reviewHelp";
const WELCOME_KEY = "weshtransfer.verdictWelcome.";
function helpClosed() {
  try { return localStorage.getItem(HELP_KEY) === "closed"; } catch (err) { return false; }
}

export async function mountReviewHome(root, ctx) {
  const s = ctx.space;
  let projects = [];
  let stats = new Map();
  let engineer = !!s.isHost;
  let coverImg = null;
  let albumTitle = null;
  let hostName = "";
  let loaded = false;
  const titleOf = () => albumTitle || s.name;

  root.innerHTML =
    '<section class="rh-hero rv-hero">' +
      '<div data-backdrop></div>' +
      '<div class="rh-cover" data-cover-box></div>' +
      '<input type="file" accept="image/*" hidden data-cover-pick>' +
      '<div class="rh-info">' +
        '<p class="eyebrow" data-eyebrow>Verdict</p>' +
        '<h1 class="rh-title"><span data-album-title>' + esc(s.name) + '</span>' +
          '<button type="button" class="rh-title-edit" data-edit-title aria-label="Renommer l\'album" title="Renommer l\'album">' + icon("edit", 16) + "</button></h1>" +
        '<p class="rh-meta" data-meta></p>' +
        '<div class="rh-actions">' +
          '<button class="btn btn-primary" data-play-all disabled>' + icon("play", 18) + "<span>Tout écouter</span></button>" +
          '<span data-engineer-actions></span>' +
        "</div>" +
      "</div>" +
    "</section>" +
    '<div data-help></div>' +
    '<div data-uploads hidden></div>' +
    '<ol class="tracklist" data-list><li class="skeleton"></li><li class="skeleton"></li></ol>';

  const list = root.querySelector("[data-list]");
  const meta = root.querySelector("[data-meta]");
  const playAll = root.querySelector("[data-play-all]");
  const engActions = root.querySelector("[data-engineer-actions]");
  const coverBox = root.querySelector("[data-cover-box]");
  const coverPick = root.querySelector("[data-cover-pick]");
  const helpBox = root.querySelector("[data-help]");
  const backdropBox = root.querySelector("[data-backdrop]");
  const titleEl = root.querySelector("[data-album-title]");
  const eyebrow = root.querySelector("[data-eyebrow]");

  function drawAlbum() {
    backdropBox.innerHTML = backdrop(coverImg, titleOf());
    titleEl.textContent = titleOf();
    eyebrow.textContent = "Verdict" + (hostName ? " · par " + hostName : "");
    if (ctx.setTitle) ctx.setTitle(titleOf());
  }

  root.querySelector("[data-edit-title]").onclick = async () => {
    const next = await promptSheet("Titre de l'album", titleOf(), { max: 80, ok: "Enregistrer" });
    if (next == null || next.trim() === titleOf()) return;
    try { await setAlbumTitle(s.id, next); toast("Titre enregistré", "ok"); }
    catch (err) { toast(errorText(err), "err"); }
  };

  // Accueil de l'artiste, la première fois : titre de l'album et pochette
  function welcomed() {
    try { return localStorage.getItem(WELCOME_KEY + s.id) === "1"; } catch (err) { return false; }
  }
  function openWelcome() {
    try { localStorage.setItem(WELCOME_KEY + s.id, "1"); } catch (err) { /* privé */ }
    const body = h(
      '<div class="welcome">' +
        '<p class="welcome-lead">' + (hostName ? "<b>" + esc(hostName) + "</b> t'a invité" : "Tu es invité") +
          " à écouter ses mix et à dire ce qui ne va pas. Avant d'y aller, habille ton projet :</p>" +
        '<label class="welcome-cover" data-wc-pick>' +
          '<span data-wc-preview>' + (coverImg ? cover(titleOf(), "cover-xl", coverImg)
            : '<span class="cover cover-xl cover-add">' + icon("image", 28) + "<span>Ajoute la cover</span></span>") + "</span>" +
          '<input type="file" accept="image/*" hidden data-wc-file>' +
          '<span class="welcome-cover-hint">' + (coverImg ? "Changer la cover" : "Choisir une image") + "</span>" +
        "</label>" +
        '<label class="field"><span class="label">Titre de l\'album</span>' +
          '<input class="input" name="album" maxlength="80" value="' + esc(titleOf()) + '" placeholder="Ex : Nuit blanche"></label>' +
        '<button class="btn btn-primary btn-block btn-xl" data-go>' + icon("play", 20) + "<span>C'est parti</span></button>" +
        '<button class="btn btn-ghost btn-block" data-later>Plus tard</button>' +
      "</div>"
    );
    const sheet = openSheet({ title: "Bienvenue dans le verdict", body });
    const file = body.querySelector("[data-wc-file]");
    const preview = body.querySelector("[data-wc-preview]");
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      preview.classList.add("is-busy");
      try {
        const img = await setCover(s.id, f);
        preview.innerHTML = cover(titleOf(), "cover-xl", img);
        body.querySelector(".welcome-cover-hint").textContent = "Changer la cover";
      } catch (err) { toast(errorText(err), "err"); }
      preview.classList.remove("is-busy");
    });
    body.querySelector("[data-later]").onclick = () => sheet.close();
    body.querySelector("[data-go]").onclick = async () => {
      const t = body.querySelector("[name=album]").value.trim();
      if (t && t !== titleOf()) {
        try { await setAlbumTitle(s.id, t); } catch (err) { toast(errorText(err), "err"); return; }
      }
      sheet.close();
    };
  }

  // Pochette : proposée à l'artiste tant qu'il n'y en a pas ; l'ingé
  // peut aussi la mettre. Toucher la pochette = la changer.
  function drawCover() {
    const empty = !coverImg;
    coverBox.innerHTML =
      '<button type="button" class="rh-cover-btn' + (empty && !engineer ? " is-empty" : "") + '" data-cover aria-label="' + (empty ? "Ajouter une cover" : "Changer la cover") + '">' +
        (empty && !engineer
          ? '<span class="cover cover-xl cover-add">' + icon("image", 28) + "<span>Ajoute la cover du projet</span></span>"
          : cover(s.name, "cover-xl", coverImg) + '<span class="rh-cover-edit" aria-hidden="true">' + icon(empty ? "image" : "edit", 16) + "</span>") +
      "</button>";
  }

  coverBox.addEventListener("click", (e) => {
    if (!e.target.closest("[data-cover]")) return;
    if (!coverImg) { coverPick.click(); return; }
    actionSheet("Cover", [
      { label: "Changer la cover", icon: "image", run: () => coverPick.click() },
      {
        label: "Retirer la cover", icon: "trash", danger: true,
        run: async () => {
          try { await clearCover(s.id); toast("Cover retirée", "ok"); } catch (err) { toast(errorText(err), "err"); }
        }
      }
    ]);
  });

  coverPick.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    coverBox.classList.add("is-busy");
    try { await setCover(s.id, file); toast("Cover ajoutée", "ok"); }
    catch (err) { toast(errorText(err), "err"); }
    coverBox.classList.remove("is-busy");
  });

  // Mode d'emploi pour l'artiste : ouvert tant qu'il ne l'a pas refermé.
  function drawHelp() {
    if (engineer) { helpBox.innerHTML = ""; return; }
    helpBox.innerHTML =
      '<details class="rh-help"' + (helpClosed() ? "" : " open") + ">" +
        "<summary>" + icon("comment", 18) + "<span>Comment ça marche ?</span></summary>" +
        "<ol>" +
          "<li><b>Écoute.</b> Touche un morceau pour l'ouvrir.</li>" +
          "<li><b>Demande tes modifs.</b> Là où quelque chose te gêne, touche un point rapide (voix trop basse, clic, trop de basse...) ou écris-le avec tes mots. Il s'accroche à la seconde près, sous la forme d'onde.</li>" +
          "<li><b>Vérifie.</b> L'ingé corrige et renvoie une nouvelle version. Tu confirmes chaque correction, puis tu valides le morceau.</li>" +
        "</ol>" +
        "<p>Pas besoin de vocabulaire technique, et tu peux demander autant de modifications que tu veux.</p>" +
      "</details>";
    const d = helpBox.querySelector("details");
    d.addEventListener("toggle", () => {
      try { localStorage.setItem(HELP_KEY, d.open ? "open" : "closed"); } catch (err) { /* navigation privée */ }
    });
  }

  // Actions de l'ingé : déposer un mix, emails (inviter : icône du haut). Une icône chacune.
  let notifyEmail = null;
  function drawEngineerActions() {
    if (!engineer) { engActions.innerHTML = ""; return; }
    engActions.innerHTML =
      '<label class="btn">' + icon("upload", 18) + "<span>Déposer</span>" +
        '<input type="file" multiple hidden data-pick></label>' +
      '<button class="btn btn-ghost btn-icon' + (notifyEmail ? " is-on" : "") + '" data-notify aria-label="Emails quand l\'artiste a fait ses retours" title="' +
        (notifyEmail ? "Emails activés : " + esc(notifyEmail) : "Recevoir un email quand l'artiste a fait ses retours") + '">' + icon("mail", 20) + "</button>";
    const pick = engActions.querySelector("[data-pick]");
    pick.addEventListener("change", (e) => { openUploadSheet(ctx, e.target.files); e.target.value = ""; });
  }

  engActions.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-notify]")) return;
    if (notifyEmail) {
      const ok = await confirmSheet("Plus d'email récapitulatif pour cet espace ?", { ok: "Couper les emails", title: "Emails" });
      if (!ok) return;
      try { await reviewUnsubscribe(s.id); notifyEmail = null; drawEngineerActions(); toast("Emails coupés", "ok"); }
      catch (err) { toast(errorText(err), "err"); }
      return;
    }
    // connecté : l'adresse du compte, déjà vérifiée ; sinon on la demande
    let email = accountEmail();
    if (!email) {
      email = ((await promptSheet("Ton email", "", { max: 254, ok: "Continuer" })) || "").toLowerCase();
      if (!email) return;
    }
    if (await ensureVerified(email, { optional: false }) !== "ok") return;
    try {
      const r = await reviewSubscribe(s.id, email);
      notifyEmail = r.email;
      drawEngineerActions();
      toast("Tu recevras un email quand l'artiste aura fini ses retours", "ok");
    } catch (err) { toast(errorText(err), "err"); }
  });

  function tracks() {
    return projects.map((p) => {
      const f = latestOf(p);
      if (!f) return null;
      const tr = trackFromFile(Object.assign({}, f, { uploader: null }), p.title);
      tr.album = titleOf();
      if (coverImg) tr.artwork = coverImg;
      return tr;
    }).filter(Boolean);
  }

  function draw() {
    const ready = projects.filter((p) => latestOf(p));
    const total = ready.reduce((sum, p) => sum + (Number(latestOf(p).duration_sec) || 0), 0);
    let open = 0, verify = 0;
    for (const v of stats.values()) { open += v.open; verify += v.verify; }
    const summary = engineer
      ? (open ? plural(open, "retour à corriger", "retours à corriger") : ready.length ? "rien à corriger" : "")
      : (verify ? plural(verify, "correction à vérifier", "corrections à vérifier") : "");
    meta.textContent = [plural(ready.length, "morceau", "morceaux"), total ? formatDuration(total) : "", summary].filter(Boolean).join(" · ");
    playAll.disabled = !ready.length;

    if (!projects.length) {
      list.innerHTML = '<li class="tracklist-empty">' + (engineer
        ? "Dépose ton premier mix : l'artiste l'écoute et commente à la seconde près."
        : "Pas encore de mix. Tu seras prévenu dès que l'ingé en dépose un.") + "</li>";
      return;
    }
    list.innerHTML = projects.map((p, i) => {
      const f = latestOf(p);
      const st = statusOf(p, stats, engineer);
      const playing = f && isCurrent(f.id);
      return '<li class="track' + (playing ? " is-current" : "") + (playing && playerState().playing ? " is-playing" : "") + '" data-id="' + p.id + '">' +
        '<button class="track-num" data-play="' + i + '" aria-label="Écouter ' + esc(p.title) + '"' + (f ? "" : " disabled") + ">" +
          '<span class="track-n">' + (i + 1) + "</span>" +
          '<span class="track-play">' + icon(playing && playerState().playing ? "pause" : "play", 16) + "</span>" +
          '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        "</button>" +
        '<a class="track-main" href="' + (f ? "#/f/" + f.id : "#/p/" + p.id) + '">' +
          '<span class="track-title">' + esc(p.title) + "</span>" +
          '<span class="track-sub">' + (f ? "v" + f.version_no : "pas encore de version") +
            (st.text ? ' · <em class="track-note ' + st.cls + '">' + esc(st.text) + "</em>" : "") + "</span>" +
        "</a>" +
        '<span class="track-dur mono">' + (f && f.duration_sec ? formatDuration(Number(f.duration_sec)) : "") + "</span>" +
        '<button class="btn btn-ghost btn-icon btn-sm" data-menu aria-label="Options">' + icon("more", 18) + "</button>" +
        // poignée : glisser pour changer l'ordre (souris ou doigt)
        (projects.length > 1 ? '<button type="button" class="track-drag" data-drag aria-label="Déplacer ' + esc(p.title) + '" title="Glisser pour changer l\'ordre">' + icon("grip", 18) + "</button>" : "") +
      "</li>";
    }).join("");
  }

  list.addEventListener("click", (e) => {
    const playBtn = e.target.closest("[data-play]");
    if (playBtn) {
      const p = projects[Number(playBtn.dataset.play)];
      const f = p && latestOf(p);
      if (!f) return;
      if (isCurrent(f.id)) { toggle(); return; }
      // la file part de ce morceau, dans l'ordre de la liste
      const all = tracks();
      playQueue(all, Math.max(0, all.findIndex((t) => t.fileId === f.id)));
      return;
    }
    const menu = e.target.closest("[data-menu]");
    if (menu) {
      const p = projects.find((x) => x.id === menu.closest(".track").dataset.id);
      const i = projects.indexOf(p);
      actionSheet(p.title, [
        // renommer : l'artiste aussi (c'est son album)
        {
          label: "Renommer", icon: "edit",
          run: async () => {
            const t = await promptSheet("Titre du morceau", p.title, { max: 80, ok: "Renommer" });
            if (!t || !t.trim() || t.trim() === p.title) return;
            try { await updateProject(p.id, { title: t.trim() }); p.title = t.trim(); draw(); toast("Renommé", "ok"); }
            catch (err) { toast(errorText(err), "err"); }
          }
        },
        i > 0 ? { label: "Monter", icon: "arrowUp", run: () => moveTrack(i, i - 1) } : null,
        i < projects.length - 1 ? { label: "Descendre", icon: "arrowDown", run: () => moveTrack(i, i + 1) } : null,
        { label: "Toutes les versions", icon: "layers", run: () => ctx.navigate("#/p/" + p.id) },
        !canEditProject(p) ? null : {
          label: "Supprimer ce morceau et ses versions", icon: "trash", danger: true,
          run: async () => {
            const ok = await confirmSheet("Toutes les versions, leurs fichiers et leurs retours seront effacés.",
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
      ].filter(Boolean));
    }
  });

  const canEditProject = (p) => p.created_by === s.participantId || s.isHost;

  // ---------------------------------------------------- ordre des morceaux
  // Nouvel ordre enregistré morceau par morceau (seuls ceux qui bougent).
  async function saveOrder() {
    const changed = projects.map((p, k) => [p, k]).filter(([p, k]) => p.position !== k);
    for (const [p, k] of changed) p.position = k;
    draw();
    try { await Promise.all(changed.map(([p, k]) => updateProject(p.id, { position: k }))); }
    catch (err) { toast(errorText(err), "err"); load(); }
  }
  function moveTrack(from, to) {
    if (to < 0 || to >= projects.length || from === to) return;
    const [p] = projects.splice(from, 1);
    projects.splice(to, 0, p);
    saveOrder();
  }

  // Glisser-déposer à la poignée : la ligne suit le doigt ou la souris, les
  // autres s'écartent, on lâche = nouvel ordre.
  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest("[data-drag]");
    if (!handle) return;
    e.preventDefault();
    const row = handle.closest(".track");
    const rows = [...list.querySelectorAll(".track")];
    const from = rows.indexOf(row);
    const tops = rows.map((r) => r.getBoundingClientRect());
    const startY = e.clientY;
    let to = from;
    row.classList.add("is-dragging");
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà relâché */ }
    const move = (ev) => {
      const dy = ev.clientY - startY;
      row.style.transform = "translateY(" + dy + "px)";
      const mid = tops[from].top + tops[from].height / 2 + dy;
      to = from;
      for (let k = 0; k < rows.length; k++) {
        if (k < from && mid < tops[k].top + tops[k].height / 2) { to = k; break; }
        if (k > from && mid > tops[k].top + tops[k].height / 2) to = k;
      }
      rows.forEach((r, k) => {
        if (r === row) return;
        const shift = from < to && k > from && k <= to ? -tops[from].height
          : from > to && k >= to && k < from ? tops[from].height : 0;
        r.style.transform = shift ? "translateY(" + shift + "px)" : "";
      });
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      rows.forEach((r) => { r.style.transform = ""; });
      row.classList.remove("is-dragging");
      if (to !== from) moveTrack(from, to);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });

  playAll.onclick = () => {
    const all = tracks();
    if (all.length) playQueue(all, 0);
  };

  let loading = false;
  let again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const [ps, all] = await Promise.all([listProjects(s.id), listReviewComments(s.id)]);
      // ordre d'album : celui choisi à la main, sinon l'ordre d'arrivée
      projects = ps.slice().sort((a, b) => {
        const pa = a.position == null ? Infinity : a.position;
        const pb = b.position == null ? Infinity : b.position;
        return pa !== pb ? pa - pb : (a.created_at < b.created_at ? -1 : 1);
      });
      stats = new Map();
      for (const c of all) {
        const st = stats.get(c.file_id) || { open: 0, verify: 0, all: 0 };
        const k = stateOf(c);
        if (k !== "done") st[k]++;
        st.all++;
        stats.set(c.file_id, st);
      }
      const was = engineer;
      engineer = s.isHost || isEngineerOf(s, projects.flatMap((p) => p.files || []));
      if (engineer !== was) { drawEngineerActions(); drawCover(); drawHelp(); }
      loaded = true;
      draw();
    } catch (err) {
      list.innerHTML = '<li class="tracklist-empty">' + esc(errorText(err)) + "</li>";
    }
    loading = false;
    if (again) { again = false; load(); }
  }

  drawEngineerActions();
  drawCover();
  drawHelp();
  drawAlbum();
  const albumReady = albumOf(s.id).then((a) => { coverImg = a.image; albumTitle = a.title; drawCover(); drawAlbum(); if (loaded) draw(); });
  const offCover = onCover((id, img, a) => {
    if (id !== s.id) return;
    coverImg = img;
    albumTitle = a ? a.title : albumTitle;
    drawCover(); drawAlbum();
    if (loaded) draw();
  });
  const hostReady = listParticipants(s.id).then((ps) => {
    const host = ps.find((x) => x.is_host);
    hostName = host ? host.pseudo : "";
    drawAlbum();
  }).catch(() => {});
  if (engineer) reviewNotifyStatus(s.id).then((r) => { notifyEmail = r && r.email; drawEngineerActions(); }).catch(() => {});

  const offUploads = mountUploads(root.querySelector("[data-uploads]"));
  const offDb = ctx.bus.on("db", (e) => {
    if (e.table === "projects" || e.table === "files" || e.table === "comments") load();
  });
  // morceau en cours : pochette qui danse, bouton pause
  const offPlayer = onPlayer((type) => { if (type === "track" || type === "state") draw(); });
  ctx.setDrop((files) => { if (engineer) openUploadSheet(ctx, files); });

  await load();
  // l'artiste qui arrive : on lui propose d'habiller l'album
  if (!engineer && !welcomed()) {
    await Promise.all([albumReady, hostReady]);
    if (root.isConnected) openWelcome();
  }
  return () => { offUploads(); offDb(); offPlayer(); offCover(); };
}
