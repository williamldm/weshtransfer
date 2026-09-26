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

export function mountClaim(claim) {
  if (!claim || claim.dataset.fx) return;
  claim.dataset.fx = "1";
  const full = claim.textContent.replace(/\s+/g, " ").trim();
  claim.setAttribute("aria-label", full);

  // reconstruit : mots en <span class="cw">, lettres de <em> en <span class="cl">
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

  if (calm()) return;

  // lettre survolée : elle saute
  const letters = Array.from(claim.querySelectorAll(".cl"));
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
    letters.forEach((l, k) => setTimeout(() => hop(l), k * 28));
  }, { passive: true });

  // le titre fume : une bouffée toutes les ~900 ms, au-dessus d'une lettre
  // de "le moins écoresponsable", tant qu'il est à l'écran ; la matière
  // suit le décor (fumée, braises, neige...), c'est scene-fx qui la choisit
  let visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }).observe(claim);
  }
  let fx = null;
  import("./scene-fx.js?v=85").then((m) => { fx = m; }).catch(() => {});
  setInterval(() => {
    if (!fx || !visible || document.hidden || !letters.length) return;
    const l = letters[Math.floor(Math.random() * letters.length)];
    const r = l.getBoundingClientRect();
    fx.emitAt(r.left + r.width / 2 + (Math.random() - 0.5) * 8, r.top + r.height * 0.2, 1);
  }, 900);
}
