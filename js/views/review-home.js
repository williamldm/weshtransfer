// Accueil d'un espace de retours, présenté comme un album : grande
// pochette, "Tout écouter", liste des morceaux avec un seul statut chacun.
// Toucher un morceau ouvre directement sa page de retours (dernière
// version) ; toucher sa pochette le joue, et les suivants s'enchaînent.

import {
  listProjects, listReviewComments, deleteProject, deleteFile,
  reviewNotifyStatus, reviewSubscribe, reviewUnsubscribe
} from "../api.js?v=77";
import { mountUploads } from "./uploads.js?v=77";
import { openUploadSheet } from "./upload-sheet.js?v=77";
import { stateOf, isEngineerOf } from "./review.js?v=77";
import { ensureVerified } from "../verify.js?v=77";
import { accountEmail } from "../session.js?v=77";
import { coverOf, onCover, setCover, clearCover } from "../cover.js?v=77";
import { playQueue, onPlayer, isCurrent, state as playerState, toggle, trackFromFile } from "../player.js?v=77";
import { icon } from "../icons.js?v=77";
import { esc, plural, toast, errorText, formatDuration, actionSheet, confirmSheet, promptSheet } from "../ui.js?v=77";

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

const HELP_KEY = "weshtransfer.reviewHelp";
function helpClosed() {
  try { return localStorage.getItem(HELP_KEY) === "closed"; } catch (err) { return false; }
}

export async function mountReviewHome(root, ctx) {
  const s = ctx.space;
  let projects = [];
  let stats = new Map();
  let engineer = !!s.isHost;
  let coverImg = null;
  let loaded = false;

  root.innerHTML =
    '<section class="rh-hero">' +
      '<div class="rh-cover" data-cover-box></div>' +
      '<input type="file" accept="image/*" hidden data-cover-pick>' +
      '<div class="rh-info">' +
        '<p class="eyebrow">Verdict</p>' +
        "<h1>" + esc(s.name) + "</h1>" +
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
          "<li><b>Demande tes modifs.</b> Là où quelque chose te gêne, écris-le avec tes mots : voix trop loin, basse trop forte, fin trop longue... Le retour s'accroche à la seconde près.</li>" +
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
      tr.album = s.name;
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
    const canEdit = (p) => p.created_by === s.participantId || s.isHost;
    list.innerHTML = projects.map((p, i) => {
      const f = latestOf(p);
      const st = statusOf(p, stats, engineer);
      const playing = f && isCurrent(f.id);
      return '<li class="track' + (playing ? " is-current" : "") + (playing && playerState().playing ? " is-playing" : "") + '" data-id="' + p.id + '">' +
        '<button class="track-art" data-play="' + i + '" aria-label="Écouter ' + esc(p.title) + '"' + (f ? "" : " disabled") + ">" +
          cover(p.title, "", coverImg) + '<span class="track-play">' + icon(playing && playerState().playing ? "pause" : "play", 18) + "</span>" +
          '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
        "</button>" +
        '<a class="track-main" href="' + (f ? "#/f/" + f.id : "#/p/" + p.id) + '">' +
          '<span class="track-title">' + esc(p.title) + "</span>" +
          '<span class="track-sub">' + (f ? "v" + f.version_no : "pas encore de version") +
            (st.text ? ' · <em class="track-note ' + st.cls + '">' + esc(st.text) + "</em>" : "") + "</span>" +
        "</a>" +
        '<span class="track-dur mono">' + (f && f.duration_sec ? formatDuration(Number(f.duration_sec)) : "") + "</span>" +
        (canEdit(p) ? '<button class="btn btn-ghost btn-icon btn-sm" data-menu aria-label="Options">' + icon("more", 18) + "</button>" : "") +
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
      actionSheet(p.title, [
        { label: "Toutes les versions", icon: "layers", run: () => ctx.navigate("#/p/" + p.id) },
        {
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
      ]);
    }
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
      // ordre d'album : le premier morceau déposé en premier
      projects = ps.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
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
  coverOf(s.id).then((img) => { coverImg = img; drawCover(); if (loaded) draw(); });
  const offCover = onCover((id, img) => { if (id === s.id) { coverImg = img; drawCover(); if (loaded) draw(); } });
  if (engineer) reviewNotifyStatus(s.id).then((r) => { notifyEmail = r && r.email; drawEngineerActions(); }).catch(() => {});

  const offUploads = mountUploads(root.querySelector("[data-uploads]"));
  const offDb = ctx.bus.on("db", (e) => {
    if (e.table === "projects" || e.table === "files" || e.table === "comments") load();
  });
  // morceau en cours : pochette qui danse, bouton pause
  const offPlayer = onPlayer((type) => { if (type === "track" || type === "state") draw(); });
  ctx.setDrop((files) => { if (engineer) openUploadSheet(ctx, files); });

  await load();
  return () => { offUploads(); offDb(); offPlayer(); offCover(); };
}
