// Accueil WeshTransfer : une carte à onglets posée sur la centrale.
// Envoyer (dépôt direct des fichiers), Salon, Retours, J'ai un code, et
// les espaces déjà ouverts sur cet appareil (ouvrir, oublier, supprimer).
// session.js / api.js ne sont chargés qu'au moment d'agir.

import { icon } from "./icons.js?v=93";
import { esc, h, errorText, formatBytes, plural, actionSheet, confirmSheet, toast } from "./ui.js?v=93";
import { isBlocked, FILE_MAX } from "./files.js?v=93";
import { putPending, MAX_BYTES } from "./pending.js?v=93";
import { mountWallpaperNote } from "./wallpapers.js?v=93";
import { mountClaim } from "./claim-fx.js?v=93";

const PSEUDO_KEY = "seminaire.pseudo";
const MODE_LABEL = { envoi: "Envois", seminaire: "Séminaire", revue: "Verdict" };

const deck = document.getElementById("deck");
const spacesLink = document.getElementById("spaces-link");
let picked = [];          // fichiers choisis sur l'accueil
let tab = "send";
let renaming = false;     // onglet Envoyer : changer de blaze

// --------------------------------------------------------------- mémoire

function savedPseudo() {
  try { return localStorage.getItem(PSEUDO_KEY) || ""; } catch (err) { return ""; }
}
function savePseudo(p) {
  try { localStorage.setItem(PSEUDO_KEY, p); } catch (err) { /* privé */ }
}
function known() {
  try { return JSON.parse(localStorage.getItem("seminaire.spaces")) || []; } catch (err) { return []; }
}
function goTo(space) {
  try { localStorage.setItem("seminaire.space", JSON.stringify(space)); } catch (err) { /* privé */ }
  location.href = "app.html#/projects";
}

// Compte connecté sur cet appareil (lu dans la session gardée par
// Supabase, sans rien charger). null = pas connecté.
function accountEmail() {
  try {
    const s = JSON.parse(localStorage.getItem("seminaire.auth") || "null");
    return (s && s.user && s.user.email) || null;
  } catch (err) { return null; }
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function drawSpacesLink() {
  const n = known().length;
  spacesLink.hidden = false;
  spacesLink.textContent = n ? "Mes espaces (" + n + ")" : accountEmail() ? "Mon compte" : "Se connecter";
}

// Pas encore connecté : l'email tapé devient le compte (code reçu à cette
// adresse, une fois par appareil), et les espaces de l'appareil le suivent.
async function ensureAccount(form, fail) {
  if (accountEmail()) return true;
  const input = form.querySelector("[name=email]");
  const email = input ? input.value.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    if (input) input.focus();
    fail("Ton email sert de compte (sans mot de passe) : on en a besoin.");
    return false;
  }
  const session = await import("./session.js?v=93");
  await session.ensureAuth();
  const { ensureVerified } = await import("./verify.js?v=93");
  if (await ensureVerified(email, { optional: false }) !== "ok") return false;
  await session.login(email);
  try { localStorage.setItem("seminaire.replyTo", email); } catch (err) { /* privé */ }
  drawSpacesLink();
  return true;
}

// --------------------------------------------------------------- onglets

const field = (name, label, attrs, value) =>
  '<label class="field"><span class="label">' + label + '</span><input class="input" name="' + name + '" ' + attrs +
  ' value="' + esc(value || "") + '"></label>';
const pseudoField = () => field("pseudo", "Ton blaze", 'maxlength="24" autocomplete="nickname" placeholder="Comment on te reconnaît"', savedPseudo());
// Ton email = ton compte. Déjà connecté : une ligne, pas de champ.
function accountField() {
  const acc = accountEmail();
  if (acc) return '<p class="as-who">Connecté : <strong>' + esc(acc) + '</strong> <button type="button" class="link-btn" data-goto-account>compte</button></p>';
  let remembered = "";
  try { remembered = localStorage.getItem("seminaire.replyTo") || ""; } catch (err) { /* privé */ }
  return field("email", "Ton email", 'type="text" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" maxlength="254" placeholder="ton compte, sans mot de passe"', remembered);
}

const VIEWS = {
  send() {
    const mine = known().find((k) => k.mode === "envoi");
    const total = picked.reduce((s, f) => s + f.size, 0);
    return '<form class="deck-form" data-form="send" novalidate>' +
      '<label class="add-files" data-drop>' +
        '<span class="add-circle">' + icon("plus", 26) + "</span>" +
        "<span><strong>" + (picked.length ? "Ajouter d'autres fichiers" : "Ajoute tes fichiers") + "</strong>" +
        "<small>ou glisse-les ici · 2 Go max par fichier</small></span>" +
        '<input type="file" multiple hidden data-files></label>' +
      (picked.length
        ? '<ul class="picked">' + picked.map((f, i) =>
            "<li><span class=\"pk-name\">" + esc(f.name) + '</span><span class="mono">' + formatBytes(f.size) + "</span>" +
            '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-unpick="' + i + '" aria-label="Retirer ' + esc(f.name) + '">' + icon("x", 16) + "</button></li>").join("") +
          '</ul><p class="picked-total mono">' + plural(picked.length, "fichier", "fichiers") + " · " + formatBytes(total) + "</p>"
        : "") +
      (mine && !renaming
        ? '<p class="as-who">Envoyé par <strong>' + esc(savedPseudo() || "toi") + '</strong> <button type="button" class="link-btn" data-rename>changer</button></p>'
        : pseudoField()) +
      accountField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Transférer</button>' +
      '<p class="deck-note">Tu ajouteras les adresses à l\'étape suivante. Sans compte, ni pour toi ni pour eux.</p>' +
    "</form>";
  },
  salon() {
    return '<form class="deck-form" data-form="salon" novalidate>' +
      '<p class="deck-lead">La jam de ton groupe, façon villa en résidence : chacun ajoute ses sons à la file, et vous écoutez ensemble, en direct. Les sons disparaissent au bout de 5 jours.</p>' +
      field("name", "Nom du séminaire", 'maxlength="60" placeholder="Ex : Villa septembre, Studio B"') +
      pseudoField() +
      accountField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Lancer le séminaire</button>' +
      '<p class="deck-note">Tu en deviens le host. Tu invites les membres par email : chacun vérifie son adresse avant d\'entrer.</p>' +
    "</form>";
  },
  revue() {
    return '<form class="deck-form" data-form="revue" novalidate>' +
      '<p class="deck-lead">Tu déposes ton mix, l\'artiste rend son verdict à la seconde près. Tu corriges, tu envoies la v2, il valide.</p>' +
      field("project", "Artiste ou projet", 'maxlength="60" placeholder="Ex : Kenza, EP Nuit blanche"') +
      pseudoField() +
      accountField() +
      '<label class="check-line"><input type="checkbox" name="keep"><span>Ne jamais supprimer les mix<small>Sinon, effacés au bout de 37 jours. Modifiable ensuite.</small></span></label>' +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Demander le verdict</button>' +
      '<p class="deck-note">L\'artiste reçoit une invitation par email et vérifie son adresse avant d\'entrer. Pas de compte.</p>' +
    "</form>";
  },
  join(code) {
    return '<form class="deck-form" data-form="join" novalidate>' +
      '<p class="deck-lead">Le code qu\'on t\'a donné, et ton blaze.</p>' +
      '<label class="field"><span class="label">Code</span><input class="input input-code" name="code" maxlength="8" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ABC123" value="' + esc(code || "") + '"></label>' +
      pseudoField() +
      accountField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Entrer</button>' +
    "</form>";
  },
  invite() {
    return '<div class="deck-form invite-view" data-invite-view><div class="skeleton"></div><div class="skeleton"></div></div>';
  },
  spaces() {
    const list = known();
    const acc = accountEmail();
    const account = acc
      ? '<div class="account-box"><p class="as-who">Connecté : <strong>' + esc(acc) + "</strong></p>" +
          '<p class="deck-note">Tes espaces, envois et blazes te suivent sur tous tes appareils.</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-logout>Se déconnecter de cet appareil</button></div>'
      : '<form class="account-box" data-form="account" novalidate>' +
          '<p class="deck-lead">Retrouve tes espaces sur tous tes appareils. Pas de mot de passe : un code à ton adresse, une fois par appareil.</p>' +
          accountField() +
          '<p class="form-error" data-err hidden></p>' +
          '<button class="btn btn-primary btn-block" type="submit">Se connecter</button></form>';
    if (!list.length) return account + '<p class="deck-lead">' + (acc ? "Aucun espace pour l'instant." : "Aucun espace sur cet appareil.") + "</p>";
    return account +
      '<p class="deck-lead">' + (acc ? "Les espaces de ton compte." : "Les espaces ouverts sur cet appareil.") +
        " Les oublier ne supprime rien ; seul le host peut tout effacer.</p>" +
      '<ul class="my-spaces">' + list.map((k) =>
        '<li data-id="' + esc(k.id) + '">' +
          '<button type="button" class="ms-open" data-open-space>' +
            '<span class="ms-mode">' + (MODE_LABEL[k.mode] || "Séminaire") + "</span>" +
            '<span class="ms-name">' + esc(k.name) + "</span>" +
            '<span class="mono">' + esc(k.code) + "</span></button>" +
          '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-space-menu aria-label="Options pour ' + esc(k.name) + '">' + icon("more", 18) + "</button>" +
        "</li>").join("") + "</ul>";
  }
};

function show(next, arg) {
  tab = next;
  for (const b of document.querySelectorAll(".deck-tabs [data-tab]")) {
    b.setAttribute("aria-selected", String(b.dataset.tab === next));
  }
  deck.innerHTML = VIEWS[next](arg);
  deck.dataset.view = next;
  const code = deck.querySelector("[name=code]");
  if (code) code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
}

// ---------------------------------------------------- fichiers choisis

function addFiles(list) {
  const incoming = Array.from(list || []);
  const refused = incoming.filter((f) => isBlocked(f.name));
  for (const f of refused) toast(f.name + " : les programmes ne sont pas acceptés", "err");
  const heavy = incoming.filter((f) => !isBlocked(f.name) && f.size > FILE_MAX);
  for (const f of heavy) toast(f.name + " : trop lourd, 2 Go max par fichier", "err");
  picked = picked.concat(incoming.filter((f) => !isBlocked(f.name) && f.size > 0 && f.size <= FILE_MAX));
  show("send");
}

deck.addEventListener("change", (e) => {
  if (e.target.matches("[data-files]")) { addFiles(e.target.files); e.target.value = ""; }
});

// glisser-déposer n'importe où sur la page
let depth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
document.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; document.body.classList.add("is-dropping"); });
document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove("is-dropping"); });
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  depth = 0;
  document.body.classList.remove("is-dropping");
  addFiles(e.dataTransfer.files);
});

// ------------------------------------------------------------ actions

deck.addEventListener("click", async (e) => {
  const un = e.target.closest("[data-unpick]");
  if (un) { picked.splice(Number(un.dataset.unpick), 1); show("send"); return; }

  const li = e.target.closest(".my-spaces li");
  if (!li) return;
  const k = known().find((x) => x.id === li.dataset.id);
  if (!k) return;
  if (e.target.closest("[data-open-space]")) { goTo(k); return; }
  if (e.target.closest("[data-space-menu]")) spaceMenu(k);
});

function spaceMenu(k) {
  actionSheet(k.name, [
    { label: "Ouvrir", icon: "chevron", run: () => goTo(k) },
    {
      label: "Oublier sur cet appareil", icon: "logout",
      run: async () => {
        const session = await import("./session.js?v=93");
        session.forgetSpace(k.id);
        toast("\"" + k.name + "\" n'apparaît plus ici. Rien n'a été supprimé.", "ok");
        drawSpacesLink();
        show(known().length ? "spaces" : "send");
      }
    },
    k.isHost ? {
      label: "Supprimer l'espace et tous ses fichiers", icon: "trash", danger: true,
      run: async () => {
        const ok = await confirmSheet(
          "\"" + k.name + "\" sera effacé pour tout le monde : fichiers, envois, commentaires. C'est définitif.",
          { ok: "Tout supprimer", danger: true, title: "Supprimer l'espace" });
        if (!ok) return;
        try {
          const session = await import("./session.js?v=93");
          await session.ensureAuth();
          const api = await import("./api.js?v=93");
          await api.deleteSpace(k.id);
          session.forgetSpace(k.id);
          toast("\"" + k.name + "\" a été supprimé.", "ok");
          drawSpacesLink();
          show(known().length ? "spaces" : "send");
        } catch (err) {
          toast(errorText(err), "err");
        }
      }
    } : null
  ]);
}

deck.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const kind = form.dataset.form;
  if (kind === "invite") return;   // formulaire géré par openInvite()
  const err = form.querySelector("[data-err]");
  const btn = form.querySelector("[type=submit]");
  const val = (n) => { const i = form.querySelector("[name=" + n + "]"); return i ? i.value.trim() : ""; };
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };
  err.hidden = true;

  let mine = kind === "send" && known().find((k) => k.mode === "envoi");
  const pseudoBefore = savedPseudo();
  const pseudo = mine && !renaming ? pseudoBefore : val("pseudo");
  if (kind !== "account" && !mine && pseudo.length < 2) return fail("Ton blaze doit faire au moins 2 caractères.");
  if (kind === "join" && val("code").length < 5) return fail("Le code fait au moins 5 caractères.");
  if (kind === "salon" && !val("name")) return fail("Donne un nom à ton séminaire.");
  if (kind === "revue" && !val("project")) return fail("Pour quel artiste ou quel projet ?");

  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Un instant…</span>';
  try {
    // tout se rattache à un compte : email vérifié d'abord
    if (!(await ensureAccount(form, fail))) {
      btn.disabled = false;
      btn.textContent = label;
      return;
    }
    if (kind === "account") { show("spaces"); return; }
    // connecté à l'instant : le compte a peut-être déjà son espace d'envoi
    if (kind === "send" && !mine) mine = known().find((k) => k.mode === "envoi");

    if (pseudo) savePseudo(pseudo);

    // les fichiers déposés ici repartent à l'étape suivante
    if (kind === "send" && picked.length) {
      const kept = await putPending(picked);
      if (!kept) {
        sessionStorage.setItem("seminaire.readd", picked.reduce((s, f) => s + f.size, 0) > MAX_BYTES ? "lourd" : "perdu");
      }
    }
    if (mine) {
      // nouveau blaze : dans l'espace d'envoi, et dans son nom "Envois de ..."
      if (renaming && pseudo !== pseudoBefore) {
        const session = await import("./session.js?v=93");
        await session.renameMe(mine.id, pseudo);
        if (/^Envois de /.test(mine.name)) await session.renameSpace(mine.id, "Envois de " + pseudo).catch(() => {});
      }
      renaming = false;
      goTo(known().find((k) => k.id === mine.id) || mine);
      return;
    }

    const session = await import("./session.js?v=93");
    if (kind === "join") await session.joinSpace(val("code"), pseudo);
    else if (kind === "salon") await session.createSpace(val("name"), "seminaire", pseudo);
    else if (kind === "revue") {
      const created = await session.createSpace(val("project"), "revue", pseudo);
      if (form.querySelector("[name=keep]").checked) {
        const api = await import("./api.js?v=93");
        await api.updateSpace(created.id, { purge_at: null }).catch((err) => {
          try { sessionStorage.setItem("seminaire.flash", errorText(err)); } catch (e3) { /* privé */ }
        });
      }
    }
    else await session.createSpace("Envois de " + pseudo, "envoi", pseudo);
    location.href = "app.html#/projects";
  } catch (e2) {
    fail(errorText(e2));
    btn.disabled = false;
    btn.textContent = label;
  }
});

document.addEventListener("click", async (e) => {
  const b = e.target.closest(".deck-tabs [data-tab], .deck-foot [data-tab]");
  if (b) show(b.dataset.tab);
  if (e.target.closest("[data-goto-account]")) show("spaces");
  if (e.target.closest("[data-logout]")) {
    const ok = await confirmSheet("Rien n'est supprimé : tu retrouveras tout en te reconnectant avec ton email.",
      { ok: "Se déconnecter", title: "Se déconnecter de cet appareil" });
    if (!ok) return;
    const session = await import("./session.js?v=93");
    await session.logout();
    drawSpacesLink();
    show("send");
    toast("Déconnecté de cet appareil", "ok");
  }
  if (e.target.closest("[data-rename]")) {
    renaming = true;
    show("send");
    const input = deck.querySelector("[name=pseudo]");
    if (input) { input.focus(); input.select(); }
  }
});

// ------------------------------------------------ invitation par email
// /i/<jeton> (ou index.html?i=) : l'invité choisit son blaze, reçoit un code à
// l'adresse invitée, le tape, et entre. Appareil déjà vérifié : il entre
// directement.

async function openInvite(token) {
  show("invite");
  const box = deck.querySelector("[data-invite-view]");
  const session = await import("./session.js?v=93");
  let info;
  try {
    info = await session.inviteInfo(token);
  } catch (err) {
    box.innerHTML = '<p class="form-error">' + esc(errorText(err)) + "</p>" +
      '<button type="button" class="btn btn-block" data-tab="join">J\'ai un code</button>';
    return;
  }
  const revue = info.mode === "revue";
  const back = info.returning || info.member;
  box.innerHTML =
    '<form data-form="invite" novalidate>' +
      '<p class="invite-kind">' + (revue ? "Verdict" : "Séminaire") + "</p>" +
      '<h2 class="invite-title">' + esc(info.space_name) + "</h2>" +
      '<p class="deck-lead">' + (info.host ? "<strong>" + esc(info.host) + "</strong> t'invite. " : "") +
        "Invitation pour <strong>" + esc(info.email) + "</strong>." + "</p>" +
      (back
        ? '<p class="as-who">Tu y es déjà, sous le blaze <strong>' + esc(back) + "</strong>." + (info.verified ? "" : " Vérifie ton email pour y entrer depuis cet appareil.") + "</p>"
        : pseudoField()) +
      (info.verified
        ? ""
        : '<div class="invite-codebox" data-code-box hidden>' +
            '<label class="field"><span class="label">Code reçu par email</span>' +
            '<input class="input input-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label>' +
            '<p class="deck-note" data-code-note></p>' +
          "</div>") +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit" data-go>' + (info.verified ? "Entrer" : "Recevoir mon code") + "</button>" +
      (info.verified ? '<p class="deck-note">Adresse déjà vérifiée sur cet appareil.</p>'
        : '<p class="deck-note">Le code part à l\'adresse invitée : seul son propriétaire peut entrer.</p>') +
    "</form>";

  const form = box.querySelector("form");
  const err = form.querySelector("[data-err]");
  const go = form.querySelector("[data-go]");
  const codeBox = form.querySelector("[data-code-box]");
  let codeSent = false;
  const fail = (m) => { err.textContent = m; err.hidden = false; };

  const enter = async () => {
    const pseudoInput = form.querySelector("[name=pseudo]");
    const pseudo = pseudoInput ? pseudoInput.value.trim() : "";
    if (pseudoInput && pseudo.length < 2) { pseudoInput.focus(); return fail("Ton blaze doit faire au moins 2 caractères."); }
    const code = codeBox ? form.querySelector("[name=code]").value.replace(/\D/g, "") : "";
    if (codeBox && code.length !== 6) { form.querySelector("[name=code]").focus(); return fail("Le code fait 6 chiffres."); }
    go.disabled = true;
    go.innerHTML = '<span class="spinner"></span><span>Un instant…</span>';
    try {
      if (pseudo) savePseudo(pseudo);
      await session.acceptInvite(token, code, pseudo);
      location.href = "app.html#/projects";
    } catch (e2) {
      fail(errorText(e2));
      go.disabled = false;
      go.textContent = "Entrer";
    }
  };

  const sendCode = async () => {
    const pseudoInput = form.querySelector("[name=pseudo]");
    if (pseudoInput && pseudoInput.value.trim().length < 2) { pseudoInput.focus(); return fail("Choisis d'abord ton blaze."); }
    go.disabled = true;
    go.innerHTML = '<span class="spinner"></span><span>Envoi du code…</span>';
    try {
      const r = await session.inviteSendCode(token);
      if (r && r.verified) return enter();
      codeSent = true;
      codeBox.hidden = false;
      form.querySelector("[data-code-note]").innerHTML = "Envoyé à " + esc(info.email) +
        ' (regarde aussi les spams). <button type="button" class="link-btn" data-resend>Renvoyer</button>';
      go.disabled = false;
      go.textContent = "Entrer";
      const input = form.querySelector("[name=code]");
      input.focus();
      input.addEventListener("input", () => {
        input.value = input.value.replace(/\D/g, "").slice(0, 6);
        if (input.value.length === 6) enter();
      });
    } catch (e2) {
      fail(errorText(e2));
      go.disabled = false;
      go.textContent = "Recevoir mon code";
    }
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    err.hidden = true;
    if (info.verified || codeSent) enter();
    else sendCode();
  });
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-resend]")) { codeSent = false; sendCode(); }
  });
}

// -------------------------------------------------- compteur de CO₂
// Pure blague : ~49 kg/h, soit un trajet Paris-Marseille en SUV toutes les
// deux heures. Affiché au gramme près, sérieux comme un tableau de bord.
const co2 = document.getElementById("co2");
const t0 = performance.now();
const fmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
setInterval(() => {
  if (document.hidden) return;
  co2.textContent = fmt.format(((performance.now() - t0) / 1000) * 0.0137) + " kg";
}, 200);

// ------------------------------------------ engagements et FAQ animés
// Les blocs apparaissent au défilement ; les grosses stats comptent
// jusqu'à leur valeur (100 %, 1 blaze, 0 trace).

function countUp(el) {
  const to = Number(el.dataset.count);
  const from = Number(el.dataset.from || 0);
  const t0 = performance.now();
  const dur = 1100;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(from + (to - from) * ease));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function mountReveal() {
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("js-reveal");
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      const n = e.target.querySelector("[data-count]");
      if (n) { n.textContent = n.dataset.from || "0"; countUp(n); }
      seen.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -12% 0px" });
  for (const el of document.querySelectorAll(".reveal")) seen.observe(el);
}

// ------------------------------------------------------------ démarrage

drawSpacesLink();
mountReveal();
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon, 20);

// Connecté : "Mes espaces" à jour depuis le serveur (autres appareils)
if (accountEmail()) {
  import("./session.js?v=93").then((m) => m.syncSpaces()).then(() => {
    drawSpacesLink();
    if (tab === "spaces") show("spaces");
  }).catch(() => {});
}

// liens courts /i/<jeton> et /c/<code>, ou anciens ?i= et ?c=
const params = new URLSearchParams(location.search);
const short = location.pathname.match(/^\/(i|c)\/([A-Za-z0-9]+)\/?$/) || [];
const rawInvite = short[1] === "i" ? short[2] : (params.get("i") || "");
const inviteToken = /^[0-9a-fA-F]{32}$/.test(rawInvite) ? rawInvite.toLowerCase() : rawInvite;
const invited = ((short[1] === "c" ? short[2] : params.get("c")) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (/^(?:[0-9a-f]{32}|[A-Za-z0-9]{12})$/.test(inviteToken)) openInvite(inviteToken);
else if (invited) show("join", invited.slice(0, 8));
else show("send");

// Légende du décor et bouton "Fond suivant" (le décor lui-même est posé
// par wallpaper-boot.js, avant le premier affichage).
mountWallpaperNote(document.querySelector("[data-wallpaper]"));
// le grand titre qui bouge et qui fume
mountClaim(document.querySelector(".claim"));
