// Copier en js/config.js (ignore par git) et remplir avec les valeurs
// du nouveau projet Supabase : Settings > API.
export const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";

// Extensions acceptees a l'upload. Le filtrage se fait ici et non sur le
// mime-type : sur mobile, un .m4a ou un .aiff arrive souvent en
// application/octet-stream et serait rejete a tort.
export const ALLOWED_EXT = ["mp3", "wav", "aiff", "aif", "m4a", "flac", "ogg", "zip"];

// Au-dela, on ne calcule pas la waveform a l'upload : decoder un WAV de
// 400 Mo fait ~2 Go de Float32 en memoire et tue Safari mobile.
export const PEAKS_MAX_BYTES = 60 * 1024 * 1024;
