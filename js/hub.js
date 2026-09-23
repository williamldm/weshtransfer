// Page d'accueil WeshTransfer : envoyer, créer un salon, rejoindre.
// Chaque action ouvre une petite feuille ; session.js n'est chargé qu'au
// moment d'agir, la page reste légère.

import { icon } from "./icons.js?v=16";
import { esc, h, openSheet, errorText } from "./ui.js?v=16";

const PSEUDO_KEY = "seminaire.pseudo";

function savedPseudo() {
  try { return localStorage.getItem(PSEUDO_KEY) || ""; } catch (err) { return ""; }
}

function knownSpaces() {
  try { return JSON.parse(localStorage.getItem("seminaire.spaces")) || []; } catch (err) { return []; }
}

function goTo(space) {
  try { localStorage.setItem("seminaire.space", JSON.stringify(space)); } catch (err) { /* privé */ }
  location.href = "app.html#/projects";
}

// icônes des cartes
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon, 20);

// ---------------------------------------------------- espaces déjà connus
const known = knownSpaces();
const resume = document.getElementById("resume");
if (known.length) {
  resume.hidden = false;
  resume.innerHTML = known.slice(0, 4).map((k) =>
    '<button type="button" class="resume" data-id="' + esc(k.id) + '">' +
      "<span>" + ({ envoi: "Envois", revue: "Retours" }[k.mode] || "Salon") + "</span><strong>" + esc(k.name) +
      '</strong><span class="mono">' + esc(k.code) + "</span></button>").join("");
  resume.addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    const k = b && known.find((x) => x.id === b.dataset.id);
    if (k) goTo(k);
  });
}

// ------------------------------------------------------------ feuilles

const FORMS = {
  send: {
    title: "Envoyer des fichiers",
    intro: "Juste ton blaze : c'est le nom que verront tes destinataires.",
    fields: ["pseudo"],
    button: "C'est parti"
  },
  salon: {
    title: "Créer un salon",
    intro: "Tu en deviens le host. Tu recevras un code à 6 caractères à partager avec ton groupe.",
    fields: ["name", "pseudo"],
    button: "Créer le salon"
  },
  revue: {
    title: "Faire valider un mix",
    intro: "Tu déposes tes mix, l'artiste les écoute et commente à la seconde près. Tu coches au fur et à mesure. Personne n'a besoin de compte.",
    fields: ["project", "pseudo"],
    button: "Ouvrir l'espace de retours"
  },
  join: {
    title: "Rejoindre un espace",
    intro: "Le code qu'on t'a donné, et ton blaze.",
    fields: ["code", "pseudo"],
    button: "Entrer"
  }
};

const FIELD = {
  code: (v) => '<label class="field"><span class="label">Code</span><input class="input input-code" name="code" maxlength="8" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="ABC123" value="' + esc(v || "") + '"></label>',
  name: () => '<label class="field"><span class="label">Nom du salon</span><input class="input" name="name" maxlength="60" placeholder="Ex : Villa septembre, Studio B"></label>',
  project: () => '<label class="field"><span class="label">Artiste ou projet</span><input class="input" name="project" maxlength="60" placeholder="Ex : Kenza, EP Nuit blanche"></label>',
  pseudo: () => '<label class="field"><span class="label">Ton blaze</span><input class="input" name="pseudo" maxlength="24" autocomplete="nickname" placeholder="Comment on te reconnaît" value="' + esc(savedPseudo()) + '"></label>'
};

function open(kind, prefillCode) {
  // Déjà un espace d'envoi sur cet appareil : on y retourne directement.
  if (kind === "send") {
    const mine = known.find((k) => k.mode === "envoi");
    if (mine) return goTo(mine);
  }

  const f = FORMS[kind];
  const body = h(
    '<form class="hub-form" novalidate>' +
      '<p class="sheet-text">' + f.intro + "</p>" +
      f.fields.map((name) => FIELD[name](prefillCode)).join("") +
      '<p class="form-error" data-err hidden></p>' +
      '<button class="btn btn-primary btn-block btn-xl" type="submit">' + f.button + "</button>" +
    "</form>"
  );
  openSheet({ title: f.title, body });

  const first = body.querySelector("input:not([value]), input[value='']") || body.querySelector("input");
  setTimeout(() => first && first.focus(), 80);

  const code = body.querySelector("[name=code]");
  if (code) code.addEventListener("input", () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = body.querySelector("[data-err]");
    const btn = body.querySelector("[type=submit]");
    const val = (n) => { const i = body.querySelector("[name=" + n + "]"); return i ? i.value.trim() : ""; };
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    err.hidden = true;

    const pseudo = val("pseudo");
    if (pseudo.length < 2) return fail("Ton blaze doit faire au moins 2 caractères.");
    if (kind === "join" && val("code").length < 5) return fail("Le code fait au moins 5 caractères.");
    if (kind === "salon" && !val("name")) return fail("Donne un nom à ton salon.");
    if (kind === "revue" && !val("project")) return fail("Pour quel artiste ou quel projet ?");

    btn.disabled = true;
    btn.textContent = "Un instant...";
    try {
      try { localStorage.setItem(PSEUDO_KEY, pseudo); } catch (e2) { /* privé */ }
      const session = await import("./session.js?v=16");
      if (kind === "join") await session.joinSpace(val("code"), pseudo);
      else if (kind === "salon") await session.createSpace(val("name"), "seminaire", pseudo);
      else if (kind === "revue") await session.createSpace(val("project"), "revue", pseudo);
      else await session.createSpace("Envois de " + pseudo, "envoi", pseudo);
      location.href = "app.html#/projects";
    } catch (e2) {
      fail(errorText(e2));
      btn.disabled = false;
      btn.textContent = f.button;
    }
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-open]");
  if (b) open(b.dataset.open);
});

// Lien d'invitation : index.html?c=ABC123 ouvre directement "Rejoindre"
const invited = (new URLSearchParams(location.search).get("c") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (invited) open("join", invited.slice(0, 8));
