// Feuille "Participants" : qui est là, inviter, réglages du host.

import { listParticipants, updateSpace, deleteSpace, inviteByEmail, listInvites, deleteInvite } from "../api.js?v=76";
import { icon } from "../icons.js?v=76";
import { esc, h, openSheet, avatar, shareLink, copyText, toast, errorText, formatDate, confirmSheet, canShare, promptSheet } from "../ui.js?v=76";
import { leaveSpace, knownSpaces, switchTo, forgetSpace, renameMe, accountEmail, logout } from "../session.js?v=76";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function inviteUrl(code) {
  return location.origin + "/c/" + encodeURIComponent(code);
}

export async function openPeopleSheet(ctx) {
  const s = ctx.space;
  const url = inviteUrl(s.code);
  const byInvite = s.access === "invite" && s.mode !== "envoi";
  // boîte d'envoi : personnelle (transferts, adresses des destinataires),
  // son code ne fait entrer personne d'autre
  const personal = s.mode === "envoi";

  const body = h(
    '<div class="people">' +
      (byInvite
        ? '<div class="invite">' +
            (s.isHost
              ? '<form data-invite-form novalidate>' +
                  '<label class="label" for="invite-mails">Inviter par email</label>' +
                  '<div class="invite-mail"><input class="input" id="invite-mails" type="text" inputmode="email" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="email@exemple.fr, autre@exemple.fr">' +
                  '<button class="btn btn-primary" type="submit">' + icon("send", 16) + " Inviter</button></div>" +
                  '<p class="muted">Chacun reçoit un lien personnel et vérifie son adresse avec un code avant d\'entrer : un lien transféré ne suffit pas.</p>' +
                "</form>" +
                '<ul class="invites" data-invites></ul>'
              : '<p class="muted">' + icon("lock", 14) + " Cet espace est sur invitation. Demande à l'hôte d'inviter quelqu'un par email.</p>") +
          "</div>"
        : personal
        ? '<div class="invite"><p class="muted">' + icon("lock", 14) + " Ton espace d'envoi est personnel : personne d'autre n'y entre. " +
            "Pour le retrouver sur un autre appareil, connecte-toi avec ton email.</p></div>"
        : '<div class="invite">' +
            '<div class="invite-code mono">' + esc(s.code) + "</div>" +
            '<p class="muted">Donne ce code ou le lien : chacun choisit juste un blaze.</p>' +
            '<div class="row-2">' +
              '<button class="btn btn-block" data-copy>' + icon("copy", 18) + " Copier le lien</button>" +
              (canShare() ? '<button class="btn btn-primary btn-block" data-share>' + icon("share", 18) + " Partager</button>" : "") +
            "</div>" +
          "</div>") +
      '<div class="setting"><div><strong>Ton blaze</strong><div class="muted" data-my-pseudo>' + esc(s.pseudo || "") + "</div></div>" +
        '<button class="btn btn-sm" data-rename>' + icon("edit", 16) + " Changer</button></div>" +
      '<div class="section-head"><h2>Dans l\'espace</h2></div>' +
      '<ul class="people-list" data-list><li class="muted">Chargement...</li></ul>' +
      (s.isHost ? '<div class="section-head"><h2>Réglages (host)</h2></div><div data-host></div>' : "") +
      '<div class="section-head"><h2>Mes espaces</h2></div>' +
      (accountEmail()
        ? '<div class="setting"><div><strong>Compte</strong><div class="muted">' + esc(accountEmail()) + " · tes espaces te suivent sur tous tes appareils</div></div>" +
            '<button class="btn btn-sm" data-logout>Se déconnecter</button></div>'
        : '<div class="setting"><div><strong>Pas connecté</strong><div class="muted">Connecte-toi avec ton email pour retrouver tes espaces partout.</div></div>' +
            '<a class="btn btn-sm" href="index.html">Se connecter</a></div>') +
      '<div class="space-list" data-spaces></div>' +
      '<button class="btn btn-ghost btn-block" data-leave>' + icon("logout", 18) + " Quitter cet espace sur cet appareil</button>" +
    "</div>"
  );

  openSheet({ title: "Participants", body });

  const copyBtn = body.querySelector("[data-copy]");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      toast(await copyText(url) ? "Lien d'invitation copié" : "Copie impossible", "ok");
    };
  }

  // Changer de blaze (dans cet espace)
  body.querySelector("[data-rename]").onclick = async () => {
    const next = await promptSheet("Ton blaze", s.pseudo || "", { max: 24, ok: "Changer" });
    if (!next || next === s.pseudo) return;
    try {
      s.pseudo = await renameMe(s.id, next);
      try { localStorage.setItem("seminaire.pseudo", s.pseudo); } catch (err) { /* privé */ }
      body.querySelector("[data-my-pseudo]").textContent = s.pseudo;
      toast("Tu t'appelles maintenant " + s.pseudo, "ok");
      drawPeople();
    } catch (err) { toast(errorText(err), "err"); }
  };

  // Invitations par email (host, espace sur invitation)
  const inviteForm = body.querySelector("[data-invite-form]");
  const invitesEl = body.querySelector("[data-invites]");
  const drawInvites = async () => {
    if (!invitesEl) return;
    try {
      const list = await listInvites(s.id);
      const now = Date.now();
      invitesEl.innerHTML = list.map((iv) => {
        const state = iv.accepted_at ? '<span class="iv-state is-in">entré·e</span>'
          : new Date(iv.expires_at).getTime() < now ? '<span class="iv-state">expirée</span>'
          : '<span class="iv-state">en attente</span>';
        return '<li data-id="' + esc(iv.id) + '" data-email="' + esc(iv.email) + '"><span class="iv-mail">' + esc(iv.email) + "</span>" + state +
          (iv.accepted_at ? "" : '<button class="btn btn-ghost btn-sm" data-resend>Renvoyer</button>') +
          '<button class="btn btn-ghost btn-icon btn-sm" data-cancel aria-label="Annuler l\'invitation">' + icon("x", 16) + "</button></li>";
      }).join("");
    } catch (err) {
      invitesEl.innerHTML = '<li class="muted">' + esc(errorText(err)) + "</li>";
    }
  };
  const sendInvites = async (emails, btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await inviteByEmail(s.id, emails);
      const sent = (r.results || []).filter((x) => x.status === "sent").length;
      const failed = (r.results || []).filter((x) => x.status !== "sent");
      toast(failed.length ? failed.length + " invitation(s) non partie(s) : " + failed.map((x) => x.email).join(", ")
        : sent > 1 ? sent + " invitations envoyées" : "Invitation envoyée", failed.length ? "err" : "ok");
      await drawInvites();
      return true;
    } catch (err) {
      toast(errorText(err), "err");
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  };
  if (inviteForm) {
    inviteForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = inviteForm.querySelector("input");
      const emails = input.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const bad = emails.find((x) => !EMAIL_RE.test(x));
      if (!emails.length) { input.focus(); return; }
      if (bad) { toast("Adresse invalide : " + bad, "err"); return; }
      if (await sendInvites(emails, inviteForm.querySelector("[type=submit]"))) input.value = "";
    });
    invitesEl.addEventListener("click", async (e) => {
      const li = e.target.closest("li[data-id]");
      if (!li) return;
      if (e.target.closest("[data-resend]")) { sendInvites([li.dataset.email], e.target.closest("button")); return; }
      if (e.target.closest("[data-cancel]")) {
        try { await deleteInvite(li.dataset.id); li.remove(); toast("Invitation annulée : son lien ne marche plus", "ok"); }
        catch (err) { toast(errorText(err), "err"); }
      }
    });
    drawInvites();
  }
  const shareBtn = body.querySelector("[data-share]");
  if (shareBtn) {
    shareBtn.onclick = () => shareLink({
      title: s.name,
      text: "Rejoins l'espace " + s.name + " (code " + s.code + ")",
      url
    });
  }

  const logoutBtn = body.querySelector("[data-logout]");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      const ok = await confirmSheet("Rien n'est supprimé : tu retrouveras tout en te reconnectant avec ton email.",
        { ok: "Se déconnecter", title: "Se déconnecter de cet appareil" });
      if (!ok) return;
      await logout();
      location.href = "index.html";
    };
  }

  body.querySelector("[data-leave]").onclick = async () => {
    const ok = await confirmSheet((byInvite
      ? "Pour revenir, rouvre ton lien d'invitation (ou demande-en un nouveau à l'hôte)."
      : "Tu pourras revenir avec le code " + s.code + ".") + " Tes fichiers restent dans l'espace.", { ok: "Quitter" });
    if (!ok) return;
    leaveSpace();
    location.href = byInvite ? "/" : "/c/" + encodeURIComponent(s.code);
  };

  // Passer d'un espace à l'autre sans ressaisir de code
  const others = knownSpaces().filter((k) => k.id !== s.id);
  body.querySelector("[data-spaces]").innerHTML =
    '<div class="space-item is-current">' + icon({ envoi: "send", revue: "check" }[s.mode] || "music", 18) +
      "<span>" + esc(s.name) + '</span><span class="tag">ici</span></div>' +
    others.map((k) =>
      '<button class="space-item" data-switch="' + esc(k.id) + '">' + icon({ envoi: "send", revue: "check" }[k.mode] || "music", 18) +
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
  async function drawPeople() {
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
  }
  await drawPeople();

  const host = body.querySelector("[data-host]");
  if (!host) return;

  const drawHost = () => {
    host.innerHTML =
      (s.mode !== "envoi"
        ? '<div class="setting"><div><strong>' + (s.access === "invite" ? "Sur invitation par email" : "Entrée avec le code") + "</strong>" +
            '<div class="muted">' + (s.access === "invite"
              ? "Chacun vérifie son adresse avant d'entrer. Le plus sûr."
              : "Toute personne qui a le code ou le lien peut entrer. Plus simple, moins sûr.") + "</div></div>" +
            '<button class="btn btn-sm" data-access>' + (s.access === "invite" ? "Passer au code" : icon("lock", 16) + " Sur invitation") + "</button></div>"
        : "") +
      '<div class="setting"><div><strong>Entrées ' + (s.isLocked ? "fermées" : "ouvertes") + "</strong>" +
        '<div class="muted">' + (s.isLocked ? "Seuls les participants actuels peuvent revenir." : "Toute personne avec le code peut entrer.") + "</div></div>" +
        '<button class="btn btn-sm" data-lock>' + icon("lock", 16) + (s.isLocked ? " Rouvrir" : " Fermer") + "</button></div>" +
      (s.purgeAt === null
        ? '<div class="setting"><div><strong>Jamais supprimé</strong>' +
            '<div class="muted">Les mix et leurs retours restent jusqu\'à ce que tu supprimes l\'espace toi-même.</div></div>' +
            '<button class="btn btn-sm" data-keep="off">Remettre une date</button></div>'
        : '<div class="setting"><div><strong>Suppression des fichiers</strong>' +
            '<div class="muted">' + esc(s.purgeAt ? formatDate(s.purgeAt) : "") + "</div></div>" +
            '<div class="setting-actions"><button class="btn btn-sm" data-extend>+7 jours</button>' +
            (s.mode === "revue" ? '<button class="btn btn-sm" data-keep="on">Ne jamais supprimer</button>' : "") + "</div></div>") +
      '<div class="setting"><div><strong>Supprimer l\'espace</strong>' +
        '<div class="muted">Fichiers, envois et commentaires, pour tout le monde. Définitif.</div></div>' +
        '<button class="btn btn-sm btn-danger" data-destroy>Supprimer</button></div>';

    const accessBtn = host.querySelector("[data-access]");
    if (accessBtn) {
      accessBtn.onclick = async () => {
        const next = s.access === "invite" ? "code" : "invite";
        if (next === "code") {
          const ok = await confirmSheet("Toute personne qui a le code " + s.code + " ou le lien pourra entrer, sans vérifier son email.",
            { ok: "Passer au code", title: "Entrée avec le code" });
          if (!ok) return;
        }
        try {
          const row = await updateSpace(s.id, { access: next });
          s.access = row.access;
          toast(s.access === "invite" ? "Espace sur invitation : rouvre cette fiche pour inviter" : "Entrée avec le code", "ok");
          drawHost();
        } catch (err) { toast(errorText(err), "err"); }
      };
    }

    host.querySelector("[data-lock]").onclick = async () => {
      try {
        const row = await updateSpace(s.id, { is_locked: !s.isLocked });
        s.isLocked = row.is_locked;
        drawHost();
      } catch (err) { toast(errorText(err), "err"); }
    };
    host.querySelector("[data-destroy]").onclick = async () => {
      const ok = await confirmSheet(s.name + " sera effacé pour tout le monde : fichiers, envois, commentaires. C'est définitif.",
        { ok: "Tout supprimer", danger: true, title: "Supprimer l'espace" });
      if (!ok) return;
      try {
        await deleteSpace(s.id);
        forgetSpace(s.id);
        location.href = "index.html";
      } catch (err) { toast(errorText(err), "err"); }
    };
    // Retours : garder les mix sans date limite (3 espaces par personne)
    const keep = host.querySelector("[data-keep]");
    if (keep) {
      keep.onclick = async () => {
        const on = keep.dataset.keep === "on";
        if (on) {
          const ok = await confirmSheet("Les mix, leurs versions et les retours resteront jusqu'à ce que tu supprimes l'espace toi-même.",
            { ok: "Ne jamais supprimer", title: "Conservation sans limite" });
          if (!ok) return;
        }
        try {
          const row = await updateSpace(s.id, { purge_at: on ? null : new Date(Date.now() + 37 * 86400000).toISOString() });
          s.purgeAt = row.purge_at;
          toast(on ? "Cet espace ne sera jamais supprimé automatiquement" : "Fichiers conservés jusqu'au " + formatDate(s.purgeAt), "ok");
          drawHost();
        } catch (err) { toast(errorText(err), "err"); }
      };
    }

    const extendBtn = host.querySelector("[data-extend]");
    if (extendBtn) extendBtn.onclick = async () => {
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
