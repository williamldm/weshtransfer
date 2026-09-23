// Valeurs PUBLIQUES uniquement : ce fichier est servi a tous les visiteurs.
// Jamais de cle sb_secret_... ici (db.js refuse de demarrer si c'est le cas).
// La cle publishable se trouve dans Supabase > Project Settings > API Keys.

export const SUPABASE_URL = "https://mqjzzcnzbsbhololiiyw.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_UyLarAZElDWKybmIUlm4_Q_mKsf4ia4";

// Types de fichiers acceptés : voir js/files.js (tout sauf les programmes).

// Au-delà, pas de waveform calculée à l'upload : décoder un WAV de 400 Mo
// demande ~2 Go de mémoire et fait planter Safari mobile.
export const PEAKS_MAX_BYTES = 60 * 1024 * 1024;
