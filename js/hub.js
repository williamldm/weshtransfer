// Accueil WeshTransfer : une carte à onglets posée sur la centrale.
// Envoyer (dépôt direct des fichiers), Salon, Retours, J'ai un code, et
// les espaces déjà ouverts sur cet appareil (ouvrir, oublier, supprimer).
// session.js / api.js ne sont chargés qu'au moment d'agir.

import { icon } from "./icons.js?v=28";
import { esc, h, errorText, formatBytes, plural, actionSheet, confirmSheet, toast } from "./ui.js?v=28";
import { isBlocked } from "./files.js?v=28";
import { putPending, MAX_BYTES } from "./pending.js?v=28";

const PSEUDO_KEY = "seminaire.pseudo";
const MODE_LABEL = { envoi: "Envois", seminaire: "Salon", revue: "Retours" };

const deck = document.getElementById("deck");
const spacesLink = document.getElementById("spaces-link");
let picked = [];          // fichiers choisis sur l'accueil
let tab = "send";

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

function drawSpacesLink() {
  const n = known().length;
  spacesLink.hidden = !n;
  spacesLink.textContent = "Mes espaces (" + n + ")";
}

// --------------------------------------------------------------- onglets

const field = (name, label, attrs, value) =>
  '<label class="field"><span class="label">' + label + '</span><input class="input" name="' + name + '" ' + attrs +
  ' value="' + esc(value || "") + '"></label>';
const pseudoField = () => field("pseudo", "Ton blaze", 'maxlength="24" autocomplete="nickname" placeholder="Comment on te reconnaît"', savedPseudo());

const VIEWS = {
  send() {
    const mine = known().find((k) => k.mode === "envoi");
    const total = picked.reduce((s, f) => s + f.size, 0);
    return '<form class="deck-form" data-form="send" novalidate>' +
      '<label class="add-files" data-drop>' +
        '<span class="add-circle">' + icon("plus", 26) + "</span>" +
        "<span><strong>" + (picked.length ? "Ajouter d'autres fichiers" : "Ajoute tes fichiers") + "</strong>" +
        "<small>ou glisse-les ici · 3 Go max par fichier</small></span>" +
        '<input type="file" multiple hidden data-files></label>' +
      (picked.length
        ? '<ul class="picked">' + picked.map((f, i) =>
            "<li><span class=\"pk-name\">" + esc(f.name) + '</span><span class="mono">' + formatBytes(f.size) + "</span>" +
            '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-unpick="' + i + '" aria-label="Retirer ' + esc(f.name) + '">' + icon("x", 16) + "</button></li>").join("") +
          '</ul><p class="picked-total mono">' + plural(picked.length, "fichier", "fichiers") + " · " + formatBytes(total) + "</p>"
        : "") +
      (mine
        ? '<p class="as-who">Envoyé par <strong>' + esc(savedPseudo() || "toi") + "</strong> depuis \"" + esc(mine.name) + "\"</p>"
        : pseudoField()) +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Transférer</button>' +
      '<p class="deck-note">Tu ajouteras les adresses à l\'étape suivante. Sans compte, ni pour toi ni pour eux.</p>' +
    "</form>";
  },
  salon() {
    return '<form class="deck-form" data-form="salon" novalidate>' +
      '<p class="deck-lead">Un espace pour ton groupe, ta résidence, ton séminaire. Chacun y dépose ses sons ; versions et commentaires horodatés arrivent en temps réel.</p>' +
      field("name", "Nom du salon", 'maxlength="60" placeholder="Ex : Villa septembre, Studio B"') +
      pseudoField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Ouvrir le salon</button>' +
      '<p class="deck-note">Tu en deviens le host. Tu recevras un code à 6 caractères à partager.</p>' +
    "</form>";
  },
  revue() {
    return '<form class="deck-form" data-form="revue" novalidate>' +
      '<p class="deck-lead">Tu déposes ton mix, l\'artiste le commente à la seconde près. Tu coches ce que tu as corrigé, tu envoies la v2, il valide.</p>' +
      field("project", "Artiste ou projet", 'maxlength="60" placeholder="Ex : Kenza, EP Nuit blanche"') +
      pseudoField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Ouvrir l\'espace de retours</button>' +
      '<p class="deck-note">L\'artiste n\'a besoin que du lien que tu lui enverras.</p>' +
    "</form>";
  },
  join(code) {
    return '<form class="deck-form" data-form="join" novalidate>' +
      '<p class="deck-lead">Le code qu\'on t\'a donné, et ton blaze.</p>' +
      '<label class="field"><span class="label">Code</span><input class="input input-code" name="code" maxlength="8" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ABC123" value="' + esc(code || "") + '"></label>' +
      pseudoField() +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">Entrer</button>' +
    "</form>";
  },
  spaces() {
    const list = known();
    if (!list.length) return '<p class="deck-lead">Aucun espace sur cet appareil.</p>';
    return '<p class="deck-lead">Les espaces ouverts sur cet appareil. Les oublier ne supprime rien ; seul le host peut tout effacer.</p>' +
      '<ul class="my-spaces">' + list.map((k) =>
        '<li data-id="' + esc(k.id) + '">' +
          '<button type="button" class="ms-open" data-open-space>' +
            '<span class="ms-mode">' + (MODE_LABEL[k.mode] || "Salon") + "</span>" +
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
  picked = picked.concat(incoming.filter((f) => !isBlocked(f.name) && f.size > 0));
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
        const session = await import("./session.js?v=28");
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
          const session = await import("./session.js?v=28");
          await session.ensureAuth();
          const api = await import("./api.js?v=28");
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
  const err = form.querySelector("[data-err]");
  const btn = form.querySelector("[type=submit]");
  const val = (n) => { const i = form.querySelector("[name=" + n + "]"); return i ? i.value.trim() : ""; };
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };
  err.hidden = true;

  const mine = kind === "send" && known().find((k) => k.mode === "envoi");
  const pseudo = mine ? savedPseudo() : val("pseudo");
  if (!mine && pseudo.length < 2) return fail("Ton blaze doit faire au moins 2 caractères.");
  if (kind === "join" && val("code").length < 5) return fail("Le code fait au moins 5 caractères.");
  if (kind === "salon" && !val("name")) return fail("Donne un nom à ton salon.");
  if (kind === "revue" && !val("project")) return fail("Pour quel artiste ou quel projet ?");

  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>Un instant…</span>';
  try {
    if (pseudo) savePseudo(pseudo);

    // les fichiers déposés ici repartent à l'étape suivante
    if (kind === "send" && picked.length) {
      const kept = await putPending(picked);
      if (!kept) {
        sessionStorage.setItem("seminaire.readd", picked.reduce((s, f) => s + f.size, 0) > MAX_BYTES ? "lourd" : "perdu");
      }
    }
    if (mine) { goTo(mine); return; }

    const session = await import("./session.js?v=28");
    if (kind === "join") await session.joinSpace(val("code"), pseudo);
    else if (kind === "salon") await session.createSpace(val("name"), "seminaire", pseudo);
    else if (kind === "revue") await session.createSpace(val("project"), "revue", pseudo);
    else await session.createSpace("Envois de " + pseudo, "envoi", pseudo);
    location.href = "app.html#/projects";
  } catch (e2) {
    fail(errorText(e2));
    btn.disabled = false;
    btn.textContent = label;
  }
});

document.addEventListener("click", (e) => {
  const b = e.target.closest(".deck-tabs [data-tab], .deck-foot [data-tab]");
  if (b) show(b.dataset.tab);
});

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

// ------------------------------------------------------------ démarrage

drawSpacesLink();
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon, 20);

const invited = (new URLSearchParams(location.search).get("c") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (invited) show("join", invited.slice(0, 8));
else show("send");
