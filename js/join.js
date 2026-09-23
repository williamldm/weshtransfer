// Écran d'entrée : code + blaze. Aucune notion de compte.

import { errorText, esc } from "./ui.js?v=12";

const form = document.getElementById("join-form");
const codeInput = document.getElementById("code");
const pseudoInput = document.getElementById("pseudo");
const submitBtn = document.getElementById("join-submit");
const errorBox = document.getElementById("join-error");
const resume = document.getElementById("resume");

const PSEUDO_KEY = "seminaire.pseudo";

// Code pré-rempli par le lien d'invitation : index.html?c=ABC123
const params = new URLSearchParams(location.search);
const fromLink = (params.get("c") || params.get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
if (fromLink) codeInput.value = fromLink.slice(0, 8);

// Espaces déjà rejoints sur cet appareil : un raccourci par espace.
try {
  const known = (JSON.parse(localStorage.getItem("seminaire.spaces")) || [])
    .filter((k) => k && k.id && (!fromLink || fromLink === k.code));
  if (known.length) {
    resume.hidden = false;
    resume.innerHTML = known.map((k) =>
      '<button type="button" class="resume" data-id="' + esc(k.id) + '">' +
        "<span>Reprendre</span><strong>" + esc(k.name) + '</strong><span class="mono">' + esc(k.code) + "</span></button>"
    ).join("");
    resume.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      const k = b && known.find((x) => x.id === b.dataset.id);
      if (!k) return;
      localStorage.setItem("seminaire.space", JSON.stringify(k));
      location.href = "app.html#/projects";
    });
  }
} catch (err) { /* rien d'enregistré */ }

// On se souvient du blaze : au bout de trois jours de villa, personne n'a
// envie de le retaper.
try {
  const pseudo = localStorage.getItem(PSEUDO_KEY);
  if (pseudo) pseudoInput.value = pseudo;
} catch (err) { /* navigation privée */ }

if (codeInput.value && !pseudoInput.value) pseudoInput.focus();
else if (!codeInput.value) codeInput.focus();

codeInput.addEventListener("input", () => {
  const clean = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean !== codeInput.value) codeInput.value = clean;
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const code = codeInput.value.trim();
  const pseudo = pseudoInput.value.trim();

  if (code.length < 5) { codeInput.focus(); return showError("Le code fait au moins 5 caractères."); }
  if (pseudo.length < 2) { pseudoInput.focus(); return showError("Ton blaze doit faire au moins 2 caractères."); }

  submitBtn.disabled = true;
  submitBtn.textContent = "Connexion...";

  try {
    // Import dynamique : si Supabase n'est pas configuré, l'écran reste
    // utilisable et l'erreur est explicite.
    const session = await import("./session.js?v=12");
    try { localStorage.setItem(PSEUDO_KEY, pseudo); } catch (err) { /* privé */ }
    await session.joinSpace(code, pseudo);
    location.href = "app.html#/projects";
  } catch (err) {
    showError(errorText(err));
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrer";
  }
});
