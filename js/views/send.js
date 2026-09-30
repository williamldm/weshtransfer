// Envoi façon WeTransfer, par lien seul : des fichiers, un mot si on veut,
// et un lien à partager (WhatsApp, SMS...) pour écouter et télécharger,
// sans compte. Rien ne part par email. Un lien vit 7 jours au plus ; une
// même connexion (IP) crée un envoi toutes les 10 minutes (serveur :
// migration 20260930000001).

import {
  getProject, getFilesByIds, createTransfer, transferWaitSeconds,
  getTransfer, transferUrl, createProject, signFiles, cachedUrl
} from "../api.js?v=123";
import { openUploadSheet } from "./upload-sheet.js?v=123";
import { mountUploads } from "./uploads.js?v=123";
import { onUploads, enqueue, checkFile, getJobs } from "../upload.js?v=123";
import { categoryOf, canPreview, FILE_MAX } from "../files.js?v=123";
import { takePending } from "../pending.js?v=123";
import { icon } from "../icons.js?v=123";
import {
  esc, formatBytes, formatDuration, plural, toast, errorText, copyText, shareLink,
  canShare, formatDate, daysLeft, fileBadge, fileTile
} from "../ui.js?v=123";

// Dans un espace "envoi", ce composeur EST l'accueil.
export const title = (ctx) => (ctx && ctx.space.mode === "envoi" ? ctx.space.name : "Envoyer");

// 0 = "jusqu'au premier téléchargement" : chaque fichier est détruit dès
// qu'il a été téléchargé en entier, et au plus tard au bout de 7 jours.
// Choix par défaut dès qu'il y a une archive (sessions FL Studio zippées).
const DURATIONS = [0, 1, 3, 7];
const dayLabel = (d) => (d === 0 ? "1er téléchargement" : plural(d, "jour", "jours"));

// Ce que coûte chaque durée à la planète (selon nos calculs, faux).
const DAY_JOKES = {
  0: "Ton fichier dort au chaud jusqu'au premier téléchargement complet (7 jours au plus), puis on le pulvérise.",
  1: "24 h : la centrale tourne à peine, on a presque honte.",
  3: "3 jours : un plein de jet privé, sans le champagne.",
  7: "7 jours : une semaine de serveurs au charbon. C'est le maximum."
};

// Le nom d'un fichier sans son extension : "Nuit blanche - mix v3"
const baseName = (name) => String(name || "").replace(/\.[a-z0-9]{1,10}$/i, "").trim() || String(name || "");

// "dans 7 min" : attente avant le prochain envoi (une IP, un envoi par 10 min)
const waitLabel = (s) => (s >= 60 ? Math.ceil(s / 60) + " min" : s + " s");

export async function mount(root, ctx, params) {
  const state = {
    files: [],          // [{ id, original_name, size_bytes, kind, version_no, label, project }]
    title: "",
    days: 7,
    daysTouched: false, // choisi à la main : on ne le change plus tout seul
    sending: false,
    wait: 0             // secondes avant de pouvoir créer un envoi (même IP)
  };
  const tag = "send-" + Date.now();
  const envoiMode = ctx.space.mode === "envoi";
  let draft = null;   // morceau créé en coulisse pour les fichiers de cet envoi
  let waiting = 0;    // fichiers de cet envoi encore en cours d'upload
  const maxDays = Math.min(7, ctx.space.purgeAt ? daysLeft(ctx.space.purgeAt) : 7);

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

  // ------------------------------------------------------ rendu
  // Façon WeTransfer : les fichiers, un mot, un bouton. Le reste (titre,
  // durée) est replié dans "Options".
  root.innerHTML =
    '<form class="send-card sx" novalidate data-form>' +
      '<h1 class="sx-title">' + (envoiMode ? "Nouvel envoi" : "Envoyer des fichiers") + "</h1>" +

      '<div class="sx-files">' +
        '<ul class="send-files" data-files></ul>' +
        '<div class="send-pending" data-pending hidden></div>' +
        '<label class="sx-add" data-dropzone>' +
          '<span class="sx-add-ic">' + icon("plus", 20) + "</span>" +
          '<span class="sx-add-txt"><strong data-add-label>Ajoute tes fichiers</strong><small data-total>ou glisse-les ici · ' +
            formatBytes(Math.min(ctx.space.maxFileBytes || FILE_MAX, FILE_MAX)) + " max</small></span>" +
          (envoiMode ? '<input type="file" multiple hidden data-upload>' : '<input type="file" multiple hidden data-upload-sheet>') +
        "</label>" +
      "</div>" +

      '<textarea class="input sx-msg" name="message" rows="2" maxlength="2000" placeholder="Un message ? (facultatif)" aria-label="Message"></textarea>' +

      '<details class="sx-more">' +
        '<summary>Options <span class="muted" data-more-sum></span></summary>' +
        '<label class="field"><span class="label">Titre</span>' +
          '<input class="input" name="title" maxlength="80" placeholder="Ex : Nuit blanche, mix du jour 2" value="' + esc(state.title) + '"></label>' +
        '<div class="field"><span class="label">Disponible pendant</span><div class="chips" data-days>' +
          DURATIONS.map((d) => '<button type="button" class="chip' + (d === state.days ? " is-on" : "") + '" data-d="' + d + '"' +
            (d > maxDays ? " disabled" : "") + ">" + dayLabel(d) + "</button>").join("") +
        '</div><span class="hint sx-joke" data-day-joke></span></div>' +
      "</details>" +

      '<button class="btn btn-primary btn-block btn-xl" type="submit" data-submit></button>' +
      '<p class="hint center" data-wait>' + icon("link", 14) + " Tu obtiens un lien à partager, valable 7 jours au plus.</p>" +
    "</form>" +
    (envoiMode
      ? '<a class="link-row sx-history" href="#/transfers">' + icon("mail", 18) + "<span>Mes envois</span>" + icon("chevron", 18) + "</a>"
      : "");

  const form = root.querySelector("[data-form]");
  const titleInput = form.querySelector("[name=title]");
  const messageInput = form.querySelector("[name=message]");
  const filesEl = root.querySelector("[data-files]");
  const totalEl = root.querySelector("[data-total]");
  const submitEl = root.querySelector("[data-submit]");
  const pendingEl = root.querySelector("[data-pending]");
  const waitEl = root.querySelector("[data-wait]");
  const moreSum = root.querySelector("[data-more-sum]");
  const addLabel = root.querySelector("[data-add-label]");
  const dayJoke = root.querySelector("[data-day-joke]");
  function drawMoreSum() {
    moreSum.textContent = state.days === 0 ? "· jusqu'au 1er téléchargement" : "· " + plural(state.days, "jour", "jours") + " de charbon";
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
  // une archive dans l'envoi : "jusqu'au premier téléchargement" par défaut
  function autoDays() {
    if (state.daysTouched) return;
    const names = state.files.map((f) => f.original_name)
      .concat(getJobs().filter((j) => j.meta.tag === tag && j.state !== "error" && j.state !== "canceled").map((j) => j.name));
    const want = names.some((n) => categoryOf(n) === "archive") ? 0 : (DURATIONS.filter((d) => d > 0 && d <= maxDays).pop() || 1);
    if (want === state.days) return;
    state.days = want;
    for (const b of root.querySelectorAll("[data-d]")) b.classList.toggle("is-on", Number(b.dataset.d) === want);
    if (moreSum) drawMoreSum();
  }

  // Si la durée par défaut dépasse la vie de l'espace, on prend la plus longue possible.
  if (state.days > maxDays) {
    const best = DURATIONS.filter((d) => d > 0 && d <= maxDays).pop() || 1;
    state.days = best;
    for (const b of root.querySelectorAll("[data-d]")) b.classList.toggle("is-on", Number(b.dataset.d) === best);
  }

  // Vignettes : les images de la sélection sont signées une fois, puis
  // affichées dans leur tuile.
  const thumbRequested = new Set();

  function drawFiles() {
    autoTitle();
    // vignette = l'image entière téléchargée depuis B2 : pas pour les grosses
    const thumbable = (f) => categoryOf(f.original_name, f.mime_type) === "image" && canPreview(f.original_name, f.mime_type) &&
      (f.size_bytes || 0) <= 3 * 1024 * 1024;
    const toSign = state.files
      .filter(thumbable)
      .map((f) => f.id)
      .filter((id) => !cachedUrl(id) && !thumbRequested.has(id));
    if (toSign.length) {
      toSign.forEach((id) => thumbRequested.add(id));
      signFiles(toSign).then(drawFiles).catch(() => {});
    }

    filesEl.innerHTML = state.files.map((f) => {
      const cat = categoryOf(f.original_name, f.mime_type);
      const thumb = thumbable(f) ? cachedUrl(f.id) : null;
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
      : "ou glisse-les ici · " + formatBytes(Math.min(ctx.space.maxFileBytes || FILE_MAX, FILE_MAX)) + " max";
    addLabel.textContent = state.files.length ? "Ajouter d'autres fichiers" : "Ajoute tes fichiers";
    drawSubmit();
  }

  function drawSubmit() {
    if (waiting > 0) return drawPending();
    autoDays();
    submitEl.innerHTML = icon("link", 22) + "<span>" + (state.wait > 0 ? "Prochain lien dans " + waitLabel(state.wait) : "Créer le lien") + "</span>";
    submitEl.disabled = state.sending || !state.files.length || state.wait > 0;
  }

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
    autoDays();
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
    state.daysTouched = true;
    drawMoreSum();
    for (const x of root.querySelectorAll("[data-d]")) x.classList.toggle("is-on", x === b);
  });

  // ------------------------------------------------------- envoi
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.files.length) return toast("Ajoute au moins un fichier", "err");
    if (waiting > 0) return toast("Attends la fin des uploads en cours", "err");
    if (state.wait > 0) return toast("Un envoi toutes les 10 minutes : prochain lien dans " + waitLabel(state.wait), "err");

    // sans titre : celui du morceau, sinon la date (rien à remplir en plus)
    const stamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date());
    const title = titleInput.value.trim() || (draft && draft.title) || "Envoi du " + stamp;

    state.sending = true;
    drawSubmit();
    submitEl.innerHTML = '<span class="spinner"></span><span>Impression du billet...</span>';

    try {
      const created = await createTransfer({
        spaceId: ctx.space.id,
        title,
        fileIds: state.files.map((f) => f.id),
        message: messageInput.value,
        days: state.days || 7,
        untilDownload: state.days === 0
      });
      stopWait();
      showDone(root, ctx, created, { title });
    } catch (err) {
      state.sending = false;
      // quelqu'un d'autre sur la même connexion vient d'envoyer : on attend
      if (/UN_ENVOI_PAR_DIX_MINUTES/.test(String(err && err.message))) checkWait();
      drawSubmit();
      toast(errorText(err), "err");
    }
  });

  // Une connexion (IP), un envoi par 10 minutes : on le dit AVANT l'upload
  // et le bouton attend tout seul. Le serveur fait foi (create_transfer).
  let waitTimer = null;
  function stopWait() { if (waitTimer) { clearInterval(waitTimer); waitTimer = null; } }
  function drawWait() {
    waitEl.innerHTML = state.wait > 0
      ? icon("clock", 14) + " Un envoi toutes les 10 minutes par connexion : ton prochain lien dans " + esc(waitLabel(state.wait)) + ". Tes fichiers peuvent déjà charger."
      : icon("link", 14) + " Tu obtiens un lien à partager, valable 7 jours au plus.";
  }
  async function checkWait() {
    state.wait = await transferWaitSeconds();
    drawWait();
    drawSubmit();
    stopWait();
    if (state.wait <= 0) return;
    const end = Date.now() + state.wait * 1000;
    waitTimer = setInterval(() => {
      state.wait = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      drawWait();
      if (!state.sending && waiting <= 0) drawSubmit();
      if (!state.wait) stopWait();
    }, 1000);
  }
  checkWait();

  drawFiles();
  drawMoreSum();

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

  return () => { offUploads(); offJobs(); stopWait(); };
}

// ---------------------------------------------------------------- succès

export async function showDone(root, ctx, created, info) {
  const url = transferUrl(created.token);
  let transfer = null;
  try { transfer = await getTransfer(created.id); } catch (err) { /* on affiche quand même le lien */ }
  // pure blague : un "aller-retour en jet" par tranche de 50 Mo, minimum 1
  const bytes = transfer ? (transfer.transfer_files || []).reduce((s, x) => s + ((x.file && x.file.size_bytes) || 0), 0) : 0;
  const carbon = Math.max(1, Math.round(bytes / (50 * 1024 * 1024)));
  const sub = "Partage-le où tu veux. " + (created.until_download
    ? "Il s'autodétruit au premier téléchargement complet (et au plus tard le " + formatDate(created.expires_at) + ")."
    : "Il expire le " + formatDate(created.expires_at) + ".");

  root.innerHTML =
    '<div class="done">' +
      '<div class="done-icon">' + icon("check", 40) + "</div>" +
      "<h1>Ton lien est prêt</h1>" +
      '<p class="muted">' + esc(sub) + "</p>" +
      '<p class="carbon">' + icon("sparkle", 14) + " Bilan carbone : " + plural(carbon, "aller-retour", "allers-retours") + " Paris-Dubaï en jet privé.</p>" +

      '<div class="link-box">' +
        '<input class="input mono" readonly value="' + esc(url) + '" data-url>' +
        '<div class="row-2">' +
          '<button class="btn btn-block" data-copy>' + icon("copy", 18) + "<span>Copier</span></button>" +
          (canShare() ? '<button class="btn btn-primary btn-block" data-share>' + icon("share", 18) + "<span>Partager</span></button>" : "") +
        "</div>" +
      "</div>" +

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
