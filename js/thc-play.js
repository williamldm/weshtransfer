// Mode THC : le décor se joue. Rien n'est allumé dans le dessin, c'est le
// visiteur qui s'en charge.
//
//   - frôler une plante : elle perd quelques feuilles ;
//   - cliquer une plante : on cueille une tête, un joint roulé arrive au
//     bout de la souris, éteint ;
//   - maintenir le clic : le briquet crache ses étincelles, le joint
//     s'allume ; il fume, raccourcit, chaque clic est une taffe ;
//   - cliquer le bang ou la chicha : le foyer rougeoie, la fumée sort.
//
// Le décor est une image de fond : on ne peut pas le toucher. Les zones
// viennent de js/thc-spots.js (écrit par tools/scenes.py), en coordonnées
// du décor ; on convertit la position de la souris dans ce repère.

import { SPOTS } from "./thc-spots.js?v=142";
import { WALLPAPERS } from "./wallpapers.js?v=142";
import { NOT_SCENE, emitKindAt } from "./scene-fx.js?v=142";

const HOLD_MS = 420;      // maintien du clic pour allumer
const BURN_S = 42;        // un joint dure 42 s, moins à chaque taffe
const ANGLE = -30;        // inclinaison du joint, en degrés
const LEN = 76;           // longueur du joint, en px

let scene = null;
let spots = [];
let pos = { x: 0, y: 0 };
let inScene = false;
let joint = null;         // { lit, burn }
let el = null;            // le joint à l'écran
let hint = null;
let glow = null;          // foyer du bang ou de la chicha
let holdTimer = 0;
let sparkTimer = 0;
let hintTimer = 0;
let lastRustle = { x: 0, y: 0 };
let hinted = {};

// Position de l'image du décor à l'écran : même calcul que le CSS
// (calque qui déborde de 20 px et 12 px, "cover", calé en bas, décalé par
// la profondeur --sx / --sy).
function frame() {
  const r = scene.getBoundingClientRect();
  const W = r.width + 40;
  const H = r.height + 24;
  const k = Math.max(W / 1600, H / 1000);
  const sx = parseFloat(scene.style.getPropertyValue("--sx")) || 0;
  const sy = parseFloat(scene.style.getPropertyValue("--sy")) || 0;
  return { k, left: r.left - 20 + (W - 1600 * k) / 2 + sx, top: r.top - 12 + (H - 1000 * k) + sy, rect: r };
}
const toScene = (x, y, f) => ({ x: (x - f.left) / f.k, y: (y - f.top) / f.k });
const toScreen = (x, y, f) => ({ x: f.left + x * f.k, y: f.top + y * f.k });

function onScene(e) {
  if (e.target && e.target.closest && e.target.closest(NOT_SCENE)) return false;
  const r = scene.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

// La zone sous le pointeur : bang et chicha d'abord, puis la plante la
// plus proche de nous (la plus basse à l'écran).
function hit(x, y) {
  const p = toScene(x, y, frame());
  let best = null;
  for (const s of spots) {
    if (p.x < s.x - s.w / 2 || p.x > s.x + s.w / 2 || p.y > s.y || p.y < s.y - s.h) continue;
    if (s.t === "puff") return s;
    if (!best || s.y > best.y) best = s;
  }
  return best;
}

// ------------------------------------------------------------ à l'écran

function say(key, text, ms) {
  if (!hint) return;
  if (key && hinted[key]) return;
  if (key) hinted[key] = 1;
  hint.textContent = text;
  hint.classList.add("is-on");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove("is-on"), ms || 3200);
}

function place() {
  if (el) el.style.transform = "translate(" + (pos.x + 8) + "px," + (pos.y + 4) + "px) rotate(" + ANGLE + "deg)";
  if (hint) hint.style.transform = "translate(" + (pos.x + 22) + "px," + (pos.y + 30) + "px)";
}

// Le bout du joint à l'écran (il raccourcit en brûlant).
function tip() {
  const len = 14 + (LEN - 14) * (1 - (joint ? joint.burn : 0) * 0.82);
  const a = (ANGLE * Math.PI) / 180;
  return { x: pos.x + 8 + Math.cos(a) * len, y: pos.y + 4 + Math.sin(a) * len };
}

function draw() {
  if (!el) return;
  el.classList.toggle("is-on", !!joint && inScene);
  el.classList.toggle("is-lit", !!joint && joint.lit);
  if (!joint) return;
  const w = 14 + (LEN - 14) * (1 - joint.burn * 0.82);
  el.style.setProperty("--w", w.toFixed(1) + "px");
}

function hits(n) {
  window.dispatchEvent(new CustomEvent("thc:hit", { detail: n }));
}

// ---------------------------------------------------------------- le jeu

function pick(s) {
  // quelques feuilles volent, la tête est cueillie, le joint est roulé
  emitKindAt("leaf", pos.x, pos.y, 12, 2.4);
  joint = { lit: false, burn: 0 };
  el.classList.remove("is-rolled");
  void el.offsetWidth;
  el.classList.add("is-rolled");
  draw();
  place();
  say("light", "Roulé. Maintiens le clic pour l'allumer.", 4200);
}

function light() {
  if (!joint || joint.lit) return;
  joint.lit = true;
  const t = tip();
  emitKindAt("spark", t.x, t.y, 14, 2.2);
  emitKindAt("haze", t.x, t.y - 6, 5, 0.8);
  draw();
  say("puff", "Allumé. Un clic, une taffe.", 3600);
}

function puff() {
  if (!joint || !joint.lit) return;
  joint.burn = Math.min(1, joint.burn + 0.07);
  const t = tip();
  emitKindAt("haze", t.x + 6, t.y - 8, 16, 1.6);
  el.classList.remove("is-puff");
  void el.offsetWidth;
  el.classList.add("is-puff");
  hits(0.06);
  draw();
  if (joint.burn >= 1) finish();
}

function finish() {
  const t = tip();
  emitKindAt("haze", t.x, t.y, 22, 2);
  joint = null;
  hinted.light = hinted.puff = 0;
  draw();
  hits(0.42);
  say(null, "Fini. Les plantes sont toujours là.", 3600);
}

// Bang ou chicha : le foyer rougeoie, trois bouffées sortent.
function puffSpot(s) {
  const f = frame();
  const b = toScreen(s.bx, s.by, f);
  const m = toScreen(s.sx, s.sy, f);
  glow.style.transform = "translate(" + b.x + "px," + b.y + "px)";
  glow.classList.remove("is-on");
  void glow.offsetWidth;
  glow.classList.add("is-on");
  emitKindAt("spark", b.x, b.y, 8, 1.6);
  [0, 260, 520, 900].forEach((ms, i) => setTimeout(() => emitKindAt("haze", m.x, m.y, 10 + i * 3, 1.4), ms));
  hits(0.2);
}

function stopHold() {
  clearTimeout(holdTimer);
  clearInterval(sparkTimer);
  holdTimer = sparkTimer = 0;
}

function down(e) {
  if (e.button != null && e.button !== 0) return;
  if (!onScene(e)) return;
  pos = { x: e.clientX, y: e.clientY };
  inScene = true;
  place();
  const s = hit(e.clientX, e.clientY);
  if (s && s.t === "puff") { puffSpot(s); return; }
  if (joint && joint.lit) { puff(); return; }
  if (joint) {
    // le briquet : des étincelles tant qu'on maintient, puis ça prend
    stopHold();
    sparkTimer = setInterval(() => { const t = tip(); emitKindAt("spark", t.x, t.y, 3, 1.8); }, 80);
    holdTimer = setTimeout(() => { stopHold(); light(); }, HOLD_MS);
    return;
  }
  if (s && s.t === "plant") pick(s);
}

function move(e) {
  inScene = onScene(e);
  pos = { x: e.clientX, y: e.clientY };
  place();
  draw();
  if (!inScene) { document.body.classList.remove("thc-hot"); return; }
  const s = hit(e.clientX, e.clientY);
  document.body.classList.toggle("thc-hot", !!s && (s.t === "puff" || !joint));
  if (!s) return;
  if (s.t === "plant") {
    if (!joint) say("pick", "Clique : tu cueilles une tête.", 2800);
    // la plante frôlée perd une feuille de temps en temps
    if (Math.hypot(pos.x - lastRustle.x, pos.y - lastRustle.y) > 26) {
      lastRustle = pos;
      emitKindAt("leaf", pos.x, pos.y, 1, 0.8);
    }
  } else if (s.t === "puff") {
    say("spot", "Clique pour l'allumer.", 2800);
  }
}

export function startThcPlay(sceneEl, rotation) {
  if (!sceneEl || scene) return;
  scene = sceneEl;
  const setSpots = (i) => {
    const w = WALLPAPERS[i];
    spots = (w && SPOTS[w.file.split("?")[0]]) || [];
  };
  setSpots(rotation ? rotation.index : 0);
  if (rotation) rotation.onChange(setSpots);

  el = document.createElement("div");
  el.className = "thc-joint";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<i class="tj-filter"></i><i class="tj-paper"></i><i class="tj-twist"></i><i class="tj-ember"></i>';
  hint = document.createElement("div");
  hint.className = "thc-hint";
  hint.setAttribute("aria-hidden", "true");
  glow = document.createElement("div");
  glow.className = "thc-glow";
  glow.setAttribute("aria-hidden", "true");
  document.body.append(glow, el, hint);

  window.addEventListener("pointermove", move, { passive: true });
  window.addEventListener("pointerdown", down, { passive: true });
  window.addEventListener("pointerup", stopHold, { passive: true });
  window.addEventListener("pointercancel", stopHold, { passive: true });
  window.addEventListener("blur", stopHold);

  // allumé : il fume tout seul et se consume
  setInterval(() => {
    if (!joint || !joint.lit || document.hidden) return;
    joint.burn = Math.min(1, joint.burn + 0.16 / BURN_S);
    if (inScene) { const t = tip(); emitKindAt("haze", t.x, t.y - 4, 1, 0.3); }
    draw();
    if (joint.burn >= 1) finish();
  }, 160);
}
