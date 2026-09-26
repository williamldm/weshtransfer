// Accueil de l'espace : gros boutons d'action, uploads en cours, morceaux
// triés par activité récente.

import { listProjects, createProject, listReviewComments, deleteProject, deleteFile, reviewNotifyStatus, reviewSubscribe, reviewUnsubscribe } from "../api.js?v=89";
import { ensureVerified } from "../verify.js?v=89";
import { mountReviewHome } from "./review-home.js?v=89";
import { mountJam } from "./jam.js?v=89";
import { stateOf, isEngineerOf } from "./review.js?v=89";
import { mountUploads } from "./uploads.js?v=89";
import { openUploadSheet } from "./upload-sheet.js?v=89";
import { openPeopleSheet } from "./people.js?v=89";
import { icon } from "../icons.js?v=89";
import { esc, h, kindBadge, timeAgo, plural, promptSheet, toast, errorText, daysLeft, formatDate, actionSheet, confirmSheet } from "../ui.js?v=89";

export const title = (ctx) => ctx.space.name;

// Espace de retours : où en est chaque mix, vu par l'ingé ou par
// l'artiste (ce que CHACUN a à faire).
function reviewStatus(files, stats, engineer) {
  const latest = files.slice().sort((a, b) => b.version_no - a.version_no)[0];
  if (!latest) return "";
  const v = "v" + latest.version_no;
  let open = 0, verify = 0, any = 0;
  for (const f of files) {
    const s = stats.get(f.id);
    if (s) { open += s.open; verify += s.verify; any += s.all; }
  }
  if (latest.approved_at) return '<span class="status is-ok">' + icon("check", 14) + " " + v + " validée</span>";
  if (engineer) {
    if (open) return '<span class="status is-todo">' + plural(open, "retour à corriger", "retours à corriger") + "</span>";
    if (verify) return '<span class="status">' + v + " · " + plural(verify, "correction", "corrections") + " chez l'artiste</span>";
    return '<span class="status">' + v + " · en attente de l'artiste</span>";
  }
  if (verify) return '<span class="status is-todo">' + icon("check", 14) + " " + plural(verify, "correction à vérifier", "corrections à vérifier") + "</span>";
  if (open) return '<span class="status">' + plural(open, "retour", "retours") + " chez l'ingé</span>";
  return '<span class="status is-todo">' + v + (any ? " à valider" : " à écouter") + "</span>";
}

export function renderProjects(projects, stats, canEdit, space) {
  const review = !!stats;
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
        '<div class="kinds">' + reviewStatus(files, stats, isEngineerOf(space, files)) + "</div>" +
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
  // retours de mix : présentation "album" à part
  if (ctx.space.mode === "revue") return mountReviewHome(root, ctx);
  // séminaire : la jam, file commune écoutée ensemble
  if (ctx.space.mode === "seminaire") return mountJam(root, ctx);
  const s = ctx.space;
  const review = s.mode === "revue";
  root.innerHTML =
    '<section class="space-card">' +
      '<div class="space-top">' +
        '<div><div class="eyebrow">' + (review ? "Verdict" : s.mode === "seminaire" ? "Séminaire" : "Espace") + "</div><h1>" + esc(s.name) + "</h1></div>" +
        (s.access === "invite" && s.mode !== "envoi"
          ? '<button class="code-chip is-invite" data-invite aria-label="Inviter par email">' + icon("mail", 16) + "<span>Inviter</span></button>"
          : '<button class="code-chip" data-invite aria-label="Inviter">' +
              '<span class="mono">' + esc(s.code) + "</span>" + icon("share", 16) +
            "</button>") +
      "</div>" +
      '<div class="space-meta" data-meta></div>' +
    "</section>" +

    (review && !s.isHost
      ? '<p class="review-hint">' + icon("comment", 18) + "<span>Écoute les mix, mets le son en pause là où quelque chose cloche, et écris ton retour : il sera accroché à la seconde près.</span></p>"
      : "") +
    // En retours de mix, l'artiste n'a rien à déposer en priorité : il
    // écoute. Ses actions passent au second plan (une référence à envoyer).
    (review && s.isHost ? '<div class="rv-notify" data-rv-notify hidden></div>' : "") +
    '<div class="hero-actions">' +
      (review && !s.isHost
        ? '<label class="btn btn-xl">' + icon("upload", 22) + "<span>Envoyer une référence</span>" +
            '<input type="file" multiple hidden data-pick></label>' +
          '<button class="btn btn-xl" data-invite>' + icon("share", 22) + "<span>Inviter quelqu'un</span></button>"
        : '<label class="btn btn-primary btn-xl">' + icon("upload", 22) + "<span>" + (review ? "Déposer un mix" : "Ajouter des sons") + "</span>" +
            '<input type="file" multiple hidden data-pick>' +
          "</label>" +
          (review
            ? '<button class="btn btn-xl" data-invite>' + icon("share", 22) + "<span>Inviter l'artiste</span></button>"
            : '<a class="btn btn-xl" href="#/send">' + icon("send", 22) + "<span>Envoyer par email</span></a>")) +
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
      (left != null ? ' · <span title="' + esc(formatDate(s.purgeAt)) + '">fichiers supprimés dans ' + plural(left, "jour", "jours") + "</span>"
        : s.purgeAt === null ? " · conservé sans limite" : "");
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
        const [projects, all] = await Promise.all([listProjects(s.id), listReviewComments(s.id)]);
        const stats = new Map();
        for (const c of all) {
          const st = stats.get(c.file_id) || { open: 0, verify: 0, all: 0 };
          const k = stateOf(c);
          if (k !== "done") st[k]++;
          st.all++;
          stats.set(c.file_id, st);
        }
        lastProjects = projects;
        list.innerHTML = renderProjects(projects, stats, canEdit, s);
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

  // Ingé : être prévenu par email quand l'artiste a fait ses retours
  const notify = root.querySelector("[data-rv-notify]");
  const drawNotify = (email) => {
    notify.hidden = false;
    notify.innerHTML = email
      ? icon("mail", 18) + '<span>Prévenu par email quand l\'artiste a fait ses retours : <strong>' + esc(email) + "</strong></span>" +
        '<button class="btn btn-ghost btn-sm" data-notify-off>Couper</button>'
      : icon("mail", 18) + "<span>Être prévenu par email quand l'artiste a fait ses retours</span>" +
        '<button class="btn btn-sm" data-notify-on>Activer</button>';
  };
  if (notify) {
    reviewNotifyStatus(s.id).then((r) => drawNotify(r && r.email)).catch(() => {});
    notify.addEventListener("click", async (e) => {
      if (e.target.closest("[data-notify-off]")) {
        try { await reviewUnsubscribe(s.id); drawNotify(null); toast("Plus d'emails pour cet espace", "ok"); }
        catch (err) { toast(errorText(err), "err"); }
        return;
      }
      if (!e.target.closest("[data-notify-on]")) return;
      let remembered = "";
      try { remembered = localStorage.getItem("seminaire.replyTo") || ""; } catch (err) { /* privé */ }
      const email = ((await promptSheet("Ton email", remembered, { max: 254, ok: "Continuer" })) || "").toLowerCase();
      if (!email) return;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Adresse invalide", "err"); return; }
      if (await ensureVerified(email, { optional: false }) !== "ok") return;
      try {
        const r = await reviewSubscribe(s.id, email);
        try { localStorage.setItem("seminaire.replyTo", email); } catch (err) { /* privé */ }
        drawNotify(r.email);
        toast("Un email récapitulatif partira quand l'artiste aura fini ses retours", "ok");
      } catch (err) { toast(errorText(err), "err"); }
    });
  }

  const offUploads = mountUploads(root.querySelector("[data-uploads]"));
  const offDb = ctx.bus.on("db", (e) => {
    if (e.table === "projects" || e.table === "files" || (review && e.table === "comments")) load();
  });
  const offPresence = ctx.bus.on("presence", drawMeta);

  drawMeta();
  await load();

  return () => { offUploads(); offDb(); offPresence(); };
}
