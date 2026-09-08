// Calcul de la waveform, une seule fois, au moment de l'upload.
// Le resultat (quelques centaines d'octets) part en base dans files.peaks :
// a l'ecoute on dessine sans jamais retelecharger ni redecoder l'audio.

export const PEAK_COUNT = 800;

// Duree sans decoder : l'element audio lit juste l'en-tete du fichier.
// Marche meme sur un WAV de 400 Mo qu'on refusera de decoder ensuite.
export function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), 8000);

    el.preload = "metadata";
    el.onloadedmetadata = () => {
      finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    };
    el.onerror = () => finish(null);
    el.src = url;
  });
}

// Renvoie { peaks, duration, skipped }.
// peaks : tableau de PEAK_COUNT entiers 0-255, ou null si on a renonce.
// skipped : "too_large" | "decode_failed" | null  (jamais une erreur bloquante,
// un son sans waveform reste parfaitement ecoutable).
export async function computePeaks(file, options = {}) {
  const maxBytes = options.maxBytes || 60 * 1024 * 1024;
  const count = options.count || PEAK_COUNT;

  const duration = await readDuration(file);

  // Decoder decompresse tout en Float32 : un WAV de 400 Mo demande ~2 Go de
  // RAM et fait sauter l'onglet sur mobile. Au-dela du seuil, on renonce.
  if (file.size > maxBytes) {
    return { peaks: null, duration, skipped: "too_large" };
  }

  let ctx = null;
  try {
    const buffer = await file.arrayBuffer();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buffer);
    return {
      peaks: peaksFromBuffer(audio, count),
      duration: audio.duration || duration,
      skipped: null
    };
  } catch (err) {
    // zip, format exotique, fichier corrompu : on n'insiste pas
    return { peaks: null, duration, skipped: "decode_failed" };
  } finally {
    if (ctx && ctx.close) ctx.close();
  }
}

function peaksFromBuffer(audio, count) {
  const channels = [];
  for (let c = 0; c < audio.numberOfChannels; c++) {
    channels.push(audio.getChannelData(c));
  }

  const total = audio.length;
  const step = total / count;
  const out = new Array(count);
  let loudest = 0;

  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * step);
    const end = Math.min(total, Math.floor((i + 1) * step));
    let peak = 0;

    // On echantillonne au lieu de tout parcourir : sur 10 minutes de stereo
    // 48 kHz, lire chaque sample coute des secondes pour un resultat
    // visuellement identique.
    const stride = Math.max(1, Math.floor((end - start) / 512));

    for (let ch = 0; ch < channels.length; ch++) {
      const data = channels[ch];
      for (let j = start; j < end; j += stride) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > peak) peak = v;
      }
    }

    out[i] = peak;
    if (peak > loudest) loudest = peak;
  }

  // Normalisation : une prise voix enregistree bas doit rester lisible.
  // Le plancher evite qu'un fichier quasi silencieux devienne du bruit plein
  // ecran.
  const gain = loudest > 0.02 ? 1 / loudest : 0;

  for (let i = 0; i < count; i++) {
    out[i] = Math.min(255, Math.round(out[i] * gain * 255));
  }

  return out;
}
