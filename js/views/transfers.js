// Historique des envois de l'espace : qui a reçu quoi, qui a ouvert,
// qui a téléchargé. Mis à jour en direct.

import { listTransfers, listMyTransfers, revokeTransfer, deleteTransfer, transferUrl, deleteFile, listTransferRefs } from "../api.js?v=128";
import { icon } from "../icons.js?v=128";
import {
  esc, formatBytes, plural, timeAgo, formatDate, daysLeft, toast, errorText, copyText, shareLink,
  canShare, confirmSheet, actionSheet
} from "../ui.js?v=128";

export const title = () => "Envois";

// Anciens envois par email seulement (les envois se font par lien seul)
function recipientState(r) {
  if (r.first_download_at) return '<span class="st st-ok">' + icon("download", 13) + " téléchargé</span>";
  if (r.first_opened_at) return '<span class="st st-info">' + icon("eye", 13) + " ouvert</span>";
  if (r.status === "sent") return '<span class="st">' + icon("check", 13) + " envoyé</span>";
  if (r.status === "failed") return '<span class="st st-bad" title="' + esc(r.error || "") + '">échec</span>';
  return '<span class="st">en attente</span>';
}

// me : ma place dans l'espace, ou l'ensemble de mes places (tous espaces)
export function renderTransfers(list, me, isHost, hereId) {
  const isMine = (id) => (me instanceof Set ? me.has(id) : id === me);
  if (!list.length) {
    return '<div class="empty-state">' + icon("send", 34) +
      "<p><strong>Aucun envoi pour l'instant.</strong><br>Crée un lien à partager, valable 7 jours.</p>" +
      '<a class="btn btn-primary" href="#/send">' + icon("send", 18) + " Nouvel envoi</a></div>";
  }
  return list.map((t) => {
    const files = (t.transfer_files || []).map((x) => x.file).filter(Boolean);
    const size = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const left = daysLeft(t.expires_at);
    // "jusqu'au 1er téléchargement" : fini quand tout a été récupéré (et détruit)
    const taken = !!t.until_download && !files.length;
    const expired = left <= 0 || taken;
    const mine = isMine(t.sender_id);
    // envoi parti d'un autre espace (liste "Mes envois" du compte)
    const from = hereId && t.space_id && t.space_id !== hereId && t.space ? " · depuis " + t.space.name : "";
    const recips = t.transfer_recipients || [];

    return '<article class="transfer' + (expired ? " is-expired" : "") + '" data-id="' + t.id + '">' +
      '<div class="tr-head">' +
        '<h3>' + esc(t.title) + "</h3>" +
        '<span class="pill' + (expired ? " is-off" : !t.until_download && left <= 1 ? " is-warn" : "") + '">' +
          (expired ? (taken ? "récupéré" : "expiré")
            : t.until_download ? "jusqu'au 1er téléchargement" : "encore " + plural(left, "jour", "jours")) + "</span>" +
      "</div>" +
      '<div class="tr-meta">' + esc((t.sender ? t.sender.pseudo : "?") + " · " + timeAgo(t.created_at) + " · " +
        plural(files.length, "fichier", "fichiers") + " · " + formatBytes(size) + from) +
        (t.download_count ? ' · <span class="dl">' + icon("download", 13) + " " + t.download_count + "</span>" : "") +
      "</div>" +
      (t.message ? '<p class="tr-msg">' + esc(t.message) + "</p>" : "") +
      (recips.length
        ? '<ul class="tr-recips">' + recips.map((r) =>
            "<li><span class=\"r-mail\">" + esc(r.email) + "</span>" + recipientState(r) + "</li>").join("") + "</ul>"
        : "") +
      (expired ? "" :
        '<div class="tr-actions">' +
          '<button class="btn btn-sm" data-copy>' + icon("copy", 16) + " Lien</button>" +
          (canShare() ? '<button class="btn btn-sm" data-share>' + icon("share", 16) + " Partager</button>" : "") +
          (mine || isHost ? '<button class="btn btn-ghost btn-icon btn-sm" data-more aria-label="Plus">' + icon("more", 18) + "</button>" : "") +
        "</div>") +
      (expired && (mine || isHost) ? '<div class="tr-actions"><button class="btn btn-ghost btn-sm" data-delete>' + icon("trash", 16) + " Supprimer</button></div>" : "") +
    "</article>";
  }).join("");
}

export async function mount(root, ctx) {
  let list = [];

  // Espace Envois (personnel) : tous mes envois, de tous mes espaces.
  // Séminaire : les envois de l'espace, de tout le groupe.
  const personal = ctx.space.mode === "envoi";
  root.innerHTML =
    '<header class="page-head">' + (personal ? "" : '<div class="eyebrow">Espace ' + esc(ctx.space.name) + "</div>") + "<h1>" + (personal ? "Mes envois" : "Envois") + "</h1>" +
    '<div class="meta">' + (personal
      ? "Tout ce que tu as envoyé, et combien de fois c'est téléchargé."
      : "Liens partagés depuis l\'espace, et combien de fois c'est téléchargé.") + "</div></header>" +
    '<a class="btn btn-primary btn-block" href="#/send">' + icon("send", 18) + " Nouvel envoi</a>" +
    '<div class="transfers" data-list><div class="skeleton"></div></div>';

  const el = root.querySelector("[data-list]");

  const load = async () => {
    try {
      if (personal) {
        const r = await listMyTransfers();
        list = r.list;
        el.innerHTML = renderTransfers(list, r.mine, false, ctx.space.id);
      } else {
        list = await listTransfers(ctx.space.id);
        el.innerHTML = renderTransfers(list, ctx.space.participantId, ctx.space.isHost);
      }
    } catch (err) {
      el.innerHTML = '<p class="empty">' + esc(errorText(err)) + "</p>";
    }
  };

  el.addEventListener("click", async (e) => {
    const card = e.target.closest(".transfer");
    if (!card) return;
    const t = list.find((x) => x.id === card.dataset.id);
    if (!t) return;
    const url = transferUrl(t.token);

    if (e.target.closest("[data-copy]")) {
      toast(await copyText(url) ? "Lien copié" : "Copie impossible", "ok");
    } else if (e.target.closest("[data-share]")) {
      shareLink({ title: t.title, text: t.title, url });
    } else if (e.target.closest("[data-delete]")) {
      removeTransfer(t);
    } else if (e.target.closest("[data-more]")) {
      actionSheet(t.title, [
        {
          label: fromEnvoi(t) ? "Supprimer l'envoi et ses fichiers" : "Supprimer l'envoi", icon: "trash", danger: true,
          run: () => removeTransfer(t)
        },
        {
          label: "Désactiver le lien maintenant", icon: "lock",
          run: async () => {
            const ok = await confirmSheet("Plus personne ne pourra ouvrir cet envoi avec le lien.", { ok: "Désactiver", danger: true });
            if (!ok) return;
            try { await revokeTransfer(t.id); toast("Lien désactivé", "ok"); load(); }
            catch (err) { toast(errorText(err), "err"); }
          }
        }
      ]);
    }
  });

  // Dans un espace d'envoi, les fichiers n'existent que pour l'envoi : on
  // les efface avec lui, sauf s'ils servent encore à un autre envoi.
  // l'espace d'où l'envoi est parti (dans "Mes envois", pas forcément celui-ci)
  function fromEnvoi(t) {
    return t.space ? t.space.mode === "envoi" : ctx.space.mode === "envoi";
  }

  async function removeTransfer(t) {
    // les fichiers d'un séminaire restent au séminaire
    const withFiles = fromEnvoi(t);
    const ok = await confirmSheet(
      withFiles
        ? "Le lien ne marchera plus, et les fichiers de cet envoi seront effacés."
        : "Le lien ne marchera plus. Les fichiers restent dans l'espace.",
      { ok: "Supprimer", danger: true, title: "Supprimer cet envoi" });
    if (!ok) return;
    try {
      const fileIds = (t.transfer_files || []).map((x) => x.file && x.file.id).filter(Boolean);
      await deleteTransfer(t.id);
      if (withFiles && fileIds.length) {
        const stillUsed = new Set((await listTransferRefs(fileIds)).map((r) => r.file_id));
        for (const id of fileIds) if (!stillUsed.has(id)) await deleteFile({ id }).catch(() => {});
      }
      toast("Envoi supprimé", "ok");
      load();
    } catch (err) { toast(errorText(err), "err"); }
  }

  let timer = 0;
  const off = ctx.bus.on("db", (e) => {
    if (e.table !== "transfers" && e.table !== "transfer_recipients") return;
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });

  await load();
  return () => { clearTimeout(timer); off(); };
}
