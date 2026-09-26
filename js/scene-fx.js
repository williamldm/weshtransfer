// Le décor réagit. Deux effets, par-dessus le fond d'écran (SVG animé en
// image de fond, donc intouchable de l'intérieur) :
//
//   1. Profondeur : le décor glisse un peu à l'opposé de la souris, comme
//      vu à travers une fenêtre. Au téléphone : l'inclinaison de l'appareil.
//   2. Ta pollution à toi : la souris laisse une traînée assortie au décor
//      (fumée, braises, octets, traînées d'avion, neige de culture, gaz
//      d'échappement), un clic en crache une bouffée. Au téléphone : le
//      doigt qui glisse sur le décor, un tap pour la bouffée.
//
// Rien ne tourne quand rien ne bouge (la boucle s'arrête d'elle-même), rien
// du tout avec "réduire les animations", ni onglet caché.

import { WALLPAPERS } from "./wallpapers.js?v=87";

const MAX_PARTICLES = 240;
const SHIFT_X = 16;   // px, amplitude de la profondeur
const SHIFT_Y = 10;
// ce qui n'est pas du décor : on n'y sème rien (invisible derrière la carte)
const NOT_SCENE = ".deck, .app-main, #tp, .hub-below, .player, .sheet, .sheet-wrap, .toast-wrap, " +
  ".app-header, a, button, input, textarea, select, label, summary, [role=dialog]";

// ------------------------------------------------------------ les matières

const rand = (a, b) => a + Math.random() * (b - a);

// Chaque décor a sa matière : couleur(s), forme, physique.
const KINDS = {
  smoke: {        // centrale : fumée lavande qui monte et part avec le vent
    colors: ["#9b93b6", "#b3acc9", "#857d9f"], shape: "puff", blend: "source-over",
    every: 14, burst: 22,
    make: (x, y, vx, vy) => ({ x, y, vx: vx * 0.15 + rand(-0.2, 0.3), vy: rand(-0.9, -0.4), s: rand(6, 12), gs: rand(0.25, 0.45), a: rand(0.3, 0.45), life: rand(150, 240) }),
    wind: 0.012, lift: -0.004
  },
  embers: {       // plateforme : braises de torchère, lumineuses
    colors: ["#ffb347", "#ff7a2f", "#ffe07a"], shape: "dot", blend: "lighter",
    every: 7, burst: 44,
    make: (x, y, vx, vy) => ({ x, y, vx: vx * 0.2 + rand(-0.7, 0.7), vy: rand(-2, -0.8), s: rand(2.4, 4.2), gs: -0.01, a: rand(0.8, 1), life: rand(110, 190), flicker: true }),
    wind: 0.006, lift: -0.01
  },
  bits: {         // serveurs : des octets qui s'échappent, en carrés
    colors: ["#5ff2ff", "#7dffa0", "#a48bff"], shape: "square", blend: "lighter",
    every: 8, burst: 40,
    make: (x, y, vx, vy) => ({ x, y, vx: vx * 0.1 + rand(-0.4, 0.4), vy: rand(-1.2, -0.4), s: rand(3, 5.5), gs: 0, a: rand(0.7, 1), life: rand(140, 230), steps: true }),
    wind: 0, lift: -0.006
  },
  contrail: {     // aéroport : la souris est un jet, elle laisse sa traînée
    colors: ["#e9e6f2", "#cfcadf"], shape: "puff", blend: "source-over",
    every: 5, burst: 22,
    make: (x, y, vx, vy) => ({ x, y, vx: rand(-0.08, 0.08), vy: rand(-0.08, 0.04), s: rand(2, 3.5), gs: rand(0.08, 0.16), a: rand(0.16, 0.26), life: rand(200, 320) }),
    wind: 0.004, lift: 0
  },
  snow: {         // ski en août : les canons à neige, c'est toi
    colors: ["#ffffff", "#e8f1ff"], shape: "dot", blend: "source-over",
    every: 7, burst: 34,
    make: (x, y, vx, vy) => ({ x, y, vx: vx * 0.35 + rand(-0.7, 0.7), vy: vy * 0.2 + rand(-0.6, 0.4), s: rand(1.2, 2.8), gs: 0, a: rand(0.7, 1), life: rand(140, 220), sway: rand(0, 6.28) }),
    wind: 0, lift: 0.02
  },
  exhaust: {      // périphérique : gaz d'échappement, bas et lourds
    colors: ["#7d7596", "#948cab", "#6b6485"], shape: "puff", blend: "source-over",
    every: 11, burst: 24,
    make: (x, y, vx, vy) => ({ x, y, vx: vx * 0.1 + rand(-0.5, 0.5), vy: rand(-0.45, -0.1), s: rand(6, 10), gs: rand(0.2, 0.34), a: rand(0.32, 0.46), life: rand(150, 230) }),
    wind: -0.004, lift: -0.002
  }
};

const KIND_OF = {
  "img/scene.svg": "smoke",
  "img/scenes/plateforme.svg": "embers",
  "img/scenes/serveurs.svg": "bits",
  "img/scenes/aeroport.svg": "contrail",
  "img/scenes/ski.svg": "snow",
  "img/scenes/autoroute.svg": "exhaust"
};

// Sprite flou pré-rendu par couleur : bien moins cher qu'un dégradé par
// particule et par image.
const sprites = new Map();
function sprite(color) {
  if (sprites.has(color)) return sprites.get(color);
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.45, color + "aa");
  grad.addColorStop(1, color + "00");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}

// ------------------------------------------------------------ le moteur

let scene = null;
let canvas = null;
let ctx = null;
let dpr = 1;
let kind = KINDS.smoke;
const parts = [];
let raf = 0;
// profondeur : cible et position courante (lissée)
let tx = 0, ty = 0, cx = 0, cy = 0;
let last = null;   // dernier point de la souris / du doigt, pour la vitesse et l'espacement
let frozen = false; // tests : image figée (les particules ne vieillissent plus)

function setKind(index) {
  const w = WALLPAPERS[index];
  kind = KINDS[(w && KIND_OF[w.file.split("?")[0]]) || "smoke"];
}

function resize() {
  const r = scene.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.height * dpr));
  canvas.style.width = r.width + "px";
  canvas.style.height = r.height + "px";
}

function wake() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(tick);
}

function spawn(x, y, vx, vy, n) {
  for (let i = 0; i < n && parts.length < MAX_PARTICLES; i++) {
    const p = kind.make(x, y, vx, vy);
    p.k = kind;
    p.c = kind.colors[(Math.random() * kind.colors.length) | 0];
    p.age = 0;
    parts.push(p);
  }
  wake();
}

function burst(x, y) {
  for (let i = 0; i < kind.burst && parts.length < MAX_PARTICLES; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(0.6, 2.6);
    const p = kind.make(x, y, 0, 0);
    p.vx += Math.cos(ang) * sp;
    p.vy += Math.sin(ang) * sp - 0.6;
    p.k = kind;
    p.c = kind.colors[(Math.random() * kind.colors.length) | 0];
    p.age = 0;
    parts.push(p);
  }
  wake();
}

function tick() {
  raf = 0;
  // profondeur, lissée
  cx += (tx - cx) * 0.07;
  cy += (ty - cy) * 0.07;
  scene.style.setProperty("--sx", cx.toFixed(2) + "px");
  scene.style.setProperty("--sy", cy.toFixed(2) + "px");
  const moving = Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const k = p.k;
    if (frozen) { draw(p, k); continue; }
    p.age++;
    if (p.age >= p.life) { parts.splice(i, 1); continue; }
    p.vx += k.wind;
    p.vy += k.lift;
    p.vx *= 0.99;
    p.vy *= 0.99;
    if (p.sway != null) p.x += Math.sin(p.sway + p.age * 0.05) * 0.4;
    p.x += p.vx;
    p.y += p.vy;
    p.s = Math.max(0.4, p.s + p.gs);
    const t = p.age / p.life;
    // entrée douce, sortie en fondu
    let a = p.a * Math.min(1, p.age / 8) * (1 - t);
    if (p.flicker) a *= 0.6 + Math.random() * 0.4;
    if (p.steps) a = Math.round(a * 4) / 4;
    p.alpha = a;
    draw(p, k);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  if ((parts.length && !frozen) || moving) wake();
}

function draw(p, k) {
  const a = p.alpha || 0;
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = k.blend;
  if (k.shape === "square") {
    ctx.fillStyle = p.c;
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
  } else if (k.shape === "dot") {
    const img = sprite(p.c);
    ctx.drawImage(img, p.x - p.s * 1.6, p.y - p.s * 1.6, p.s * 3.2, p.s * 3.2);
  } else {
    const img = sprite(p.c);
    ctx.drawImage(img, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
  }
}

// Un point de l'écran : dans le décor visible, et pas sur la carte ?
function localPoint(clientX, clientY, target) {
  if (target && target.closest && target.closest(NOT_SCENE)) return null;
  const r = scene.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  if (x < 0 || y < 0 || x > r.width || y > r.height) return null;
  return { x, y };
}

function trail(pt) {
  if (!last) { last = pt; spawn(pt.x, pt.y, 0, 0, 1); return; }
  const dx = pt.x - last.x;
  const dy = pt.y - last.y;
  const dist = Math.hypot(dx, dy);
  if (dist < kind.every) return;
  // une particule tous les "every" pixels, le long du geste
  const n = Math.min(6, Math.floor(dist / kind.every));
  for (let i = 1; i <= n; i++) {
    spawn(last.x + (dx * i) / n, last.y + (dy * i) / n, dx / n, dy / n, 1);
  }
  last = pt;
}

// ------------------------------------------------------ souris (bureau)

function bindPointer() {
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    // profondeur : partout, même au-dessus de la carte
    tx = -((e.clientX / window.innerWidth) - 0.5) * 2 * SHIFT_X;
    ty = -((e.clientY / window.innerHeight) - 0.5) * 2 * SHIFT_Y;
    wake();
    const pt = localPoint(e.clientX, e.clientY, e.target);
    if (pt) trail(pt); else last = null;
  }, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const pt = localPoint(e.clientX, e.clientY, e.target);
    if (pt) burst(pt.x, pt.y);
  }, { passive: true });
  document.addEventListener("mouseleave", () => { tx = 0; ty = 0; last = null; wake(); });
}

// ------------------------------------------------ doigt et gyroscope (téléphone)

const TILT_KEY = "seminaire.tilt";
let tiltOn = false;
let gotTilt = false; // des mesures arrivent déjà : rien à demander
let base = null;   // position "neutre" de l'appareil, qui suit lentement la main

function onTilt(e) {
  if (e.beta == null || e.gamma == null) return;
  gotTilt = true;
  if (!base) base = { b: e.beta, g: e.gamma };
  // le neutre dérive doucement : on peut changer de position sans que le
  // décor reste décalé
  base.b += (e.beta - base.b) * 0.01;
  base.g += (e.gamma - base.g) * 0.01;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  tx = -clamp((e.gamma - base.g) / 20) * SHIFT_X;
  ty = -clamp((e.beta - base.b) / 20) * SHIFT_Y;
  wake();
}

function startTilt() {
  if (tiltOn) return;
  tiltOn = true;
  window.addEventListener("deviceorientation", onTilt, { passive: true });
}

// iPhone (et navigateurs qui l'exigent) : la permission se demande sur un
// geste de l'utilisateur. Seulement quand il touche le décor lui-même, une
// fois par page ; un refus est retenu pour ne plus jamais redemander.
let asked = false;
function askTilt() {
  const D = window.DeviceOrientationEvent;
  if (asked || gotTilt || !D || typeof D.requestPermission !== "function") return;
  asked = true;
  let saved = null;
  try { saved = localStorage.getItem(TILT_KEY); } catch (err) { /* privé */ }
  if (saved === "denied") return;
  D.requestPermission().then((state) => {
    try { localStorage.setItem(TILT_KEY, state); } catch (err) { /* privé */ }
  }).catch(() => {});
}

function bindTouch() {
  // on écoute d'office : sur Android les mesures arrivent sans rien
  // demander, sur iPhone seulement une fois la permission donnée
  if ("ondeviceorientation" in window) startTilt();

  window.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    const pt = t && localPoint(t.clientX, t.clientY, e.target);
    last = pt;
    if (pt) burst(pt.x, pt.y);
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    const pt = t && localPoint(t.clientX, t.clientY, e.target);
    if (pt) trail(pt); else last = null;
  }, { passive: true });
  window.addEventListener("touchend", (e) => {
    last = null;
    const t = e.changedTouches[0];
    if (t && localPoint(t.clientX, t.clientY, e.target)) askTilt();
  }, { passive: true });
}

// ------------------------------------------------------------ démarrage

export function startSceneFx(el, rotation) {
  if (!el || scene) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  scene = el;
  canvas = document.createElement("canvas");
  canvas.className = "scene-fx";
  canvas.setAttribute("aria-hidden", "true");
  scene.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resize();
  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(scene);
  else window.addEventListener("resize", resize);

  setKind(rotation ? rotation.index : 2);
  if (rotation) rotation.onChange(setKind);

  bindPointer();
  bindTouch();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });
}

// Une bouffée à un point de l'écran (le grand titre qui fume, par ex.) :
// n particules de la matière du décor, qui montent doucement.
export function emitAt(clientX, clientY, n) {
  if (!scene) return;
  const r = scene.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  if (x < 0 || y < 0 || x > r.width || y > r.height) return;
  spawn(x, y, 0, -0.4, n || 1);
}

// Pour les tests : fait avancer la boucle sans attendre l'écran.
export function stepSceneFx(frames) {
  for (let i = 0; i < (frames || 1); i++) tick();
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  return parts.length;
}
export const sceneFxDebug = { freeze: (on) => { frozen = !!on; if (!on) wake(); }, burst: (x, y) => burst(x, y), trail: (x, y) => trail({ x, y }), count: () => parts.length, kind: () => Object.keys(KINDS).find((k) => KINDS[k] === kind) };
