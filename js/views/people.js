// Feuille "Participants" : qui est là, inviter, réglages du host.

import { listParticipants, updateSpace } from "../api.js?v=15";
import { icon } from "../icons.js?v=15";
import { esc, h, openSheet, avatar, shareLink, copyText, toast, errorText, formatDate, confirmSheet, canShare } from "../ui.js?v=15";
import { leaveSpace, knownSpaces, switchTo } from "../session.js?v=15";

export function inviteUrl(code) {
  return new URL("index.html?c=" + encodeURIComponent(code), location.href).href;
}

export async function openPeopleSheet(ctx) {
  const s = ctx.space;
  const url = inviteUrl(s.code);

  const body = h(
    '<div class="people">' +
      '<div class="invite">' +
        '<div class="invite-code mono">' + esc(s.code) + "</div>" +
        '<p class="muted">Donne ce code ou le lien : chacun choisit juste un blaze.</p>' +
        '<div class="row-2">' +
          '<button class="btn btn-block" data-copy>' + icon("copy", 18) + " Copier le lien</button>" +
          (canShare() ? '<button class="btn btn-primary btn-block" data-share>' + icon("share", 18) + " Partager</button>" : "") +
        "</div>" +
      "</div>" +
      '<div class="section-head"><h2>Dans l\'espace</h2></div>' +
      '<ul class="people-list" data-list><li class="muted">Chargement...</li></ul>' +
      (s.isHost ? '<div class="section-head"><h2>Réglages (host)</h2></div><div data-host></div>' : "") +
      '<div class="section-head"><h2>Mes espaces</h2></div>' +
      '<div class="space-list" data-spaces></div>' +
      '<button class="btn btn-ghost btn-block" data-leave>' + icon("logout", 18) + " Quitter cet espace sur cet appareil</button>" +
    "</div>"
  );

  openSheet({ title: "Participants", body });

  body.querySelector("[data-copy]").onclick = async () => {
    toast(await copyText(url) ? "Lien d'invitation copié" : "Copie impossible", "ok");
  };
  const shareBtn = body.querySelector("[data-share]");
  if (shareBtn) {
    shareBtn.onclick = () => shareLink({
      title: s.name,
      text: "Rejoins l'espace " + s.name + " (code " + s.code + ")",
      url
    });
  }

  body.querySelector("[data-leave]").onclick = async () => {
    const ok = await confirmSheet("Tu pourras revenir avec le code " + s.code + ". Tes fichiers restent dans l'espace.", { ok: "Quitter" });
    if (!ok) return;
    leaveSpace();
    location.href = "index.html?c=" + encodeURIComponent(s.code);
  };

  // Passer d'un espace à l'autre sans ressaisir de code
  const others = knownSpaces().filter((k) => k.id !== s.id);
  body.querySelector("[data-spaces]").innerHTML =
    '<div class="space-item is-current">' + icon(s.mode === "envoi" ? "send" : "music", 18) +
      "<span>" + esc(s.name) + '</span><span class="tag">ici</span></div>' +
    others.map((k) =>
      '<button class="space-item" data-switch="' + esc(k.id) + '">' + icon(k.mode === "envoi" ? "send" : "music", 18) +
        "<span>" + esc(k.name) + "</span>" + icon("chevron", 18) + "</button>").join("") +
    '<a class="space-item" href="index.html">' + icon("plus", 18) + "<span>Rejoindre un autre espace</span></a>";
  body.querySelector("[data-spaces]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-switch]");
    if (b && switchTo(b.dataset.switch)) {
      location.href = "app.html#/projects";
      location.reload();
    }
  });

  const listEl = body.querySelector("[data-list]");
  try {
    const people = await listParticipants(s.id);
    listEl.innerHTML = people.map((p) => {
      const online = ctx.online.has(p.id);
      return "<li>" + avatar(p.pseudo, online) +
        '<span class="p-name">' + esc(p.pseudo) + (p.id === s.participantId ? ' <span class="muted">(toi)</span>' : "") + "</span>" +
        (p.is_host ? '<span class="tag">host</span>' : "") +
        '<span class="p-state">' + (online ? "en ligne" : "") + "</span></li>";
    }).join("");
  } catch (err) {
    listEl.innerHTML = '<li class="muted">' + esc(errorText(err)) + "</li>";
  }

  const host = body.querySelector("[data-host]");
  if (!host) return;

  const drawHost = () => {
    host.innerHTML =
      '<div class="setting"><div><strong>Entrées ' + (s.isLocked ? "fermées" : "ouvertes") + "</strong>" +
        '<div class="muted">' + (s.isLocked ? "Seuls les participants actuels peuvent revenir." : "Toute personne avec le code peut entrer.") + "</div></div>" +
        '<button class="btn btn-sm" data-lock>' + icon("lock", 16) + (s.isLocked ? " Rouvrir" : " Fermer") + "</button></div>" +
      '<div class="setting"><div><strong>Suppression des fichiers</strong>' +
        '<div class="muted">' + esc(s.purgeAt ? formatDate(s.purgeAt) : "") + "</div></div>" +
        '<button class="btn btn-sm" data-extend>+7 jours</button></div>';

    host.querySelector("[data-lock]").onclick = async () => {
      try {
        const row = await updateSpace(s.id, { is_locked: !s.isLocked });
        s.isLocked = row.is_locked;
        drawHost();
      } catch (err) { toast(errorText(err), "err"); }
    };
    host.querySelector("[data-extend]").onclick = async () => {
      try {
        const base = Math.max(Date.now(), new Date(s.purgeAt).getTime());
        const row = await updateSpace(s.id, { purge_at: new Date(base + 7 * 86400000).toISOString() });
        s.purgeAt = row.purge_at;
        drawHost();
        toast("Fichiers conservés jusqu'au " + formatDate(s.purgeAt), "ok");
      } catch (err) { toast(errorText(err), "err"); }
    };
  };
  drawHost();
}
