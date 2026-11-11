// Le grand titre de l'accueil, vivant : "Le transfert de fichiers le moins
// écoresponsable du marché."
//
//   - à l'arrivée, les mots montent un par un, comme sortis de la fumée ;
//   - "le moins écoresponsable" brûle : les lettres ondulent (air chaud) et
//     une vague de feu les traverse ;
//   - le titre fume : des bouffées de la matière du décor montent des mots ;
//   - une lettre survolée saute ; au téléphone, un tap fait passer une vague.
//
// Le texte reste lisible par les lecteurs d'écran (aria-label), le découpage
// en lettres leur est caché. Rien ne bouge avec "réduire les animations".

import { isThc } from "./mode.js?v=141";

// Le grand titre change d'une visite à l'autre. [début, partie en feu, fin] :
// la partie du milieu est celle qui brûle, elle finit la phrase quand il
// n'y a pas de fin (le point est alors dedans, sinon il se décollerait).
// Première visite : la phrase de marque ; ensuite, toutes les autres dans
// un ordre mélangé, sans répétition avant d'avoir fait le tour.
const CLAIMS_POLLUTION = [
  ["Le transfert de fichiers", "le moins écoresponsable", "du marché."],
  ["Tes fichiers voyagent", "en jet privé."],
  ["Chaque mégaoctet fait", "fondre un glaçon", "quelque part."],
  ["Le cloud,", "mais au charbon."],
  ["Envoie lourd.", "La planète encaisse."],
  ["Tes stems partent", "en première classe."],
  ["Du 24 bits,", "zéro scrupule."],
  ["Livré vite.", "Livré sale."],
  ["Chaque envoi", "rallume une centrale."],
  ["Plus lourd, plus loin,", "plus polluant."],
  ["Tu télécharges,", "la banquise fond."],
  ["Ton mix pèse lourd.", "Son bilan carbone aussi."],
  ["Zéro compression.", "Zéro remords."],
  ["Le transfert qui", "chauffe la planète", "pour toi."]
];
// Mode THC : mêmes règles, autre matière.
const CLAIMS_THC = [
  ["Le transfert de fichiers", "le plus défoncé", "du marché."],
  ["Tes fichiers arrivent.", "Tranquille."],
  ["Envoie lourd.", "Plane léger."],
  ["Le cloud,", "mais en nuage de fumée."],
  ["Du 24 bits,", "zéro pression."],
  ["Livré vite.", "Enfin, vite..."],
  ["Chaque envoi", "arrose une plante."],
  ["Ton mix tourne.", "La pièce aussi."],
  ["Zéro compression.", "Zéro stress."],
  ["On a oublié", "ce qu'on voulait dire."],
  ["Peace, love", "et fichiers lourds."],
  ["Fais tourner", "le lien."],
  ["Tes stems voyagent", "en combi."],
  ["Un envoi,", "deux taffes,", "c'est parti."],
  ["Ça part quand ça part.", "C'est-à-dire tout de suite."],
  ["Écoute avant de télécharger.", "Deux fois, si t'as oublié."],
  ["La basse est grasse.", "L'herbe aussi."],
  ["Roulé à la main,", "livré par câble."],
  ["Ton refrain reste en tête.", "Le reste, moins."],
  ["Pas de compte.", "Pas de prise de tête."],
  ["Du son,", "du vert,", "du calme."],
  ["4 h 20 :", "l'heure d'envoyer."]
];
const CLAIMS = isThc ? CLAIMS_THC : CLAIMS_POLLUTION;
const CLAIM_KEY = isThc ? "weshtransfer.claims.thc" : "weshtransfer.claims";

function pickClaim() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(CLAIM_KEY) || "null"); } catch (err) { /* privé */ }
  let deck = st && Array.isArray(st.deck) ? st.deck.filter((n) => Number.isInteger(n) && n >= 0 && n < CLAIMS.length) : null;
  let pick;
  if (!st) pick = 0;                                // tout premier passage : la phrase de marque
  else {
    if (!deck || !deck.length) {
      // nouveau tour : tout sauf la phrase qu'on vient de voir, mélangé
      deck = CLAIMS.map((c, i) => i).filter((i) => i !== st.last);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
    }
    pick = deck.shift();
  }
  try { localStorage.setItem(CLAIM_KEY, JSON.stringify({ last: pick, deck: deck || [] })); } catch (err) { /* privé */ }
  return CLAIMS[pick] || CLAIMS[0];
}

const calm = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function splitWords(text, from) {
  const frag = document.createDocumentFragment();
  let i = from;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); continue; }
    const w = document.createElement("span");
    w.className = "cw";
    w.style.setProperty("--i", String(i++));
    frag.appendChild(w);
    w.textContent = part;
  }
  return { frag, next: i };
}

// Les mots du milieu, lettre par lettre (pour l'onde et la vague de feu)
function splitLetters(word, offset) {
  const text = word.textContent;
  word.textContent = "";
  let j = offset;
  for (const ch of text) {
    const l = document.createElement("span");
    l.className = "cl";
    l.style.setProperty("--j", String(j++));
    l.textContent = ch;
    word.appendChild(l);
  }
  return j;
}

// Pose une phrase dans le titre : mots en <span class="cw">, lettres de
// la partie en feu en <span class="cl">.
function build(claim) {
  const [before, hot, after] = pickClaim();
  const em = document.createElement("em");
  em.textContent = hot;
  claim.textContent = "";
  claim.append(before + " ", em, after ? " " + after : "");
  const full = claim.textContent.replace(/\s+/g, " ").trim();
  claim.setAttribute("aria-label", full);

  const inner = document.createElement("span");
  inner.className = "claim-inner";
  inner.setAttribute("aria-hidden", "true");
  let i = 0;
  let j = 0;
  for (const node of Array.from(claim.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const r = splitWords(node.textContent, i);
      i = r.next;
      inner.appendChild(r.frag);
    } else if (node.nodeName === "EM") {
      const em = document.createElement("em");
      const r = splitWords(node.textContent, i);
      i = r.next;
      em.appendChild(r.frag);
      for (const w of em.querySelectorAll(".cw")) j = splitLetters(w, j);
      inner.appendChild(document.createTextNode(" "));
      inner.appendChild(em);
      inner.appendChild(document.createTextNode(" "));
    }
  }
  claim.textContent = "";
  claim.appendChild(inner);
  // un cadre après : les animations partent de l'état caché
  requestAnimationFrame(() => requestAnimationFrame(() => claim.classList.add("is-live")));
}

// Une autre phrase, sans recharger : à chaque changement de décor.
export function nextClaim(claim) {
  if (!claim || !claim.dataset.fx) return;
  claim.classList.remove("is-live");
  build(claim);
}

export function mountClaim(claim) {
  if (!claim || claim.dataset.fx) return;
  claim.dataset.fx = "1";
  // la phrase du jour (le HTML garde la phrase de marque, sans JavaScript)
  build(claim);

  if (calm()) return;

  // lettre survolée : elle saute
  // relues à chaque fois : la phrase change avec le décor
  const letters = () => Array.from(claim.querySelectorAll(".cl"));
  const hop = (l) => {
    if (!l || l.classList.contains("is-hop")) return;
    l.classList.add("is-hop");
    l.addEventListener("animationend", () => l.classList.remove("is-hop"), { once: true });
  };
  claim.addEventListener("pointerover", (e) => {
    if (e.pointerType === "mouse") hop(e.target.closest(".cl"));
  });
  // au téléphone : un tap fait passer une vague sur toutes les lettres
  claim.addEventListener("touchstart", () => {
    letters().forEach((l, k) => setTimeout(() => hop(l), k * 28));
  }, { passive: true });

  // le titre fume : une bouffée toutes les ~900 ms, au-dessus d'une lettre
  // de "le moins écoresponsable", tant qu'il est à l'écran ; la matière
  // suit le décor (fumée, braises, neige...), c'est scene-fx qui la choisit
  let visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(claim);
  }
  let fx = null;
  import("./scene-fx.js?v=141").then((m) => { fx = m; }).catch(() => {});
  setInterval(() => {
    const ls = letters();
    if (!fx || !visible || document.hidden || !ls.length) return;
    const l = ls[Math.floor(Math.random() * ls.length)];
    const r = l.getBoundingClientRect();
    fx.emitAt(r.left + r.width / 2 + (Math.random() - 0.5) * 8, r.top + r.height * 0.2, 1);
  }, 900);
}
