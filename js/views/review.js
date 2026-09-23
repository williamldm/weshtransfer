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
  setFileApproved, updateFile
} from "../api.js?v=35";
import { formatTime } from "../waveform.js?v=35";
import { icon } from "../icons.js?v=35";
import { esc, h, timeAgo, toast, errorText, plural, confirmSheet, openSheet, copyText, triggerDownload } from "../ui.js?v=35";

export const TAGS = [
  ["voix", "Voix"], ["instru", "Instru"], ["basse", "Basse"], ["batterie", "Batterie"],
  ["effets", "Effets"], ["niveau", "Volume"], ["structure", "Structure"], ["autre", "Autre"]
];
const TAG_LABEL = Object.fromEntries(TAGS);

const STATES = {
  open: { label: "À corriger", cls: "is-open" },
  verify: { label: "Corrigé, à vérifier", cls: "is-verify" },
  done: { label: "Réglé", cls: "is-done" }
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
          (engineer ? "" : "Pas besoin de vocabulaire technique. Mets en pause au bon endroit, l'horodatage suit.") +
          '</span><span class="spacer"></span><button class="btn btn-primary btn-sm" type="submit">Publier</button></div>' +
      "</form>" +

      '<div class="section-head rv-head"><h2>Retours</h2>' +
        (engineer
          ? '<div class="rv-tools">' +
              '<button type="button" class="btn btn-ghost btn-sm" data-rv-copy>' + icon("copy", 15) + " Copier la liste</button>" +
              '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-rv-txt aria-label="Télécharger la liste">' + icon("download", 15) + "</button>" +
            "</div>"
          : "") +
      "</div>" +
      '<div class="chips rv-filters" data-rv-filters>' +
        ["open", "verify", "done"].map((k) =>
          '<button type="button" class="chip" data-filter="' + k + '">' + STATES[k].label + ' <span class="count" data-n="' + k + '">0</span></button>').join("") +
      "</div>" +
      '<ul class="comment-list rv-list" data-rv-list></ul>' +
    "</section>"
  );
}

function renderItem(c, replies, ctx, file, versionOf, engineer) {
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

  return '<li class="comment rv-item ' + STATES[st].cls + '" data-id="' + c.id + '">' +
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
    bind();
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
    const shown = items.filter((c) => stateOf(c) === filter).sort(byTime);
    q("[data-rv-list]").innerHTML = shown.length
      ? shown.map((c) => renderItem(c, (replies.get(c.id) || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)), ctx, file, versionOf, engineer)).join("")
      : '<li class="comment-empty">' + emptyText(counts) + "</li>";

    // sur la waveform : ce qui reste à corriger ou à vérifier
    o.setMarkers(items.filter((c) => c.at_ms != null && stateOf(c) !== "done").map((c) => ({ atMs: c.at_ms })));
  }

  function emptyText(counts) {
    if (!top().length) {
      return engineer
        ? "Pas encore de retour. Invite l'artiste : il écoute, met en pause, écrit, et ça s'accroche à la seconde près."
        : "Pas encore de retour. Écoute, mets en pause là où quelque chose cloche, et écris.";
    }
    if (filter === "open") return counts.verify ? "Rien à corriger. Des corrections attendent d'être vérifiées." : "Rien à corriger.";
    if (filter === "verify") return engineer ? "Aucune correction en attente de l'artiste." : "Aucune correction à vérifier.";
    return "Rien de réglé pour l'instant.";
  }

  // "Nouveau dans la vN" pour l'artiste ; note de version pour l'ingé
  function drawNews(counts, fixedHere) {
    const box = q("[data-rv-news]");
    const v = "v" + file.version_no;
    const canWrite = engineer && (file.uploaded_by === ctx.space.participantId || ctx.space.isHost);
    if (engineer) {
      box.innerHTML =
        '<div class="rv-card rv-inge">' +
          '<div class="rv-card-head"><span class="eyebrow">Côté ingé</span>' +
            '<span class="rv-summary">' +
              (counts.open ? '<span class="st st-open">' + plural(counts.open, "à corriger", "à corriger") + "</span>" : "") +
              (counts.verify ? '<span class="st">' + counts.verify + " chez l'artiste</span>" : "") +
              (counts.done ? '<span class="st st-ok">' + plural(counts.done, "réglé", "réglés") + "</span>" : "") +
            "</span></div>" +
          (canWrite
            ? '<label class="field rv-changelog"><span class="label">Ce qui change dans la ' + v + ", pour l'artiste</span>" +
                '<textarea class="input" rows="2" maxlength="2000" data-changelog placeholder="Ex : voix remontée, basse moins envahissante au refrain, fin raccourcie">' + esc(file.changelog || "") + "</textarea>" +
                '<span class="hint" data-changelog-state>' + (file.changelog ? "L'artiste le lit en premier en ouvrant la " + v + "." : "Coche aussi, dans la liste, les retours corrigés dans cette version.") + "</span></label>"
            : (file.changelog ? '<p class="rv-changelog-text">' + esc(file.changelog) + "</p>" : "")) +
        "</div>";
      const ta = box.querySelector("[data-changelog]");
      if (ta) {
        let saved = file.changelog || "";
        const save = async () => {
          const val = ta.value.trim();
          if (val === saved) return;
          try {
            await updateFile(file.id, { changelog: val || null });
            saved = val;
            file.changelog = val;
            box.querySelector("[data-changelog-state]").textContent = "Enregistré. L'artiste le lit en premier en ouvrant la " + v + ".";
          } catch (err) { toast(errorText(err), "err"); }
        };
        ta.addEventListener("blur", save);
      }
      return;
    }
    const latest = versions.length && versions[versions.length - 1].id === file.id;
    if (!file.changelog && !fixedHere.length) {
      box.innerHTML = !top().length && latest
        ? '<p class="review-hint">' + icon("comment", 18) + "<span>Écoute le mix. Là où quelque chose te gêne, mets en pause et écris ce que tu entends : le retour s'accroche à la seconde près, l'ingé le retrouve direct.</span></p>"
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
      box.innerHTML = '<div class="approve is-on"><div class="approve-text">' + icon("check", 18) +
        "<span><strong>" + v + " validée</strong>" + (file.approved_by ? " par " + esc(file.approved_by) : "") + " · " + timeAgo(file.approved_at) + "</span></div>" +
        (!mineFile ? '<button class="btn btn-ghost btn-sm" data-approve>Annuler</button>' : "") + "</div>";
    } else if (mineFile) {
      box.innerHTML = '<div class="approve"><div class="approve-text muted">' + icon("clock", 18) +
        "<span>En attente de validation par l'artiste" + (counts.open || counts.verify ? " (" + plural(counts.open + counts.verify, "retour en cours", "retours en cours") + ")" : "") + ".</span></div></div>";
    } else {
      box.innerHTML = '<div class="approve">' +
        '<button class="btn btn-primary btn-block" data-approve>' + icon("check", 18) + "<span>Valider la " + v + " : c'est bon pour moi</span></button></div>";
    }
    const b = box.querySelector("[data-approve]");
    if (b) {
      b.onclick = async () => {
        const approving = !file.approved_at;
        const pending = counts.open + counts.verify;
        if (approving && pending) {
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
          if (approving) toast("Mix validé. L'ingé le voit tout de suite.", "ok");
          draw();
        } catch (err) { toast(errorText(err), "err"); b.disabled = false; }
      };
    }
  }

  // ------------------------------------------------------------ actions

  function syncTime(ms) {
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
    const form = q("[data-rv-form]");
    const ta = form.querySelector("textarea");

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

  return { setFile, reload, draw, syncTime, focusComposer, get useTime() { return useTime; } };
}
