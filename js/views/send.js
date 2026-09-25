// Envoi façon WeTransfer : des fichiers, des adresses, un message, et
// chaque destinataire reçoit un lien pour écouter et télécharger, sans
// compte ni code. Sans adresse, on obtient juste un lien à partager.

import {
  getProject, getFilesByIds, createTransfer, sendTransfer, emailEnabled,
  getTransfer, transferUrl, createProject, signFiles, cachedUrl,
  knownVerified, listContacts, forgetContact, rememberContactsLocal
} from "../api.js?v=69";
import { accountEmail } from "../session.js?v=69";
import { ensureVerified } from "../verify.js?v=69";
import { openUploadSheet } from "./upload-sheet.js?v=69";
import { mountUploads } from "./uploads.js?v=69";
import { onUploads, enqueue, checkFile, getJobs } from "../upload.js?v=69";
import { categoryOf, canPreview } from "../files.js?v=69";
import { takePending } from "../pending.js?v=69";
import { icon } from "../icons.js?v=69";
import {
  esc, h, formatBytes, formatDuration, plural, toast, errorText, openSheet, copyText, shareLink,
  canShare, formatDate, daysLeft, fileBadge, fileTile
} from "../ui.js?v=69";

// Dans un espace "envoi", ce composeur EST l'accueil.
export const title = (ctx) => (ctx && ctx.space.mode === "envoi" ? ctx.space.name : "Envoyer");

const REPLY_KEY = "seminaire.replyTo";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DURATIONS = [1, 3, 7, 14];

// Ce que coûte chaque durée à la planète (selon nos calculs, faux).
const DAY_JOKES = {
  1: "24 h : la centrale tourne à peine, on a presque honte.",
  3: "3 jours : un plein de jet privé, sans le champagne.",
  7: "7 jours : une semaine de serveurs au charbon. Classique.",
  14: "14 jours : on rallume une deuxième centrale, rien que pour toi."
};

// Le nom d'un fichier sans son extension : "Nuit blanche - mix v3"
const baseName = (name) => String(name || "").replace(/\.[a-z0-9]{1,10}$/i, "").trim() || String(name || "");

// Ton email : celui du compte connecté, sinon le dernier utilisé ici.
function remembered() {
  const account = accountEmail();
  if (account) return account;
  try { return localStorage.getItem(REPLY_KEY) || ""; } catch (err) { return ""; }
}

// Première version : carnet gardé dans le navigateur. Il vit désormais
// sur le serveur, rattaché à l'email d'expédition : on efface l'ancien.
try { localStorage.removeItem("seminaire.recentRecipients"); } catch (err) { /* privé */ }

// Suggestions pour ce qui est tapé : début de l'adresse, du nom de
// domaine, ou d'un morceau séparé par un point, un tiret...
function suggest(contacts, query, exclude) {
  const q = query.trim().toLowerCase();
  const list = contacts.filter((r) => !exclude.includes(r.email));
  if (!q) return list.slice(0, 6);
  return list
    .filter((r) => r.email.startsWith(q) || r.email.split(/[@._+-]/).some((part) => part.startsWith(q)))
    .sort((a, b) => Number(b.email.startsWith(q)) - Number(a.email.startsWith(q)) || (a.last_at < b.last_at ? 1 : -1))
    .slice(0, 6);
}

export async function mount(root, ctx, params) {
  const state = {
    files: [],          // [{ id, original_name, size_bytes, kind, version_no, label, project }]
    emails: [],
    title: "",
    message: "",
    replyTo: remembered(),
    days: 7,
    sending: false,
    contacts: [],       // carnet de l'email d'expédition (vérifié)
    contactsOf: ""
  };
  const tag = "send-" + Date.now();
  const envoiMode = ctx.space.mode === "envoi";
  let draft = null;   // morceau créé en coulisse pour les fichiers de cet envoi
  let waiting = 0;    // fichiers de cet envoi encore en cours d'upload
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
  // Façon WeTransfer : les fichiers, à qui, un mot, un bouton. Le reste
  // (titre, durée) est replié dans "Options", l'expéditeur tient sur une
  // ligne quand on le connaît déjà.
  const knownFrom = !!state.replyTo;
  root.innerHTML =
    '<form class="send-card sx" novalidate data-form>' +
      '<h1 class="sx-title">' + (envoiMode ? "Nouvel envoi" : "Envoyer des fichiers") + "</h1>" +

      '<div class="sx-files">' +
        '<ul class="send-files" data-files></ul>' +
        '<div class="send-pending" data-pending hidden></div>' +
        '<label class="sx-add" data-dropzone>' +
          '<span class="sx-add-ic">' + icon("plus", 20) + "</span>" +
          '<span class="sx-add-txt"><strong data-add-label>Ajoute tes fichiers</strong><small data-total>ou glisse-les ici · ' +
            formatBytes(ctx.space.maxFileBytes || 3221225472) + " max</small></span>" +
          (envoiMode ? '<input type="file" multiple hidden data-upload>' : '<input type="file" multiple hidden data-upload-sheet>') +
        "</label>" +
      "</div>" +

      '<div class="sx-row">' +
        '<div class="email-input" data-emailbox>' +
          '<span data-chips></span>' +
          // type="text" et non "email" : un champ email efface lui-même les
          // espaces de fin, le séparateur tapé serait invisible. inputmode
          // garde le clavier email sur mobile.
          '<input type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" ' +
            'placeholder="Envoyer à (email)" aria-label="Destinataires" data-email>' +
        "</div>" +
        '<div class="recents" data-recents hidden></div>' +
      "</div>" +

      '<textarea class="input sx-msg" name="message" rows="2" maxlength="2000" placeholder="Un message ? (facultatif)" aria-label="Message"></textarea>' +

      '<div class="sx-from" data-from>' +
        (knownFrom
          ? '<span class="sx-from-line">De <strong data-from-email>' + esc(state.replyTo) + '</strong> <button type="button" class="link-btn" data-change-from>changer</button></span>'
          : "") +
        '<input class="input" type="email" name="reply" inputmode="email" autocomplete="email" autocapitalize="off" value="' + esc(state.replyTo) +
          '" placeholder="Ton email" aria-label="Ton email"' + (knownFrom ? " hidden" : "") + ">" +
        '<span class="hint" data-reply-hint></span>' +
      "</div>" +

      '<details class="sx-more">' +
        '<summary>Options <span class="muted" data-more-sum></span></summary>' +
        '<label class="field"><span class="label">Titre</span>' +
          '<input class="input" name="title" maxlength="80" placeholder="Ex : Nuit blanche, mix du jour 2" value="' + esc(state.title) + '"></label>' +
        '<div class="field"><span class="label">Disponible pendant</span><div class="chips" data-days>' +
          DURATIONS.map((d) => '<button type="button" class="chip' + (d === state.days ? " is-on" : "") + '" data-d="' + d + '"' +
            (d > maxDays ? " disabled" : "") + ">" + plural(d, "jour", "jours") + "</button>").join("") +
        '</div><span class="hint sx-joke" data-day-joke></span></div>' +
      "</details>" +

      '<button class="btn btn-primary btn-block btn-xl" type="submit" data-submit></button>' +
      (emailOn ? "" : '<p class="hint center">' + icon("link", 14) + " Tu obtiens un lien à partager.</p>") +
    "</form>" +
    (envoiMode
      ? '<a class="link-row sx-history" href="#/transfers">' + icon("mail", 18) + "<span>Mes envois</span>" + icon("chevron", 18) + "</a>"
      : "");

  const form = root.querySelector("[data-form]");
  const titleInput = form.querySelector("[name=title]");
  const messageInput = form.querySelector("[name=message]");
  const replyInput = form.querySelector("[name=reply]");
  const filesEl = root.querySelector("[data-files]");
  const totalEl = root.querySelector("[data-total]");
  const chipsEl = root.querySelector("[data-chips]");
  const emailEl = root.querySelector("[data-email]");
  const recentsEl = root.querySelector("[data-recents]");
  const submitEl = root.querySelector("[data-submit]");
  const pendingEl = root.querySelector("[data-pending]");
  const replyHint = root.querySelector("[data-reply-hint]");
  const waybillEl = null;   // bordereau retiré : la page reste simple
  const moreSum = root.querySelector("[data-more-sum]");
  const addLabel = root.querySelector("[data-add-label]");

  // "De ... changer" : le champ réapparaît pour taper une autre adresse
  const changeFrom = root.querySelector("[data-change-from]");
  if (changeFrom) {
    changeFrom.onclick = () => {
      changeFrom.closest(".sx-from-line").hidden = true;
      replyInput.hidden = false;
      replyInput.focus();
      replyInput.select();
    };
  }
  const dayJoke = root.querySelector("[data-day-joke]");
  function drawMoreSum() {
    moreSum.textContent = "· " + plural(state.days, "jour", "jours") + " de charbon";
    dayJoke.textContent = DAY_JOKES[state.days] || "";
  }

  // Titre de l'envoi = nom du fichier (sans extension), "+ 2 autres" s'il
  // y en a plusieurs. Tant qu'on ne l'a pas tapé soi-même, il suit les
  // fichiers ajoutés ou retirés.
  let titleTouched = false;
  titleInput.addEventListener("input", () => { titleTouched = !!titleInput.value.trim(); });
  function autoTitle() {
    if (titleTouched) return;
    const names = state.files.map((f) => f.original_name)
      .concat(getJobs().filter((j) => j.meta.tag === tag && j.state !== "done" && j.state !== "error" && j.state !== "canceled").map((j) => j.name));
    if (!names.length) return;
    const more = names.length - 1;
    titleInput.value = baseName(names[0]) + (more ? " + " + more + (more > 1 ? " autres" : " autre") : "");
  }
  const shipNo = "WT-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  // Bordereau d'expédition : le récapitulatif de l'envoi, en direct, façon
  // ticket de fret. Le CO2 est une pure blague (la même que sur l'accueil).
  function drawWaybill() {
    if (!waybillEl) return;
    const n = state.files.length;
    const bytes = state.files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const to = state.emails.filter((e) => EMAIL_RE.test(e)).length;
    const until = new Date(Date.now() + state.days * 86400e3).toISOString();
    const kg = n ? Math.max(0.4, (bytes / 1073741824) * 38 * Math.max(1, to) + 0.4 * Math.max(1, to)) : 0;
    const rows = [
      ["Colis", n ? plural(n, "fichier", "fichiers") + " · " + formatBytes(bytes) : "vide pour l'instant"],
      ["Destinataires", to ? plural(to, "adresse", "adresses") : "un lien à partager"],
      ["Transport", "jet privé, vol direct"],
      ["Conservation", plural(state.days, "jour", "jours") + ", jusqu'au " + formatDate(until)],
      ["CO₂ estimé", n ? kg.toFixed(1).replace(".", ",") + " kg*" : "en attente du colis"]
    ];
    waybillEl.innerHTML =
      '<div class="wb-head"><span>Bordereau d\'expédition</span><span>N° ' + shipNo + "</span></div>" +
      "<dl>" + rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + esc(v) + "</dd>").join("") + "</dl>" +
      '<p class="wb-foot">' + (n ? "* Estimation totalement fantaisiste. Aucun jet n'a été affrété." : "Ajoute des fichiers pour lancer la chaudière.") + "</p>";
  }

  // Sous "Ton email" : vérifiée ou pas, et pourquoi on la demande.
  function drawReplyHint() {
    const v = replyInput.value.trim().toLowerCase();
    // une seule ligne, et seulement quand elle sert à quelque chose
    if (!emailOn || (v && knownVerified(v))) replyHint.textContent = "";
    else if (state.emails.length) replyHint.textContent = "La première fois, un code arrive à cette adresse pour vérifier que c'est toi.";
    else replyHint.textContent = "";
    replyHint.hidden = !replyHint.textContent;
  }
  replyInput.addEventListener("input", drawReplyHint);

  // Le carnet suit l'email d'expédition : chargé dès qu'une adresse valable
  // est là (le serveur ne l'ouvre qu'à qui l'a prouvée ; sinon, la copie
  // locale de cet appareil).
  async function loadContacts() {
    const sender = replyInput.value.trim().toLowerCase();
    if (!emailOn || !EMAIL_RE.test(sender)) {
      if (state.contactsOf) { state.contacts = []; state.contactsOf = ""; drawRecents(); }
      return;
    }
    if (sender === state.contactsOf) return;
    try {
      const list = await listContacts(sender);
      if (replyInput.value.trim().toLowerCase() !== sender) return;   // adresse changée entre-temps
      state.contacts = list;
      state.contactsOf = sender;
      drawRecents();
      drawReplyHint();
    } catch (err) { /* sans carnet, on tape les adresses à la main */ }
  }
  let contactsTimer = null;
  replyInput.addEventListener("input", () => { clearTimeout(contactsTimer); contactsTimer = setTimeout(loadContacts, 400); });

  // Si la durée par défaut dépasse la vie de l'espace, on prend la plus longue possible.
  if (state.days > maxDays) {
    const best = DURATIONS.filter((d) => d <= maxDays).pop() || 1;
    state.days = best;
    for (const b of root.querySelectorAll("[data-d]")) b.classList.toggle("is-on", Number(b.dataset.d) === best);
  }

  // Vignettes : les images de la sélection sont signées une fois, puis
  // affichées dans leur tuile.
  const thumbRequested = new Set();

  function drawFiles() {
    autoTitle();
    const toSign = state.files
      .filter((f) => categoryOf(f.original_name, f.mime_type) === "image" && canPreview(f.original_name, f.mime_type))
      .map((f) => f.id)
      .filter((id) => !cachedUrl(id) && !thumbRequested.has(id));
    if (toSign.length) {
      toSign.forEach((id) => thumbRequested.add(id));
      signFiles(toSign).then(drawFiles).catch(() => {});
    }

    filesEl.innerHTML = state.files.map((f) => {
      const cat = categoryOf(f.original_name, f.mime_type);
      const thumb = cat === "image" && canPreview(f.original_name, f.mime_type) ? cachedUrl(f.id) : null;
      const bits = [
        !envoiMode && f.project ? f.project.title + " · v" + f.version_no : "",
        cat === "audio" && f.duration_sec ? formatDuration(Number(f.duration_sec)) : "",
        formatBytes(f.size_bytes)
      ].filter(Boolean).join(" · ");
      return '<li data-id="' + f.id + '">' + fileTile(f.original_name, f.mime_type, thumb) +
        '<div class="sf-main"><div class="sf-name">' + esc(f.original_name) + "</div>" +
        '<div class="sf-meta">' + fileBadge(f.original_name, f.mime_type, f.kind) + " " + esc(bits) + "</div></div>" +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-remove aria-label="Retirer">' + icon("x", 18) + "</button>" +
      "</li>";
    }).join("");
    filesEl.hidden = !state.files.length;
    const total = state.files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    totalEl.textContent = state.files.length
      ? plural(state.files.length, "fichier", "fichiers") + " · " + formatBytes(total)
      : "ou glisse-les ici · " + formatBytes(ctx.space.maxFileBytes || 3221225472) + " max";
    addLabel.textContent = state.files.length ? "Ajouter d'autres fichiers" : "Ajoute tes fichiers";
    drawSubmit();
  }

  // Destinataires déjà utilisés : proposés sous le champ, filtrés par la saisie
  function drawRecents() {
    const list = suggest(state.contacts, emailEl.value, state.emails);
    recentsEl.hidden = !list.length;
    if (!list.length) { recentsEl.innerHTML = ""; return; }
    recentsEl.innerHTML =
      '<span class="recents-label">' + (emailEl.value.trim() ? "Ton carnet" : "Récents") + "</span>" +
      list.map((r) =>
        '<span class="recent">' +
          '<button type="button" class="recent-add" data-add="' + esc(r.email) + '">' + icon("plus", 14) + "<span>" + esc(r.email) + "</span></button>" +
          '<button type="button" class="recent-forget" data-forget="' + esc(r.email) + '" aria-label="Oublier ' + esc(r.email) + '">' + icon("x", 12) + "</button>" +
        "</span>").join("");
  }

  function drawChips() {
    chipsEl.innerHTML = state.emails.map((e, i) =>
      '<span class="email-chip' + (EMAIL_RE.test(e) ? "" : " is-bad") + '">' + esc(e) +
      '<button type="button" data-rm="' + i + '" aria-label="Retirer ' + esc(e) + '">' + icon("x", 14) + "</button></span>").join("");
    drawSubmit();
    drawRecents();
  }

  function drawSubmit() {
    if (waiting > 0) return drawPending();
    const n = state.emails.length;
    const label = n && emailOn ? "Envoyer à " + plural(n, "personne", "personnes") : "Créer le lien";
    submitEl.innerHTML = icon(n && emailOn ? "send" : "link", 22) + "<span>" + label + "</span>";
    submitEl.disabled = state.sending || !state.files.length;
    if (replyHint) drawReplyHint();
    if (waybillEl) drawWaybill();
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

  // Découpage sur le TEXTE saisi, pas sur les touches : les claviers
  // Android (Gboard...) signalent chaque touche comme "Unidentified", un
  // test sur e.key === " " n'y verrait jamais passer l'espace. Couvre
  // aussi le collage d'une liste d'adresses.
  emailEl.addEventListener("input", () => {
    const value = emailEl.value;
    if (!/[\s,;]/.test(value)) return drawRecents();
    const parts = value.split(/[\s,;]+/);
    const rest = /[\s,;]$/.test(value) ? "" : parts.pop();
    commitEmails(parts.join(" "));
    emailEl.value = rest;
    drawRecents();
  });
  emailEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (emailEl.value.trim()) { const v = emailEl.value; emailEl.value = ""; commitEmails(v); drawRecents(); }
    } else if (e.key === "Backspace" && !emailEl.value && state.emails.length) {
      state.emails.pop();
      drawChips();
    }
  });
  emailEl.addEventListener("blur", () => {
    if (emailEl.value.trim()) { const v = emailEl.value; emailEl.value = ""; commitEmails(v); drawRecents(); }
  });
  // mousedown/pointerdown sans défaut : le champ garde le focus, sinon son
  // "blur" validerait le début tapé comme une adresse avant le clic
  for (const type of ["mousedown", "pointerdown"]) {
    recentsEl.addEventListener(type, (e) => { if (e.target.closest("button")) e.preventDefault(); });
  }
  recentsEl.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    const forget = e.target.closest("[data-forget]");
    if (add) {
      emailEl.value = "";
      commitEmails(add.dataset.add);
      emailEl.focus();
    } else if (forget) {
      const email = forget.dataset.forget;
      state.contacts = state.contacts.filter((r) => r.email !== email);
      drawRecents();
      forgetContact(state.contactsOf, email).catch((err) => toast(errorText(err), "err"));
      if (!state.contacts.length) drawRecents();
    }
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

  // Nouveaux fichiers : uploadés dans un morceau de l'espace, puis ajoutés
  // automatiquement à l'envoi dès qu'ils sont en ligne.

  // Mode séminaire : on choisit le morceau dans la feuille habituelle.
  const sheetInput = root.querySelector("[data-upload-sheet]");
  if (sheetInput) {
    sheetInput.addEventListener("change", (e) => {
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
  }

  // Mode envoi : pas de question, les sons vont dans un morceau créé en
  // coulisse pour cet envoi.
  async function addDirect(fileList) {
    const files = Array.from(fileList || []);
    const refused = files.map((f) => [f, checkFile(f, ctx.space.maxFileBytes)]).filter(([, err]) => err);
    for (const [f, err] of refused) toast(f.name + " : " + err, "err");
    const ok = files.filter((f) => !checkFile(f, ctx.space.maxFileBytes));
    if (!ok.length) return;
    try {
      if (!draft) {
        const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
        draft = await createProject(ctx.space.id, (titleTouched && titleInput.value.trim()) || baseName(ok[0].name) || "Envoi du " + stamp);
      }
      const jobs = enqueue(ok, {
        spaceId: ctx.space.id, projectId: draft.id, projectTitle: draft.title,
        kind: null, label: null, bpm: null, musicalKey: null, tag
      });
      waiting += jobs.length;
      autoTitle();
      drawPending();
    } catch (err) {
      toast(errorText(err), "err");
    }
  }

  const directInput = root.querySelector("[data-upload]");
  if (directInput) {
    directInput.addEventListener("change", (e) => { addDirect(e.target.files); e.target.value = ""; });
  }

  // Fichiers glissés sur la page
  ctx.setDrop((files) => {
    if (envoiMode) addDirect(files);
    else openUploadSheet(ctx, files, {
      tag,
      newTitle: titleInput.value.trim() || null,
      onQueued: (jobs) => { waiting += jobs.length; drawPending(); }
    });
  });

  // Progression des fichiers de CET envoi, dans la carte "Fichiers"
  // un fichier arrivé rejoint la liste : seuls restent ici ceux en route
  const offJobs = mountUploads(pendingEl, (j) => j.meta.tag === tag && j.state !== "done");

  function drawPending() {
    drawWaybill();
    submitEl.disabled = state.sending || !state.files.length;
    if (waiting > 0) submitEl.innerHTML = '<span class="spinner"></span><span>Chargement de la soute...</span>';
    else drawSubmit();
  }

  const offUploads = onUploads(async (job) => {
    if (!job || job.meta.tag !== tag) return;
    if (job.state === "done" && job.result && !job.counted) {
      job.counted = true;
      waiting--;
      try {
        const [f] = await getFilesByIds([job.result.id]);
        if (f && !state.files.some((x) => x.id === f.id)) {
          // ordre de dépôt, pas ordre d'arrivée (le petit fichier finit avant le gros)
          f.order = job.id;
          state.files.push(f);
          state.files.sort((a, b) => (a.order || 0) - (b.order || 0));
          drawFiles();
        }
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
    drawWaybill();
    drawMoreSum();
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

    // sans titre : celui du morceau, sinon la date (rien à remplir en plus)
    const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
    const title = titleInput.value.trim() || (draft && draft.title) || "Envoi du " + stamp;

    let replyTo = replyInput.value.trim().toLowerCase();
    const byMail = state.emails.length > 0 && emailOn;
    if (replyTo && !EMAIL_RE.test(replyTo)) { replyInput.focus(); return toast("Ton email n'est pas valide", "err"); }
    if (byMail && !replyTo) {
      replyInput.focus();
      return toast("Donne ton email : tes destinataires doivent savoir qui leur écrit", "err");
    }
    try { localStorage.setItem(REPLY_KEY, replyTo); } catch (err) { /* privé */ }
    // les adresses tapées rejoignent le carnet de cet email, tout de suite
    rememberContactsLocal(replyTo, state.emails.filter((e) => EMAIL_RE.test(e)));

    state.sending = true;
    drawSubmit();

    // Rien ne part "de ta part" sans que l'adresse soit vérifiée (une fois
    // par appareil). Pour un simple lien, on peut passer : pas d'avis de
    // téléchargement dans ce cas.
    if (emailOn && replyTo) {
      submitEl.innerHTML = '<span class="spinner"></span><span>Vérification de ton email...</span>';
      const outcome = await ensureVerified(replyTo, { optional: !byMail });
      if (outcome === "cancel") {
        state.sending = false;
        drawSubmit();
        return;
      }
      if (outcome === "skip") replyTo = "";
      drawReplyHint();
      loadContacts();
    }
    submitEl.innerHTML = '<span class="spinner"></span><span>' + (state.emails.length && emailOn ? "Décollage..." : "Impression du billet...") + "</span>";

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
  drawMoreSum();
  loadContacts();

  // Fichiers déposés sur l'accueil : l'upload démarre tout seul ici.
  if (envoiMode) {
    takePending().then((files) => { if (files.length) addDirect(files); });
    const readd = sessionStorage.getItem("seminaire.readd");
    if (readd) {
      sessionStorage.removeItem("seminaire.readd");
      toast(readd === "lourd"
        ? "Tes fichiers étaient trop lourds pour être gardés en route : ajoute-les ici."
        : "Ajoute tes fichiers ici pour les envoyer.", "err");
    }
  }

  return () => { offUploads(); offJobs(); };
}

// ---------------------------------------------------------------- succès

export async function showDone(root, ctx, created, info) {
  const url = transferUrl(created.token);
  let transfer = null;
  try { transfer = await getTransfer(created.id); } catch (err) { /* on affiche quand même le lien */ }
  const recipients = transfer ? transfer.transfer_recipients : [];

  const sent = recipients.filter((r) => r.status === "sent").length;
  // pure blague : un "aller-retour en jet" par tranche de 50 Mo, minimum 1
  const bytes = transfer ? (transfer.transfer_files || []).reduce((s, x) => s + ((x.file && x.file.size_bytes) || 0), 0) : 0;
  const carbon = Math.max(1, Math.round(bytes / (50 * 1024 * 1024)));
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
      '<p class="carbon">' + icon("sparkle", 14) + " Bilan carbone : " + plural(carbon, "aller-retour", "allers-retours") + " Paris-Dubaï en jet privé.</p>" +

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

// réexport : d'autres vues l'importaient d'ici
export { ensureVerified };
