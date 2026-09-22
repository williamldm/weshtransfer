// Valeurs PUBLIQUES uniquement : ce fichier est servi a tous les visiteurs.
// Jamais de cle sb_secret_... ici (db.js refuse de demarrer si c'est le cas).
// La cle publishable se trouve dans Supabase > Project Settings > API Keys.

export const SUPABASE_URL = "https://mqjzzcnzbsbhololiiyw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "";

// Extensions acceptées. Filtrage à l'extension et non au type MIME : sur
// mobile, un .m4a ou un .aiff arrive souvent en application/octet-stream.
export const ALLOWED_EXT = ["mp3", "wav", "aif", "aiff", "m4a", "flac", "ogg", "zip"];

// Au-delà, pas de waveform calculée à l'upload : décoder un WAV de 400 Mo
// demande ~2 Go de mémoire et fait planter Safari mobile.
export const PEAKS_MAX_BYTES = 60 * 1024 * 1024;
