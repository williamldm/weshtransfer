// Envoi façon WeTransfer : des fichiers, des adresses, un message, et
// chaque destinataire reçoit un lien pour écouter et télécharger, sans
// compte ni code. Sans adresse, on obtient juste un lien à partager.

import {
  getProject, getFilesByIds, listSpaceFiles, createTransfer, sendTransfer, emailEnabled,
  getTransfer, transferUrl
} from "../api.js?v=2";
import { openUploadSheet } from "./upload-sheet.js?v=2";
import { onUploads } from "../upload.js?v=2";
import { icon } from "../icons.js?v=2";
import {
  esc, h, kindBadge, formatBytes, plural, toast, errorText, openSheet, copyText, shareLink,
  canShare, formatDate, daysLeft
} from "../ui.js?v=2";

export const title = () => "Envoyer";

const REPLY_KEY = "seminaire.replyTo";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DURATIONS = [1, 3, 7, 14];

function remembered() {
  try { return localStorage.getItem(REPLY_KEY) || ""; } catch (err) { return ""; }
}

export async function mount(root, ctx, params) {
  const state = {
    files: [],          // [{ id, original_name, size_bytes, kind, version_no, label, project }]
    emails: [],
    title: "",
    message: "",
    replyTo: remembered(),
    days: 7,
    sending: false
  };
  const tag = "send-" + Date.now();
  const maxDays = ctx.space.purgeAt ? daysLeft(ctx.space.purgeAt) : 30;

  root.innerHTML = '<div class="skeleton tall"></div>';

  // ------------------------------------------------ présélection
  try {
    if (params.query.get("f")) {
      const ids = params.query.get("f").split(",").filter(Boolean);
      state.files = await getFilesByIds(ids);
    } else if (params.query.get("p")) {
      const p = await getProject(params.query.get("p"));
      if (p) {
        // la dernière version par défaut : c'est presque toujours celle qu'on envoie
        const ready = p.files.filter((f) => f.status === "ready");
        if (ready[0]) state.files = [Object.assign({}, ready[0], { project: { id: p.id, title: p.title } })];
        state.title = p.title;
      }
    }
  } catch (err) {
    toast(errorText(err), "err");
  }
  if (!state.title && state.files[0]) state.title = state.files[0].project ? state.files[0].project.title : state.files[0].original_name;

  const emailOn = await emailEnabled();

  // ------------------------------------------------------ rendu
  root.innerHTML =
    '<header class="page-head">' +
      '<div class="eyebrow">Envoi</div>' +
      "<h1>Envoyer des fichiers</h1>" +
      '<div class="meta">Tes destinataires reçoivent un lien pour écouter et télécharger. Pas de compte, pas de code.</div>' +
    "</header>" +

    (emailOn ? "" :
      '<div class="notice">' + icon("alert", 18) +
        "<div><strong>Envoi d'emails pas encore activé.</strong> Tu obtiendras un lien à partager (WhatsApp, SMS, ta messagerie), " +
        "et un lien personnel par destinataire.</div></div>") +

    '<form class="send-form" novalidate data-form>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Fichiers</h2><span class="muted" data-total></span></div>' +
        '<ul class="send-files" data-files></ul>' +
        '<div class="row-2 stack-sm">' +
          '<button type="button" class="btn btn-block" data-pick>' + icon("music", 18) + "<span>Depuis l'espace</span></button>" +
          '<label class="btn btn-block">' + icon("upload", 18) + "<span>Nouveaux fichiers</span>" +
            '<input type="file" multiple hidden accept=".mp3,.wav,.aif,.aiff,.m4a,.flac,.ogg,.zip,audio/*" data-upload></label>' +
        "</div>" +
        '<div class="send-pending" data-pending hidden></div>' +
      "</section>" +

      '<section class="card">' +
        '<div class="card-head"><h2>À qui ?</h2><span class="muted">facultatif</span></div>' +
        '<div class="email-input" data-emailbox>' +
          '<span data-chips></span>' +
          '<input type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" ' +
            'placeholder="email@exemple.fr" data-email>' +
        "</div>" +
        '<p class="hint">Sépare les adresses par un espace ou une virgule. Sans adresse : tu récupères juste le lien.</p>' +
      "</section>" +

      '<section class="card">' +
        '<label class="field"><span class="label">Titre</span>' +
          '<input class="input" name="title" maxlength="80" required placeholder="Ex : Nuit blanche, mix du jour 2" value="' + esc(state.title) + '"></label>' +
        '<label class="field"><span class="label">Message</span>' +
          '<textarea class="input" name="message" rows="3" maxlength="2000" placeholder="Un mot pour accompagner les sons"></textarea></label>' +
        '<label class="field"><span class="label">Ton email</span>' +
          '<input class="input" type="email" name="reply" inputmode="email" autocomplete="email" autocapitalize="off" value="' + esc(state.replyTo) + '" placeholder="pour les réponses">' +
          '<span class="hint">Les réponses t\'arrivent directement, et tu es prévenu à chaque téléchargement.</span></label>' +
        '<div class="field"><span class="label">Disponible pendant</span><div class="chips" data-days>' +
          DURATIONS.map((d) => '<button type="button" class="chip' + (d === state.days ? " is-on" : "") + '" data-d="' + d + '"' +
            (d > maxDays ? " disabled" : "") + ">" + plural(d, "jour", "jours") + "</button>").join("") +
        "</div>" +
        (ctx.space.purgeAt ? '<span class="hint">Au plus tard jusqu\'au ' + esc(formatDate(ctx.space.purgeAt)) + ", date de suppression de l'espace.</span>" : "") +
        "</div>" +
      "</section>" +

      '<button class="btn btn-primary btn-block btn-xl" type="submit" data-submit></button>' +
    "</form>";

  const form = root.querySelector("[data-form]");
  const titleInput = form.querySelector("[name=title]");
  const messageInput = form.querySelector("[name=message]");
  const replyInput = form.querySelector("[name=reply]");
  const filesEl = root.querySelector("[data-files]");
  const totalEl = root.querySelector("[data-total]");
  const chipsEl = root.querySelector("[data-chips]");
  const emailEl = root.querySelector("[data-email]");
  const submitEl = root.querySelector("[data-submit]");
  const pendingEl = root.querySelector("[data-pending]");

  // Si la durée par défaut dépasse la vie de l'espace, on prend la plus longue possible.
  if (state.days > maxDays) {
    const best = DURATIONS.filter((d) => d <= maxDays).pop() || 1;
    state.days = best;
    for (const b of root.querySelectorAll("[data-d]")) b.classList.toggle("is-on", Number(b.dataset.d) === best);
  }

  function drawFiles() {
    filesEl.innerHTML = state.files.length
      ? state.files.map((f) =>
          '<li data-id="' + f.id + '">' + kindBadge(f.kind) +
            '<div class="sf-main"><div class="sf-name">' + esc(f.original_name) + "</div>" +
            '<div class="sf-meta">' + esc((f.project ? f.project.title + " · " : "") + "v" + f.version_no + " · " + formatBytes(f.size_bytes)) + "</div></div>" +
            '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="Retirer">' + icon("x", 18) + "</button>" +
          "</li>").join("")
      : '<li class="sf-empty">Aucun fichier sélectionné.</li>';
    const total = state.files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    totalEl.textContent = state.files.length ? plural(state.files.length, "fichier", "fichiers") + " · " + formatBytes(total) : "";
    drawSubmit();
  }

  function drawChips() {
    chipsEl.innerHTML = state.emails.map((e, i) =>
      '<span class="email-chip' + (EMAIL_RE.test(e) ? "" : " is-bad") + '">' + esc(e) +
      '<button type="button" data-rm="' + i + '" aria-label="Retirer ' + esc(e) + '">' + icon("x", 14) + "</button></span>").join("");
    drawSubmit();
  }

  function drawSubmit() {
    const n = state.emails.length;
    const label = n && emailOn ? "Envoyer à " + plural(n, "personne", "personnes") : "Créer le lien";
    submitEl.innerHTML = icon(n && emailOn ? "send" : "link", 22) + "<span>" + label + "</span>";
    submitEl.disabled = state.sending || !state.files.length;
  }

  // ------------------------------------------- saisie des emails en pastilles
  function commitEmails(raw) {
    const parts = String(raw || "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    let added = 0;
    for (const p of parts) {
      if (!state.emails.includes(p) && state.emails.length < 20) {
        state.emails.push(p);
        added++;
      }
    }
    if (parts.length && state.emails.length >= 20) toast("20 destinataires maximum", "err");
    if (added) drawChips();
  }

  emailEl.addEventListener("keydown", (e) => {
    if (["Enter", ",", " ", ";"].includes(e.key)) {
      if (emailEl.value.trim()) {
        e.preventDefault();
        commitEmails(emailEl.value);
        emailEl.value = "";
      } else if (e.key === "Enter") {
        e.preventDefault();
      }
    } else if (e.key === "Backspace" && !emailEl.value && state.emails.length) {
      state.emails.pop();
      drawChips();
    }
  });
  emailEl.addEventListener("paste", (e) => {
    const text = (e.clipboardData || window.clipboardData).getData("text");
    if (/[\s,;]/.test(text.trim())) {
      e.preventDefault();
      commitEmails(text);
    }
  });
  emailEl.addEventListener("blur", () => {
    if (emailEl.value.trim()) { commitEmails(emailEl.value); emailEl.value = ""; }
  });
  root.querySelector("[data-emailbox]").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (rm) {
      state.emails.splice(Number(rm.dataset.rm), 1);
      drawChips();
      return;
    }
    emailEl.focus();
  });

  // --------------------------------------------------------- fichiers
  filesEl.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove]");
    if (!rm) return;
    const id = rm.closest("li").dataset.id;
    state.files = state.files.filter((f) => f.id !== id);
    drawFiles();
  });

  root.querySelector("[data-pick]").onclick = () => openPicker(ctx, state.files.map((f) => f.id), (chosen) => {
    const known = new Set(state.files.map((f) => f.id));
    for (const f of chosen) if (!known.has(f.id)) state.files.push(f);
    state.files = state.files.filter((f) => chosen.some((c) => c.id === f.id));
    if (!titleInput.value.trim() && state.files[0]) {
      titleInput.value = state.files[0].project ? state.files[0].project.title : state.files[0].original_name;
    }
    drawFiles();
  });

  // Nouveaux fichiers : uploadés dans un morceau de l'espace, puis ajoutés
  // automatiquement à l'envoi dès qu'ils sont en ligne.
  let waiting = 0;
  root.querySelector("[data-upload]").addEventListener("change", (e) => {
    const title = titleInput.value.trim();
    openUploadSheet(ctx, e.target.files, {
      tag,
      newTitle: title || null,
      onQueued: (jobs) => {
        waiting += jobs.length;
        drawPending();
        if (!titleInput.value.trim() && jobs[0]) titleInput.value = jobs[0].meta.projectTitle;
      }
    });
    e.target.value = "";
  });

  function drawPending() {
    pendingEl.hidden = waiting <= 0;
    pendingEl.innerHTML = waiting > 0
      ? '<span class="spinner"></span> ' + plural(waiting, "fichier en cours d'upload", "fichiers en cours d'upload") + ", ils s'ajoutent tout seuls."
      : "";
    submitEl.disabled = state.sending || !state.files.length;
  }

  const offUploads = onUploads(async (job) => {
    if (!job || job.meta.tag !== tag) return;
    if (job.state === "done" && job.result && !job.counted) {
      job.counted = true;
      waiting--;
      try {
        const [f] = await getFilesByIds([job.result.id]);
        if (f && !state.files.some((x) => x.id === f.id)) { state.files.push(f); drawFiles(); }
      } catch (err) { /* réseau */ }
      drawPending();
    }
    if ((job.state === "error" || job.state === "canceled" || job.state === "dismissed") && !job.counted) {
      job.counted = true;
      waiting--;
      drawPending();
    }
  });

  // ------------------------------------------------------- durée
  root.querySelector("[data-days]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-d]");
    if (!b || b.disabled) return;
    state.days = Number(b.dataset.d);
    for (const x of root.querySelectorAll("[data-d]")) x.classList.toggle("is-on", x === b);
  });

  // ------------------------------------------------------- envoi
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (emailEl.value.trim()) { commitEmails(emailEl.value); emailEl.value = ""; }

    const bad = state.emails.find((x) => !EMAIL_RE.test(x));
    if (bad) return toast("Adresse invalide : " + bad, "err");
    if (!state.files.length) return toast("Ajoute au moins un fichier", "err");
    if (waiting > 0) return toast("Attends la fin des uploads en cours", "err");

    const title = titleInput.value.trim();
    if (!title) { titleInput.focus(); return toast("Donne un titre à l'envoi", "err"); }

    const replyTo = replyInput.value.trim().toLowerCase();
    if (replyTo && !EMAIL_RE.test(replyTo)) { replyInput.focus(); return toast("Ton email n'est pas valide", "err"); }
    try { localStorage.setItem(REPLY_KEY, replyTo); } catch (err) { /* privé */ }

    state.sending = true;
    drawSubmit();
    submitEl.innerHTML = '<span class="spinner"></span><span>' + (state.emails.length && emailOn ? "Envoi..." : "Création du lien...") + "</span>";

    try {
      const created = await createTransfer({
        spaceId: ctx.space.id,
        title,
        fileIds: state.files.map((f) => f.id),
        emails: state.emails,
        message: messageInput.value,
        replyTo,
        days: state.days
      });

      let results = [];
      if (state.emails.length && emailOn) {
        try {
          const r = await sendTransfer(created.id);
          results = (r && r.results) || [];
        } catch (err) {
          toast("Lien créé, mais l'envoi des emails a échoué : " + errorText(err), "err");
        }
      }
      showDone(root, ctx, created, { emailOn, results, title });
    } catch (err) {
      state.sending = false;
      drawSubmit();
      toast(errorText(err), "err");
    }
  });

  drawFiles();
  drawChips();

  return () => { offUploads(); };
}

// ---------------------------------------------------------------- succès

export async function showDone(root, ctx, created, info) {
  const url = transferUrl(created.token);
  let transfer = null;
  try { transfer = await getTransfer(created.id); } catch (err) { /* on affiche quand même le lien */ }
  const recipients = transfer ? transfer.transfer_recipients : [];

  const sent = recipients.filter((r) => r.status === "sent").length;
  const failed = recipients.filter((r) => r.status === "failed").length;
  const headline = !recipients.length || !info.emailOn
    ? "Ton lien est prêt"
    : failed && !sent ? "Lien créé, emails non partis" : "Envoyé !";
  const sub = !recipients.length || !info.emailOn
    ? "Partage-le où tu veux. Il expire le " + formatDate(created.expires_at) + "."
    : plural(sent, "email parti", "emails partis") + (failed ? ", " + failed + " en échec" : "") +
      ". Disponible jusqu'au " + formatDate(created.expires_at) + ".";

  root.innerHTML =
    '<div class="done">' +
      '<div class="done-icon">' + icon(failed && !sent && info.emailOn && recipients.length ? "alert" : "check", 40) + "</div>" +
      "<h1>" + esc(headline) + "</h1>" +
      '<p class="muted">' + esc(sub) + "</p>" +

      '<div class="link-box">' +
        '<input class="input mono" readonly value="' + esc(url) + '" data-url>' +
        '<div class="row-2">' +
          '<button class="btn btn-block" data-copy>' + icon("copy", 18) + "<span>Copier</span></button>" +
          (canShare() ? '<button class="btn btn-primary btn-block" data-share>' + icon("share", 18) + "<span>Partager</span></button>" : "") +
        "</div>" +
      "</div>" +

      (recipients.length
        ? '<div class="section-head"><h2>Destinataires</h2></div><ul class="recipients">' +
          recipients.map((r) => {
            const personal = transferUrl(r.token);
            const status = !info.emailOn ? "" : r.status === "sent"
              ? '<span class="st st-ok">' + icon("check", 14) + " envoyé</span>"
              : r.status === "failed" ? '<span class="st st-bad">échec</span>' : '<span class="st">en attente</span>';
            const mailto = "mailto:" + encodeURIComponent(r.email) +
              "?subject=" + encodeURIComponent(ctx.space.pseudo + " t'a envoyé : " + info.title) +
              "&body=" + encodeURIComponent("Écoute et télécharge ici :\n" + personal + "\n\nDisponible jusqu'au " + formatDate(created.expires_at) + ".");
            return "<li><span class=\"r-mail\">" + esc(r.email) + "</span>" + status +
              (!info.emailOn || r.status === "failed"
                ? '<a class="btn btn-sm" href="' + esc(mailto) + '">' + icon("mail", 16) + " Écrire</a>"
                : "") +
            "</li>";
          }).join("") + "</ul>"
        : "") +

      '<div class="row-2 done-actions">' +
        '<a class="btn btn-block" href="#/transfers">Mes envois</a>' +
        '<button class="btn btn-block" data-again>Nouvel envoi</button>' +
      "</div>" +
    "</div>";

  root.querySelector("[data-copy]").onclick = async () => {
    toast(await copyText(url) ? "Lien copié" : "Copie impossible", "ok");
  };
  const share = root.querySelector("[data-share]");
  if (share) {
    share.onclick = () => shareLink({ title: info.title, text: ctx.space.pseudo + " t'envoie : " + info.title, url });
  }
  root.querySelector("[data-url]").addEventListener("focus", (e) => e.target.select());
  root.querySelector("[data-again]").onclick = () => {
    // même route : on force le remontage
    ctx.navigate("#/send?new=" + Date.now());
  };
  window.scrollTo(0, 0);
}

// -------------------------------------------------- sélecteur de fichiers

async function openPicker(ctx, selectedIds, onDone) {
  const selected = new Set(selectedIds);
  const body = h('<div class="picker"><div class="skeleton"></div></div>');
  const sheet = openSheet({ title: "Fichiers de l'espace", body });

  let projects = [];
  try {
    projects = await listSpaceFiles(ctx.space.id);
  } catch (err) {
    body.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
    return;
  }

  const index = new Map();
  for (const p of projects) {
    for (const f of p.files || []) index.set(f.id, Object.assign({}, f, { project: { id: p.id, title: p.title } }));
  }

  body.innerHTML =
    projects.filter((p) => (p.files || []).some((f) => f.status === "ready")).map((p) =>
      '<details class="pick-project"' + ((p.files || []).some((f) => selected.has(f.id)) ? " open" : "") + ">" +
        "<summary><span>" + esc(p.title) + '</span><span class="count">' + p.files.filter((f) => f.status === "ready").length + "</span></summary>" +
        p.files.filter((f) => f.status === "ready").map((f) =>
          '<label class="pick-file"><input type="checkbox" value="' + f.id + '"' + (selected.has(f.id) ? " checked" : "") + ">" +
            '<span class="pf-main"><span class="pf-name">v' + f.version_no + " " + esc(f.label || f.original_name) + "</span>" +
            '<span class="pf-meta">' + kindBadge(f.kind) + " " + formatBytes(f.size_bytes) + "</span></span></label>").join("") +
      "</details>").join("") +
    '<div class="sheet-actions sticky"><button class="btn btn-primary btn-block" data-ok>Valider</button></div>';

  if (!index.size) {
    body.innerHTML = '<div class="empty-state">' + icon("music", 32) + "<p>Aucun fichier dans l'espace pour l'instant.</p></div>";
    return;
  }

  body.querySelector("[data-ok]").onclick = () => {
    const ids = [...body.querySelectorAll("input[type=checkbox]:checked")].map((i) => i.value);
    onDone(ids.map((id) => index.get(id)).filter(Boolean));
    sheet.close();
  };
}
