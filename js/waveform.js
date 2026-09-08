// Rendu de la waveform sur canvas.
// Prend les pics deja calcules (files.peaks) : aucun decodage, aucun
// telechargement, l'affichage est immediat meme sur un vieux telephone.

const DEFAULTS = {
  barWidth: 3,
  barGap: 1,
  minBarHeight: 2,
  idleColor: "#3a4150",
  playedColor: "#ff9142",
  cursorColor: "#ffffff",
  markerColor: "#ff9142"
};

export class Waveform {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = Object.assign({}, DEFAULTS, options);

    this.peaks = null;
    this.progress = 0;     // 0..1
    this.markers = [];     // [{ ratio, count }]
    this.width = 0;
    this.height = 0;

    this.onSeek = options.onSeek || null;

    this._resize = this._resize.bind(this);
    this._observer = new ResizeObserver(this._resize);
    this._observer.observe(canvas);
    this._resize();

    if (this.onSeek) this._bindPointer();
  }

  setPeaks(peaks) {
    this.peaks = peaks && peaks.length ? peaks : null;
    this.draw();
  }

  setProgress(ratio) {
    const next = clamp01(ratio);
    const movedPx = Math.abs(next - this.progress) * this.width;

    // L etat est enregistre avant toute optimisation : tant que le canvas
    // n est pas mesure (width = 0), un retour anticipe ici perdrait la
    // progression pour de bon, et _resize dessinerait toujours a zero.
    this.progress = next;

    // en dessous d un demi-pixel de deplacement, repeindre ne change rien
    if (this.width && movedPx < 0.5) return;
    this.draw();
  }

  // markers : [{ atMs, count }] ; duree en ms pour convertir en ratio
  setMarkers(markers, durationMs) {
    this.markers = (markers || [])
      .filter((m) => durationMs > 0 && m.atMs != null)
      .map((m) => ({ ratio: clamp01(m.atMs / durationMs), count: m.count || 1 }));
    this.draw();
  }

  destroy() {
    this._observer.disconnect();
    if (this._unbind) this._unbind();
  }

  // ------------------------------------------------------------ interne

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // Le canvas est en pixels physiques, la CSS en pixels logiques :
    // sans ca la waveform est floue sur tous les ecrans retina.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  _bindPointer() {
    const canvas = this.canvas;
    let dragging = false;

    const ratioAt = (clientX) => {
      const rect = canvas.getBoundingClientRect();
      return clamp01((clientX - rect.left) / rect.width);
    };

    const down = (e) => {
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
      const r = ratioAt(e.clientX);
      this.setProgress(r);
      this.onSeek(r, false);
    };

    const move = (e) => {
      if (!dragging) return;
      e.preventDefault();
      const r = ratioAt(e.clientX);
      this.setProgress(r);
      this.onSeek(r, false);
    };

    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      // true = geste termine : c'est la que le lecteur applique le seek reel
      this.onSeek(ratioAt(e.clientX), true);
    };

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);

    this._unbind = () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }

  draw() {
    const { ctx, width: w, height: h, opts } = this;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const slot = opts.barWidth + opts.barGap;
    const bars = Math.max(1, Math.floor(w / slot));
    const mid = h / 2;
    const playedX = this.progress * w;

    if (!this.peaks) {
      this._drawFlat(mid, w);
    } else {
      for (let i = 0; i < bars; i++) {
        const value = this._sample(i, bars);
        const x = i * slot;
        const barH = Math.max(opts.minBarHeight, (value / 255) * (h - 8));

        ctx.fillStyle = x + opts.barWidth <= playedX ? opts.playedColor : opts.idleColor;
        roundBar(ctx, x, mid - barH / 2, opts.barWidth, barH);
      }
    }

    this._drawMarkers(w, h);

    if (this.progress > 0) {
      ctx.fillStyle = opts.cursorColor;
      ctx.fillRect(Math.min(playedX, w - 2), 0, 2, h);
    }
  }

  // Le nombre de pics stockes (800) ne correspond pas au nombre de barres
  // affichables : on prend le maximum de la tranche pour ne pas gommer
  // les transitoires (une caisse claire ne doit pas disparaitre).
  _sample(index, bars) {
    const peaks = this.peaks;
    const start = Math.floor((index / bars) * peaks.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / bars) * peaks.length));
    let max = 0;
    for (let i = start; i < end && i < peaks.length; i++) {
      if (peaks[i] > max) max = peaks[i];
    }
    return max;
  }

  // Fichier sans pics (trop lourd, ou zip) : trait sobre, pas de faux dessin.
  _drawFlat(mid, w) {
    const { ctx, opts } = this;
    const playedX = this.progress * w;
    ctx.fillStyle = opts.idleColor;
    ctx.fillRect(0, mid - 1, w, 2);
    ctx.fillStyle = opts.playedColor;
    ctx.fillRect(0, mid - 1, playedX, 2);
  }

  _drawMarkers(w, h) {
    const { ctx, opts } = this;
    for (const m of this.markers) {
      const x = m.ratio * w;
      ctx.fillStyle = opts.markerColor;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x - 0.5, 0, 1, h);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, 4, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function roundBar(ctx, x, y, w, h) {
  const r = Math.min(w / 2, h / 2, 1.5);
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// mm:ss, utilise par le lecteur et les commentaires horodates
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ":" + String(s).padStart(2, "0");
}
