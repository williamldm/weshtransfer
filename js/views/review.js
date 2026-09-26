// Retours de mix : la boucle entre l'artiste (le client) et l'ingé son.
//
//   l'artiste écrit un retour, accroché à la seconde près
//   -> l'ingé le corrige dans la vN (avec une note : "voix remontée de 2 dB")
//   -> l'artiste confirme "c'est bon", ou rouvre en disant ce qui cloche
//   -> l'artiste valide le mix
//
// Une seule liste pour tout le morceau (toutes les versions jusqu'à celle
// affichée) : un tap sur un horodatage rejoue LA version affichée à cet
// endroit, pour vérifier la correction.
//
// Rôles (vérifiés aussi par le serveur) : ingé = host de l'espace, ou
// quiconque a déposé une version du morceau ; artiste = les autres.

import {
  listCommentsOf, addComment, deleteComment, setCommentResolved, setCommentVerified,
  setFileApproved, updateFile, reviewFlush
} from "../api.js?v=94";
import { formatTime } from "../waveform.js?v=94";
import { icon } from "../icons.js?v=94";
import { esc, h, timeAgo, toast, errorText, plural, confirmSheet, openSheet, copyText, triggerDownload, formatBytes } from "../ui.js?v=94";
import { enqueue, onUploads, checkFile } from "../upload.js?v=94";

export const TAGS = [
  ["voix", "Voix"], ["instru", "Instru"], ["basse", "Basse"], ["batterie", "Batterie"],
  ["effets", "Effets"], ["niveau", "Volume"], ["structure", "Structure"], ["autre", "Autre"]
];
const TAG_LABEL = Object.fromEntries(TAGS);

// Points rapides : les problèmes qu'on entend le plus, posés d'un tap à la
// seconde où on est (comme un commentaire SoundCloud, en plus direct).
const QUICK = [
  ["Voix trop basse", "voix"], ["Voix trop forte", "voix"], ["Plus de basse", "basse"], ["Moins de basse", "basse"],
  ["Kick trop faible", "batterie"], ["Trop de réverb", "effets"], ["Aigus qui piquent", "instru"],
  ["Clic / craquement", "autre"], ["Trop compressé", "niveau"], ["Ça sature", "niveau"]
];

const STATES = {
  open: { label: "À corriger", cls: "is-open", color: "#E2B55A" },
  verify: { label: "Corrigé, à vérifier", cls: "is-verify", color: "#A48BFF" },
  done: { label: "Réglé", cls: "is-done", color: "#6FCF8E" }
};

export const stateOf = (c) => (!c.resolved_at ? "open" : !c.verified_at ? "verify" : "done");

export function isEngineerOf(space, versions) {
  return !!space.isHost || versions.some((v) => v.uploaded_by === space.participantId);
}

const byTime = (a, b) => {
  if (a.at_ms == null && b.at_ms == null) return a.created_at < b.created_at ? -1 : 1;
  if (a.at_ms == null) return 1;
  if (b.at_ms == null) return -1;
  return a.at_ms - b.at_ms;
};

// Feuille avec une zone de texte. null = annulé, "" = validé sans texte.
function textSheet(title, o) {
  return new Promise((resolve) => {
    let answered = false;
    const body = h(
      "<form>" +
        (o.intro ? '<p class="muted sheet-intro">' + o.intro + "</p>" : "") +
        '<textarea class="input" rows="3" maxlength="' + (o.max || 500) + '" placeholder="' + esc(o.placeholder || "") + '"></textarea>' +
        '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + esc(o.ok || "Valider") + "</button></div>" +
      "</form>"
    );
    const sheet = openSheet({ title, body, onClose: () => { if (!answered) resolve(null); } });
    const ta = body.querySelector("textarea");
    setTimeout(() => ta.focus(), 80);
    body.addEventListener("submit", (e) => {
      e.preventDefault();
      answered = true;
      resolve(ta.value.trim());
      sheet.close();
    });
  });
}

// ------------------------------------------------------------ rendu

export function renderReviewShell(engineer) {
  return (
    '<section class="rv" data-review>' +
      '<div data-rv-news></div>' +
      '<div data-rv-approve></div>' +

      '<form class="comment-form rv-compose" data-rv-form>' +
        '<div class="rv-compose-head">' +
          "<strong>" + (engineer ? "Ajouter une note" : "Ton retour") + "</strong>" +
          '<button type="button" class="chip chip-time is-on" data-rv-time>' + icon("clock", 14) + " <span>à 0:00</span></button>" +
        "</div>" +
        '<textarea class="input" name="body" rows="2" maxlength="1000" placeholder="' +
          (engineer
            ? "Ex : penser à refaire la reverb du refrain"
            : "Dis ce que tu entends, avec tes mots : la voix est trop loin, plus de basse ici...") + '"></textarea>' +
        '<div class="chips rv-tags" data-rv-tags>' +
          TAGS.map(([k, label]) => '<button type="button" class="chip" data-tag="' + k + '">' + label + "</button>").join("") +
        "</div>" +
        '<div class="row"><span class="hint">' +
          '</span><span class="spacer"></span><button class="btn btn-primary btn-sm" type="submit">Publier</button></div>' +
      "</form>" +
      (engineer ? "" : '<button type="button" class="btn btn-block rv-flush" data-rv-flush hidden>' + icon("send", 18) + "<span>J'ai fini mes retours : prévenir l'ingé</span></button>") +

      '<div class="section-head rv-head"><h2>Retours</h2>' +
        (engineer
          ? '<div class="rv-tools">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-rv-copy>' + icon("copy", 15) + " Copier la liste</button>" +
              '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-rv-txt aria-label="Télécharger la liste">' + icon("download", 15) + "</button>" +
            "</div>"
          : "") +
      "</div>" +
      '<div class="rv-progress" data-rv-progress></div>' +
      '<div class="chips rv-filters" data-rv-filters>' +
        ["open", "verify", "done"].map((k) =>
          '<button type="button" class="chip" data-filter="' + k + '">' + STATES[k].label + ' <span class="count" data-n="' + k + '">0</span></button>').join("") +
      "</div>" +
      '<ul class="comment-list rv-list" data-rv-list></ul>' +
    "</section>"
  );
}

function renderItem(c, replies, ctx, file, versionOf, engineer, num, active) {
  const me = ctx.space.participantId;
  const st = stateOf(c);
  const mine = c.author_id === me;
  const vcur = "v" + file.version_no;
  const fixedIn = c.resolved_in ? versionOf.get(c.resolved_in) : null;

  let actions = "";
  if (engineer && st === "open") {
    actions += '<button class="btn btn-sm btn-primary" data-resolve>' + icon("check", 15) + " Corrigé dans la " + vcur + "</button>";
  }
  if (engineer && !mine && st === "verify") actions += '<button class="btn btn-sm btn-ghost" data-unresolve>Annuler la correction</button>';
  if ((!engineer || mine) && st === "verify") {
    actions += '<button class="btn btn-sm btn-primary" data-ok>' + icon("check", 15) + " C'est bon</button>" +
      '<button class="btn btn-sm" data-reopen>Pas encore</button>';
  }
  if (!engineer && st === "done") actions += '<button class="btn btn-sm btn-ghost" data-reopen>Rouvrir</button>';
  actions += '<button class="btn btn-sm btn-ghost" data-reply>' + icon("comment", 14) + " Répondre</button>";

  return '<li class="comment rv-item ' + STATES[st].cls + (active ? " is-now" : "") + '" data-id="' + c.id + '">' +
    (num ? '<button type="button" class="rv-num" data-at="' + c.at_ms + '" style="--c:' + STATES[st].color + '" aria-label="Retour ' + num + ', écouter">' + num + "</button>"
      : '<span class="rv-num is-none" style="--c:' + STATES[st].color + '"></span>') +
    '<div class="c-body">' +
      '<div class="c-head">' +
        '<span class="rv-state">' + STATES[st].label + "</span>" +
        (c.file_id !== file.id ? '<span class="vtag">' + esc(versionOf.get(c.file_id) || "") + "</span>" : "") +
        (c.at_ms != null ? '<button class="ts" data-at="' + c.at_ms + '" title="Écouter la ' + vcur + ' à cet endroit">' + formatTime(c.at_ms / 1000) + "</button>" : "") +
        (c.tag ? '<span class="rv-tag">' + esc(TAG_LABEL[c.tag] || c.tag) + "</span>" : "") +
      "</div>" +
      '<p class="c-text">' + esc(c.body) + "</p>" +
      '<p class="c-by muted">' + esc(c.author ? c.author.pseudo : "?") + " · " + timeAgo(c.created_at) + "</p>" +
      (c.resolved_at
        ? '<div class="rv-fix">' + icon("check", 13) + "<div><strong>Corrigé" + (fixedIn ? " dans la " + esc(fixedIn) : "") + "</strong>" +
            (c.resolved_by ? " par " + esc(c.resolved_by) : "") + " · " + timeAgo(c.resolved_at) +
            (c.resolution_note ? '<p class="rv-note">' + esc(c.resolution_note) + "</p>" : "") +
            (c.verified_at ? '<p class="rv-ok">' + icon("check", 12) + " Validé par " + esc(c.verified_by || "l'artiste") + " · " + timeAgo(c.verified_at) + "</p>" : "") +
          "</div></div>"
        : "") +
      (replies.length
        ? '<ul class="rv-replies">' + replies.map((r) =>
            '<li data-id="' + r.id + '"><strong>' + esc(r.author ? r.author.pseudo : "?") + "</strong> " + esc(r.body) +
            ' <span class="muted">' + timeAgo(r.created_at) + "</span>" +
            (r.author_id === me || ctx.space.isHost ? ' <button class="rv-del-reply" data-del aria-label="Supprimer">' + icon("x", 12) + "</button>" : "") +
            "</li>").join("") + "</ul>"
        : "") +
      '<div class="rv-actions">' + actions + "</div>" +
      '<form class="rv-reply" data-reply-form hidden><input class="input" maxlength="1000" placeholder="Ta réponse"><button class="btn btn-sm btn-primary" type="submit">Envoyer</button></form>' +
    "</div>" +
    (mine || ctx.space.isHost ? '<button class="btn btn-ghost btn-icon btn-sm" data-del aria-label="Supprimer">' + icon("trash", 16) + "</button>" : "") +
  "</li>";
}

// ------------------------------------------------------------ logique
// o : { el, ctx, currentMs(), playAt(sec), setMarkers(list), durationMs() }

export function createReview(o) {
  const { el, ctx } = o;
  let file = null;
  let versions = [];
  let engineer = false;
  let all = [];          // retours et réponses, toutes versions jusqu'à celle affichée
  let filter = null;     // choisi au premier chargement selon le rôle
  let activeId = null;   // retour mis en avant (lecture en cours, pastille touchée)
  let numbers = new Map();
  let tag = null;
  let useTime = true;

  const q = (sel) => el.querySelector(sel);

  function setFile(f) {
    file = f;
    versions = ((f.project && f.project.files) || [])
      .filter((v) => v.status === "ready")
      .sort((a, b) => a.version_no - b.version_no);
    engineer = isEngineerOf(ctx.space, versions.length ? versions : [f]);
    el.innerHTML = renderReviewShell(engineer);
    drawQuick();
    bind();
    if (engineer && ctx.setDrop) ctx.setDrop((files) => openUpdate(files));
  }

  async function reload() {
    const ids = versions.filter((v) => v.version_no <= file.version_no).map((v) => v.id);
    if (!ids.includes(file.id)) ids.push(file.id);
    all = await listCommentsOf(ids);
    draw();
  }

  const top = () => all.filter((c) => !c.parent_id);

  function draw() {
    const versionOf = new Map(versions.map((v) => [v.id, "v" + v.version_no]));
    const items = top();
    const counts = { open: 0, verify: 0, done: 0 };
    for (const c of items) counts[stateOf(c)]++;
    const fixedHere = items.filter((c) => c.resolved_in === file.id && stateOf(c) === "verify");

    if (!filter) filter = !engineer && counts.verify ? "verify" : counts.open || !counts.done ? "open" : "done";

    drawNews(counts, fixedHere);
    drawApprove(counts);

    for (const k of Object.keys(counts)) q('[data-n="' + k + '"]').textContent = counts[k];
    for (const b of el.querySelectorAll("[data-filter]")) b.classList.toggle("is-on", b.dataset.filter === filter);

    const replies = new Map();
    for (const r of all.filter((c) => c.parent_id)) {
      if (!replies.has(r.parent_id)) replies.set(r.parent_id, []);
      replies.get(r.parent_id).push(r);
    }
    // numéros dans l'ordre du morceau, les mêmes sur la forme d'onde et
    // dans la liste, quel que soit le filtre
    numbers = new Map(items.filter((c) => c.at_ms != null).sort(byTime).map((c, i) => [c.id, i + 1]));

    const shown = items.filter((c) => stateOf(c) === filter).sort(byTime);
    q("[data-rv-list]").innerHTML = shown.length
      ? shown.map((c) => renderItem(c, (replies.get(c.id) || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
          ctx, file, versionOf, engineer, numbers.get(c.id), c.id === activeId)).join("")
      : '<li class="comment-empty">' + emptyText(counts) + "</li>";

    drawProgress(counts);
    const flush = q("[data-rv-flush]");
    if (flush) flush.hidden = !items.some((c) => c.author_id === ctx.space.participantId);
    drawMarkers();
    drawRail();
  }

  // Sur la forme d'onde : une pastille numérotée par retour, couleur de
  // son état ; les réglés restent, en retrait.
  function drawMarkers() {
    o.setMarkers(top().filter((c) => c.at_ms != null).map((c) => ({
      id: c.id, atMs: c.at_ms, color: STATES[stateOf(c)].color,
      dim: stateOf(c) === "done", active: c.id === activeId
    })));
  }

  // Le rail sous la forme d'onde : une pastille par retour, l'initiale de
  // son auteur dans la couleur de son état ; au survol (ou quand la lecture
  // y passe) la bulle du commentaire s'ouvre, comme sur SoundCloud.
  function drawRail() {
    const rail = o.rail;
    if (!rail) return;
    const dur = o.durationMs ? o.durationMs() : 0;
    const items = top().filter((c) => c.at_ms != null).sort(byTime);
    if (!dur || !items.length) { rail.innerHTML = ""; rail.classList.toggle("is-empty", true); return; }
    rail.classList.remove("is-empty");
    rail.innerHTML = items.map((c) => {
      const st = stateOf(c);
      const pos = Math.min(100, Math.max(0, (c.at_ms / dur) * 100));
      const who = c.author ? c.author.pseudo : "?";
      const side = pos < 18 ? " is-left" : pos > 82 ? " is-right" : "";
      return '<button type="button" class="rv-dot is-' + st + side + (c.id === activeId ? " is-now" : "") + '" data-dot="' + c.id + '" data-at="' + c.at_ms + '"' +
        ' style="left:' + pos.toFixed(2) + "%;--c:" + STATES[st].color + '" aria-label="' + esc(who) + " à " + formatTime(c.at_ms / 1000) + " : " + esc(c.body) + '">' +
        '<span class="rv-dot-av">' + esc(who.charAt(0).toUpperCase()) + "</span>" +
        '<span class="rv-bubble"><span class="rv-bubble-head"><b>' + esc(who) + '</b><span class="mono">' + formatTime(c.at_ms / 1000) + "</span></span>" +
          esc(c.body) + "</span>" +
      "</button>";
    }).join("");
  }

  // Les points rapides, sous le lecteur
  function drawQuick() {
    const box = o.quick;
    if (!box) return;
    box.innerHTML =
      '<div class="rv-quick-head">' + icon("plus", 14) + "<span>" + (engineer ? "Note rapide" : "Point rapide") +
        ' à <b class="mono" data-quick-at>' + formatTime(o.currentMs() / 1000) + '</b></span><span class="rv-quick-hint">un tap, c\'est noté</span></div>' +
      '<div class="rv-quick-chips">' +
        QUICK.map(([label], i) => '<button type="button" class="chip" data-quick="' + i + '">' + esc(label) + "</button>").join("") +
        '<button type="button" class="chip chip-more" data-quick-more>' + icon("edit", 13) + " Autre…</button>" +
      "</div>";
  }

  // Barre d'avancement : réglés / à vérifier / à corriger
  function drawProgress(counts) {
    const box = q("[data-rv-progress]");
    const total = counts.open + counts.verify + counts.done;
    if (!total) { box.innerHTML = ""; return; }
    const seg = (k) => counts[k] ? '<i style="flex:' + counts[k] + ";background:" + STATES[k].color + '"></i>' : "";
    box.innerHTML =
      '<div class="rv-bar">' + seg("done") + seg("verify") + seg("open") + "</div>" +
      '<p class="rv-bar-text"><strong>' + (counts.done ? counts.done + " sur " + total + "</strong> " + (counts.done > 1 ? "réglés" : "réglé")
        : "Aucun réglé</strong> sur " + total) +
        (counts.verify ? " · " + counts.verify + " à vérifier" : "") + (counts.open ? " · " + counts.open + " à corriger" : "") + "</p>";
  }

  // Met un retour en avant : dans la liste (et le filtre qui le contient)
  // et sur la forme d'onde. scroll : l'amener à l'écran.
  function highlight(id, scroll) {
    if (id === activeId && !scroll) return;
    activeId = id;
    const c = id && top().find((x) => x.id === id);
    if (c && scroll && stateOf(c) !== filter) { filter = stateOf(c); draw(); }
    for (const li of el.querySelectorAll(".rv-item")) li.classList.toggle("is-now", li.dataset.id === id);
    if (o.rail) for (const d of o.rail.querySelectorAll("[data-dot]")) d.classList.toggle("is-now", d.dataset.dot === id);
    drawMarkers();
    if (c && scroll) {
      const li = el.querySelector('.rv-item[data-id="' + id + '"]');
      if (li) li.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // Pendant la lecture : le retour qu'on est en train d'entendre s'allume
  // (de 0,3 s avant son horodatage à 4 s après).
  function onPlayback(ms) {
    let now = null;
    for (const c of top()) {
      if (c.at_ms == null || stateOf(c) === "done") continue;
      if (ms >= c.at_ms - 300 && ms <= c.at_ms + 4000 && (!now || c.at_ms > now.at_ms)) now = c;
    }
    const id = now ? now.id : null;
    if (id !== activeId) highlight(id, false);
  }

  function emptyText(counts) {
    if (!top().length) {
      return engineer
        ? "Pas encore de retour de l'artiste."
        : "Pas encore de retour.";
    }
    if (filter === "open") return counts.verify ? "Rien à corriger. Des corrections attendent d'être vérifiées." : "Rien à corriger.";
    if (filter === "verify") return engineer ? "Aucune correction en attente de l'artiste." : "Aucune correction à vérifier.";
    return "Rien de réglé pour l'instant.";
  }

  // "Nouveau dans la vN" pour l'artiste ; note de version pour l'ingé
  function drawNews(counts, fixedHere) {
    const box = q("[data-rv-news]");
    const v = "v" + file.version_no;
    if (engineer) {
      // Un seul bouton : la note de version s'écrit au moment de l'envoi.
      const todo = counts && counts.open;
      box.innerHTML =
        '<div class="rv-inge">' +
          '<label class="btn btn-block rv-update' + (todo ? " btn-primary" : "") + '">' + icon("upload", 18) +
            "<span>Envoyer la v" + nextVersion() + (todo ? " corrigée" : "") + "</span>" +
            '<input type="file" hidden data-rv-update></label>' +
          (file.changelog ? '<p class="rv-changelog-text">' + esc(file.changelog) + "</p>" : "") +
        "</div>";
      box.querySelector("[data-rv-update]").onchange = (e) => {
        openUpdate(e.target.files);
        e.target.value = "";
      };
      return;
    }
    const latest = versions.length && versions[versions.length - 1].id === file.id;
    if (!file.changelog && !fixedHere.length) {
      box.innerHTML = !top().length && latest
        ? '<p class="review-hint">' + icon("comment", 18) + "<span>Là où quelque chose te gêne, écris-le : le retour s'accroche à la seconde près.</span></p>"
        : "";
      return;
    }
    box.innerHTML =
      '<div class="rv-card rv-news">' +
        '<div class="rv-card-head"><span class="eyebrow">Nouveau dans la ' + v + "</span>" +
          (file.uploader ? '<span class="muted">par ' + esc(file.uploader.pseudo) + "</span>" : "") + "</div>" +
        (file.changelog ? '<p class="rv-changelog-text">' + esc(file.changelog) + "</p>" : "") +
        (fixedHere.length
          ? '<button type="button" class="btn btn-primary btn-block" data-goto-verify>' + icon("check", 18) +
              "<span>" + plural(fixedHere.length, "correction à vérifier", "corrections à vérifier") + "</span></button>" +
            '<p class="hint">Touche l\'horodatage de chaque retour : la ' + v + " se lance à cet endroit.</p>"
          : "") +
      "</div>";
    const go = box.querySelector("[data-goto-verify]");
    if (go) go.onclick = () => { filter = "verify"; draw(); q("[data-rv-filters]").scrollIntoView({ behavior: "smooth", block: "start" }); };
  }

  function drawApprove(counts) {
    const box = q("[data-rv-approve]");
    const mineFile = file.uploaded_by === ctx.space.participantId;
    const v = "v" + file.version_no;
    if (file.approved_at) {
      // validée par l'artiste, ou notée par l'ingé (l'artiste l'a dit ailleurs)
      const behalf = !!file.approved_on_behalf;
      box.innerHTML = '<div class="approve is-on"><div class="approve-text">' + icon("check", 18) +
        "<span><strong>" + v + " validée</strong>" +
        (behalf ? " · notée par " + esc(file.approved_by || "l'ingé") : file.approved_by ? " par " + esc(file.approved_by) : "") +
        " · " + timeAgo(file.approved_at) + "</span></div>" +
        (!mineFile || behalf ? '<button class="btn btn-ghost btn-sm" data-approve>Annuler</button>' : "") + "</div>";
    } else if (mineFile) {
      // l'ingé : en attente de l'artiste, ou noter une validation déjà donnée
      box.innerHTML = '<div class="approve"><div class="approve-text muted">' + icon("clock", 18) +
        "<span>En attente de validation par l'artiste" + (counts.open || counts.verify ? " (" + plural(counts.open + counts.verify, "retour en cours", "retours en cours") + ")" : "") + ".</span></div>" +
        '<button class="btn btn-sm" data-approve data-behalf>' + icon("check", 15) + "<span>Déjà validée</span></button></div>";
    } else {
      box.innerHTML = '<div class="approve">' +
        '<button class="btn btn-primary btn-block" data-approve>' + icon("check", 18) + "<span>Valider la " + v + " : c'est bon pour moi</span></button></div>";
    }
    const b = box.querySelector("[data-approve]");
    if (b) {
      b.onclick = async () => {
        const approving = !file.approved_at;
        const pending = counts.open + counts.verify;
        if (approving && b.hasAttribute("data-behalf")) {
          const ok = await confirmSheet("L'artiste t'a déjà dit que la " + v + " était bonne (au téléphone, en studio...) ? Elle passe en validée, avec la mention \"notée par " + ctx.space.pseudo + "\". L'artiste peut toujours revenir dessus." +
            (pending ? " " + plural(pending, "retour n'est pas encore réglé.", "retours ne sont pas encore réglés.") : ""),
            { ok: "Marquer validée", title: "Valider la " + v });
          if (!ok) return;
        } else if (approving && pending) {
          const ok = await confirmSheet(
            plural(pending, "retour n'est pas encore réglé", "retours ne sont pas encore réglés") + ". Valider la " + v + " quand même ?",
            { ok: "Valider quand même", title: "Valider la " + v });
          if (!ok) return;
        }
        b.disabled = true;
        try {
          await setFileApproved(file.id, approving);
          file.approved_at = approving ? new Date().toISOString() : null;
          file.approved_by = approving ? ctx.space.pseudo : null;
          file.approved_on_behalf = approving && mineFile;
          if (approving) toast(mineFile ? "Noté : la " + v + " est validée." : "Mix validé. L'ingé le voit tout de suite.", "ok");
          draw();
        } catch (err) { toast(errorText(err), "err"); b.disabled = false; }
      };
    }
  }

  // ------------------------------------------------------------ actions

  function syncTime(ms) {
    const at = o.quick && o.quick.querySelector("[data-quick-at]");
    if (at) at.textContent = formatTime((ms != null ? ms : o.currentMs()) / 1000);
    const chip = q("[data-rv-time]");
    if (!chip) return;
    chip.querySelector("span").textContent = "à " + formatTime((ms != null ? ms : o.currentMs()) / 1000);
    chip.classList.toggle("is-on", useTime);
  }

  function focusComposer() {
    const ta = q("[data-rv-form] textarea");
    useTime = true;
    syncTime();
    ta.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => ta.focus(), 250);
  }

  // ---------------------------------------- envoyer la version corrigée
  // Depuis la page où l'on voit les retours : on choisit le fichier, on dit
  // ce qui change, on coche ce qui est corrigé, ça part. À l'arrivée, la
  // note est posée, les retours cochés passent en "corrigé dans la vN", et
  // on bascule sur la nouvelle version.

  function nextVersion() {
    return Math.max(file.version_no, ...versions.map((v) => v.version_no)) + 1;
  }

  function openUpdate(list) {
    const picked = list && list.length !== undefined ? list[0] : list;
    if (!picked) return;
    const bad = checkFile(picked, ctx.space.maxFileBytes);
    if (bad) { toast(picked.name + " : " + bad, "err"); return; }
    const n = nextVersion();
    const open = top().filter((c) => stateOf(c) === "open").sort(byTime);

    const body = h(
      '<form class="rv-upd" novalidate>' +
        '<div class="rv-upd-file">' + icon("music", 20) + '<span class="rv-upd-name">' + esc(picked.name) + "</span>" +
          '<span class="mono">' + formatBytes(picked.size) + "</span></div>" +
        '<label class="field"><span class="label">Ce qui change dans la v' + n + "</span>" +
          '<textarea class="input" name="changelog" rows="2" maxlength="2000" placeholder="Ex : voix remontée, basse plus présente au refrain"></textarea></label>' +
        (open.length
          ? '<div class="field"><div class="rv-upd-head"><span class="label">Corrigé dans la v' + n + "</span>" +
              '<button type="button" class="link-btn" data-all>Tout cocher</button></div>' +
              '<ul class="rv-upd-list">' + open.map((c) =>
                '<li><label><input type="checkbox" value="' + c.id + '">' +
                  (numbers.get(c.id) ? '<span class="rv-num" style="--c:' + STATES.open.color + '">' + numbers.get(c.id) + "</span>" : "") +
                  "<span>" + (c.at_ms != null ? '<b class="mono">' + formatTime(c.at_ms / 1000) + "</b> " : "") + esc(c.body) + "</span></label></li>").join("") +
              "</ul></div>"
          : '<p class="hint">Aucun retour ouvert : la v' + n + " part telle quelle.</p>") +
        '<div class="rv-upd-progress" data-progress hidden><div class="rv-bar"><i data-bar style="flex:0;background:#A48BFF"></i><i data-rest style="flex:1"></i></div>' +
          '<p class="hint" data-status></p></div>' +
        '<button class="btn btn-primary btn-block btn-xl" type="submit" data-send>' + icon("upload", 20) + "<span>Envoyer la v" + n + "</span></button>" +
      "</form>"
    );
    const sheet = openSheet({ title: "Envoyer la v" + n, body });
    const allBtn = body.querySelector("[data-all]");
    if (allBtn) {
      allBtn.onclick = () => {
        const boxes = [...body.querySelectorAll("input[type=checkbox]")];
        const on = boxes.some((b) => !b.checked);
        for (const b of boxes) b.checked = on;
        allBtn.textContent = on ? "Tout décocher" : "Tout cocher";
      };
    }

    body.addEventListener("submit", (e) => {
      e.preventDefault();
      const changelog = body.querySelector("[name=changelog]").value.trim();
      const fixed = [...body.querySelectorAll("input[type=checkbox]:checked")].map((b) => b.value);
      const send = body.querySelector("[data-send]");
      const status = body.querySelector("[data-status]");
      const bar = body.querySelector("[data-bar]");
      const rest = body.querySelector("[data-rest]");
      send.disabled = true;
      send.innerHTML = '<span class="spinner"></span><span>Envoi de la v' + n + "…</span>";
      body.querySelector("[data-progress]").hidden = false;
      for (const b of body.querySelectorAll("input, textarea")) b.disabled = true;

      const [job] = enqueue([picked], {
        spaceId: ctx.space.id, projectId: file.project_id, projectTitle: file.project ? file.project.title : "",
        kind: "mix", label: null, bpm: null, musicalKey: null, tag: "rv-update-" + file.id,
        replaces: true   // la vN remplace la précédente (retours conservés)
      });
      const from = location.hash;
      let finished = false;
      const off = onUploads(async (j) => {
        if (j.id !== job.id || finished) return;
        if (j.state === "uploading" && j.size) {
          const pct = Math.min(100, Math.round((j.loaded / j.size) * 100));
          bar.style.flex = String(pct);
          rest.style.flex = String(100 - pct);
          status.textContent = pct + " % · " + formatBytes(j.loaded) + " sur " + formatBytes(j.size) +
            " · tu peux fermer, l'envoi continue";
        } else if (j.state === "waiting" || j.state === "saving") {
          status.textContent = "Enregistrement de la v" + n + "…";
        } else if (j.state === "done" && j.result) {
          finished = true;
          off();
          const newId = j.result.id;
          try {
            if (changelog) await updateFile(newId, { changelog });
            for (const id of fixed) await setCommentResolved(id, true, newId, null);
          } catch (err) { toast(errorText(err), "err"); }
          sheet.close();
          toast("v" + j.result.version_no + " envoyée" + (fixed.length ? " · " + plural(fixed.length, "retour marqué corrigé", "retours marqués corrigés") : ""), "ok");
          // on bascule sur la nouvelle version, si on est resté sur la page
          if (location.hash === from) ctx.navigate("#/f/" + newId);
        } else if (j.state === "error" || j.state === "canceled") {
          finished = true;
          off();
          status.textContent = j.state === "error" ? (j.error || "L'envoi a échoué.") : "Envoi annulé.";
          send.disabled = false;
          send.textContent = "Fermer";
          send.onclick = (ev) => { ev.preventDefault(); sheet.close(); };
        }
      });
    });
  }

  // Liste texte pour la session de l'ingé : horodatage, étiquette, retour.
  function exportText() {
    const project = file.project ? file.project.title : "";
    const pending = top().filter((c) => stateOf(c) === "open").sort(byTime);
    const versionOf = new Map(versions.map((v) => [v.id, "v" + v.version_no]));
    const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date());
    return "WeshTransfer - " + project + " - retours à corriger (" + date + ")\n\n" +
      (pending.length
        ? pending.map((c) =>
            (c.at_ms != null ? formatTime(c.at_ms / 1000).padStart(6) : "  ----") + "  " +
            (c.tag ? "[" + (TAG_LABEL[c.tag] || c.tag) + "] " : "") + c.body.replace(/\s+/g, " ") +
            "  (" + (c.author ? c.author.pseudo : "?") + ", " + (versionOf.get(c.file_id) || "") + ")").join("\n")
        : "Rien à corriger.") + "\n";
  }

  async function withRow(e, fn) {
    const li = e.target.closest(".rv-item");
    const c = li && all.find((x) => x.id === li.dataset.id);
    if (c) await fn(c, li);
  }

  function bind() {
    // rail : toucher une pastille = l'écouter et la retrouver dans la liste
    if (o.rail && !o.rail.dataset.bound) {
      o.rail.dataset.bound = "1";
      o.rail.addEventListener("click", (e) => {
        const d = e.target.closest("[data-dot]");
        if (!d) return;
        highlight(d.dataset.dot, true);
        o.playAt(Number(d.dataset.at) / 1000);
      });
    }
    // points rapides : posés tout de suite, à la seconde en cours
    if (o.quick && !o.quick.dataset.bound) {
      o.quick.dataset.bound = "1";
      o.quick.addEventListener("click", async (e) => {
        if (e.target.closest("[data-quick-more]")) { focusComposer(); return; }
        const b = e.target.closest("[data-quick]");
        if (!b || b.disabled) return;
        const [label, t] = QUICK[Number(b.dataset.quick)];
        const at = o.currentMs();
        b.disabled = true;
        try {
          await addComment(file.id, label, at, { tag: t });
          filter = "open";
          await reload();
          toast(label + " : noté à " + formatTime(at / 1000), "ok");
        } catch (err) { toast(errorText(err), "err"); }
        b.disabled = false;
      });
    }

    const form = q("[data-rv-form]");
    const ta = form.querySelector("textarea");
    ta.addEventListener("focus", () => { if (o.pause) o.pause(); });

    q("[data-rv-time]").onclick = () => { useTime = !useTime; syncTime(); };
    q("[data-rv-tags]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tag]");
      if (!b) return;
      tag = tag === b.dataset.tag ? null : b.dataset.tag;
      for (const x of el.querySelectorAll("[data-tag]")) x.classList.toggle("is-on", x.dataset.tag === tag);
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      const btn = form.querySelector("[type=submit]");
      btn.disabled = true;
      try {
        await addComment(file.id, body, useTime ? o.currentMs() : null, { tag });
        ta.value = "";
        tag = null;
        for (const x of el.querySelectorAll("[data-tag]")) x.classList.remove("is-on");
        filter = "open";
        await reload();
      } catch (err) { toast(errorText(err), "err"); }
      btn.disabled = false;
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    const flushBtn = q("[data-rv-flush]");
    if (flushBtn) {
      flushBtn.onclick = async () => {
        flushBtn.disabled = true;
        try {
          const r = await reviewFlush(ctx.space.id);
          toast(r && r.sent ? "C'est parti : l'ingé reçoit tes retours par email"
            : r && r.subscribed ? "L'ingé a déjà tout reçu. Il verra la suite dans l'espace."
            : "L'ingé n'a pas activé les emails : il verra tes retours en ouvrant l'espace.", "ok");
        } catch (err) { toast(errorText(err), "err"); }
        flushBtn.disabled = false;
      };
    }

    q("[data-rv-filters]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (b) { filter = b.dataset.filter; draw(); }
    });

    const copyBtn = q("[data-rv-copy]");
    if (copyBtn) {
      copyBtn.onclick = async () => toast(await copyText(exportText()) ? "Liste copiée : colle-la dans tes notes de session" : "Copie impossible", "ok");
      q("[data-rv-txt]").onclick = () => {
        const url = URL.createObjectURL(new Blob([exportText()], { type: "text/plain;charset=utf-8" }));
        const name = "retours-" + (file.project ? file.project.title : "mix").replace(/[^\wÀ-ſ-]+/g, "-").toLowerCase() + "-v" + file.version_no + ".txt";
        triggerDownload(url, name);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
    }

    q("[data-rv-list]").addEventListener("click", async (e) => {
      const at = e.target.closest("[data-at]");
      if (at) { o.playAt(Number(at.dataset.at) / 1000); return; }

      if (e.target.closest("[data-resolve]")) {
        return withRow(e, async (c) => {
          const note = await textSheet("Corrigé dans la v" + file.version_no, {
            intro: esc(c.body),
            placeholder: "Ce que tu as changé (facultatif) : voix remontée de 2 dB, reverb raccourcie...",
            ok: "Marquer corrigé"
          });
          if (note === null) return;
          try { await setCommentResolved(c.id, true, file.id, note); await reload(); }
          catch (err) { toast(errorText(err), "err"); }
        });
      }
      if (e.target.closest("[data-unresolve]")) {
        return withRow(e, async (c) => {
          try { await setCommentResolved(c.id, false); await reload(); }
          catch (err) { toast(errorText(err), "err"); }
        });
      }
      if (e.target.closest("[data-ok]")) {
        return withRow(e, async (c) => {
          try { await setCommentVerified(c.id, true); toast("Noté : c'est réglé", "ok"); await reload(); }
          catch (err) { toast(errorText(err), "err"); }
        });
      }
      if (e.target.closest("[data-reopen]")) {
        return withRow(e, async (c) => {
          const why = await textSheet("Pas encore réglé", {
            intro: esc(c.body),
            placeholder: "Qu'est-ce qui ne va toujours pas ? (facultatif)",
            ok: "Renvoyer à l'ingé"
          });
          if (why === null) return;
          try { await setCommentVerified(c.id, false, why); filter = "open"; await reload(); }
          catch (err) { toast(errorText(err), "err"); }
        });
      }
      if (e.target.closest("[data-reply]")) {
        return withRow(e, async (c, li) => {
          const f = li.querySelector("[data-reply-form]");
          f.hidden = !f.hidden;
          if (!f.hidden) f.querySelector("input").focus();
        });
      }
      const del = e.target.closest("[data-del]");
      if (del) {
        const id = (del.closest(".rv-replies li") || del.closest(".rv-item")).dataset.id;
        const ok = await confirmSheet("Supprimer ce message ?", { ok: "Supprimer", danger: true });
        if (!ok) return;
        try { await deleteComment(id); await reload(); }
        catch (err) { toast(errorText(err), "err"); }
      }
    });

    q("[data-rv-list]").addEventListener("submit", async (e) => {
      const f = e.target.closest("[data-reply-form]");
      if (!f) return;
      e.preventDefault();
      const input = f.querySelector("input");
      const body = input.value.trim();
      if (!body) return;
      const li = f.closest(".rv-item");
      try {
        await addComment(file.id, body, null, { parentId: li.dataset.id });
        await reload();
      } catch (err) { toast(errorText(err), "err"); }
    });
  }

  return {
    setFile, reload, draw, drawRail, syncTime, focusComposer, onPlayback,
    focusMarker: (m) => { if (m && m.id) highlight(m.id, true); },
    get useTime() { return useTime; }
  };
}
