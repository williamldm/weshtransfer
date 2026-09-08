// Ecran d'entree : code + pseudo. Aucune notion de compte.

const form = document.getElementById("join-form");
const codeInput = document.getElementById("code");
const pseudoInput = document.getElementById("pseudo");
const submitBtn = document.getElementById("join-submit");
const errorBox = document.getElementById("join-error");

const PSEUDO_KEY = "seminaire.pseudo";

// Code pre-rempli par le lien partage : ...index.html?c=ABC123
const params = new URLSearchParams(location.search);
const fromLink = params.get("c") || params.get("code");
if (fromLink) codeInput.value = fromLink.toUpperCase().slice(0, 8);

// On se souvient du blaze : au bout de trois jours de villa, personne n'a
// envie de le retaper a chaque fois.
try {
  const saved = localStorage.getItem(PSEUDO_KEY);
  if (saved) pseudoInput.value = saved;
} catch (err) {
  // navigation privee : sans importance
}

// Le focus part sur le champ encore vide
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

function clearError() {
  errorBox.hidden = true;
}

const MESSAGES = {
  CODE_INVALIDE: "Ce code ne correspond a aucun espace.",
  ESPACE_EXPIRE: "Cet espace a expire, les fichiers ont ete supprimes.",
  ESPACE_VERROUILLE: "Cet espace n accepte plus de nouveaux arrivants.",
  PSEUDO_PRIS: "Ce blaze est deja pris dans cet espace, prends-en un autre.",
  NON_AUTHENTIFIE: "Connexion impossible, reessaie."
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const code = codeInput.value.trim();
  const pseudo = pseudoInput.value.trim();

  if (code.length < 5) return showError("Le code fait au moins 5 caracteres.");
  if (pseudo.length < 2) return showError("Il faut au moins 2 caracteres.");

  submitBtn.disabled = true;
  submitBtn.textContent = "Connexion...";

  try {
    // Import dynamique : tant que Supabase n est pas configure (js/config.js
    // absent), l ecran reste utilisable et le message est explicite.
    const session = await import("./session.js?v=1").catch(() => null);
    if (!session) {
      throw new Error("Supabase n est pas encore configure (js/config.js).");
    }

    try {
      localStorage.setItem(PSEUDO_KEY, pseudo);
    } catch (err) { /* navigation privee */ }

    await session.joinSpace(code, pseudo);
    location.href = "app.html?v=1#/projects";
  } catch (err) {
    const key = String(err && err.message || "").match(/[A-Z_]{5,}/);
    showError(key && MESSAGES[key[0]] ? MESSAGES[key[0]] : (err.message || "Erreur inconnue."));
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrer";
  }
});
