// Historique des envois de l'espace : qui a reçu quoi, qui a ouvert,
// qui a téléchargé. Mis à jour en direct.

import { listTransfers, revokeTransfer, deleteTransfer, sendTransfer, transferUrl, emailEnabled, deleteFile, listTransferRefs } from "../api.js?v=36";
import { icon } from "../icons.js?v=36";
import {
  esc, formatBytes, plural, timeAgo, formatDate, daysLeft, toast, errorText, copyText, shareLink,
  canShare, confirmSheet, actionSheet
} from "../ui.js?v=36";

export const title = () => "Envois";

function recipientState(r, emailOn) {
  if (r.first_download_at) return '<span class="st st-ok">' + icon("download", 13) + " téléchargé</span>";
  if (r.first_opened_at) return '<span class="st st-info">' + icon("eye", 13) + " ouvert</span>";
  if (!emailOn) return '<span class="st">lien personnel</span>';
  if (r.status === "sent") return '<span class="st">' + icon("check", 13) + " envoyé</span>";
  if (r.status === "failed") return '<span class="st st-bad" title="' + esc(r.error || "") + '">échec</span>';
  return '<span class="st">en attente</span>';
}

export function renderTransfers(list, me, isHost, emailOn) {
  if (!list.length) {
    return '<div class="empty-state">' + icon("send", 34) +
      "<p><strong>Aucun envoi pour l'instant.</strong><br>Envoie un son par email ou crée un lien à partager.</p>" +
      '<a class="btn btn-primary" href="#/send">' + icon("send", 18) + " Nouvel envoi</a></div>";
  }
  return list.map((t) => {
    const files = (t.transfer_files || []).map((x) => x.file).filter(Boolean);
    const size = files.reduce((s, f) => s + (f.size_bytes || 0), 0);
    const left = daysLeft(t.expires_at);
    const expired = left <= 0;
    const mine = t.sender_id === me;
    const recips = t.transfer_recipients || [];
    const failed = recips.filter((r) => r.status === "failed").length;

    return '<article class="transfer' + (expired ? " is-expired" : "") + '" data-id="' + t.id + '">' +
      '<div class="tr-head">' +
        '<h3>' + esc(t.title) + "</h3>" +
        '<span class="pill' + (expired ? " is-off" : left <= 1 ? " is-warn" : "") + '">' +
          (expired ? "expiré" : "encore " + plural(left, "jour", "jours")) + "</span>" +
      "</div>" +
      '<div class="tr-meta">' + esc((t.sender ? t.sender.pseudo : "?") + " · " + timeAgo(t.created_at) + " · " +
        plural(files.length, "fichier", "fichiers") + " · " + formatBytes(size)) +
        (t.download_count ? ' · <span class="dl">' + icon("download", 13) + " " + t.download_count + "</span>" : "") +
      "</div>" +
      (t.message ? '<p class="tr-msg">' + esc(t.message) + "</p>" : "") +
      (recips.length
        ? '<ul class="tr-recips">' + recips.map((r) =>
            "<li><span class=\"r-mail\">" + esc(r.email) + "</span>" + recipientState(r, emailOn) + "</li>").join("") + "</ul>"
        : '<p class="muted small">Lien partagé, sans destinataire email.</p>') +
      (expired ? "" :
        '<div class="tr-actions">' +
          '<button class="btn btn-sm" data-copy>' + icon("copy", 16) + " Lien</button>" +
          (canShare() ? '<button class="btn btn-sm" data-share>' + icon("share", 16) + " Partager</button>" : "") +
          (mine && failed && emailOn ? '<button class="btn btn-sm" data-retry>' + icon("retry", 16) + " Renvoyer</button>" : "") +
          (mine || isHost ? '<button class="btn btn-ghost btn-icon btn-sm" data-more aria-label="Plus">' + icon("more", 18) + "</button>" : "") +
        "</div>") +
      (expired && (mine || isHost) ? '<div class="tr-actions"><button class="btn btn-ghost btn-sm" data-delete>' + icon("trash", 16) + " Supprimer</button></div>" : "") +
    "</article>";
  }).join("");
}

export async function mount(root, ctx) {
  let list = [];
  const emailOn = await emailEnabled();

  root.innerHTML =
    '<header class="page-head"><div class="eyebrow">Espace ' + esc(ctx.space.name) + "</div><h1>Envois</h1>" +
    '<div class="meta">Liens et emails envoyés depuis l\'espace, avec qui a ouvert et téléchargé.</div></header>' +
    '<a class="btn btn-primary btn-block" href="#/send">' + icon("send", 18) + " Nouvel envoi</a>" +
    '<div class="transfers" data-list><div class="skeleton"></div></div>';

  const el = root.querySelector("[data-list]");

  const load = async () => {
    try {
      list = await listTransfers(ctx.space.id);
      el.innerHTML = renderTransfers(list, ctx.space.participantId, ctx.space.isHost, emailOn);
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
    } else if (e.target.closest("[data-retry]")) {
      try {
        const r = await sendTransfer(t.id, true);
        const ok = ((r && r.results) || []).filter((x) => x.status === "sent").length;
        toast(ok ? plural(ok, "email renvoyé", "emails renvoyés") : "Nouvel échec d'envoi", ok ? "ok" : "err");
        load();
      } catch (err) { toast(errorText(err), "err"); }
    } else if (e.target.closest("[data-delete]")) {
      removeTransfer(t);
    } else if (e.target.closest("[data-more]")) {
      actionSheet(t.title, [
        {
          label: ctx.space.mode === "envoi" ? "Supprimer l'envoi et ses fichiers" : "Supprimer l'envoi", icon: "trash", danger: true,
          run: () => removeTransfer(t)
        },
        {
          label: "Désactiver le lien maintenant", icon: "lock",
          run: async () => {
            const ok = await confirmSheet("Plus personne ne pourra ouvrir cet envoi, y compris les destinataires email.", { ok: "Désactiver", danger: true });
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
  async function removeTransfer(t) {
    const withFiles = ctx.space.mode === "envoi";
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
