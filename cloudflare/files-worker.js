// files.weshtransfer.fr : relais Cloudflare devant le bucket B2.
//
// Les Edge Functions signent les liens de lecture pour B2 (SigV4, hôte B2
// signé), puis remplacent seulement l'hôte par files.weshtransfer.fr. Ici on
// remet l'hôte B2 et on relaie : B2 vérifie toujours la signature, ce Worker
// n'a aucune clé. Intérêt : la sortie B2 -> Cloudflare est gratuite
// (Bandwidth Alliance) et le cache Cloudflare sert les réécoutes sans
// retoucher B2 (même lien signé pendant 3 h pour tout le monde).
//
// Garde-fous : GET/HEAD/OPTIONS seulement, un seul bucket, lien signé
// obligatoire et non expiré (on ne sert jamais une copie en cache au-delà
// de la validité du lien).

const UPSTREAM = "https://s3.eu-central-003.backblazeb2.com";
// "Jusqu'au premier téléchargement" : quand un lien porte wt=<jeton signé>,
// le Worker compte les octets servis ; si le fichier est parti en entier
// (jusqu'au dernier octet), il le signale à transfer-open, qui détruit le
// fichier. Le jeton est retiré avant B2 (il ne fait pas partie de la
// signature) et vérifié côté Supabase (HMAC) : le Worker n'a aucun secret.
const COMPLETE_URL = "https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/transfer-open";
// Compteur de bande passante (admin) : octets réellement envoyés au
// visiteur, et part venue de B2 (le cache Cloudflare absorbe le reste).
// Secret BW_SECRET partagé avec la fonction "bandwidth" (jamais dans le code).
const BW_URL = "https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/bandwidth";
const BUCKET = "/weshtransfer/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Disposition, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

// Deuxième ligne de défense (les types sont déjà imposés à l'upload, sur
// liste blanche) : rien de ce qui est servi ici ne peut s'exécuter comme une
// page du domaine, ni fuiter le lien signé par le Referer.
const hardening = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000",
};

function deny(status, msg) {
  return new Response(msg, { status, headers: { ...cors, ...hardening, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

// secondes restantes avant expiration du lien signé (<= 0 : expiré)
function remaining(q) {
  const d = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get("X-Amz-Date") || "");
  const exp = Number(q.get("X-Amz-Expires"));
  if (!d || !Number.isFinite(exp)) return 0;
  const start = Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) / 1000;
  return Math.floor(start + exp - Date.now() / 1000);
}

// Un téléchargement est "complet" seulement s'il couvre TOUT le fichier :
// une réponse 200, ou une 206 qui va du premier au dernier octet. Une
// plage qui touche juste la fin (un navigateur ou un lecteur de zip qui
// lit le répertoire central) ne compte JAMAIS : sinon elle détruirait le
// fichier d'un envoi "jusqu'au premier téléchargement" avant qu'il soit
// récupéré (corrigé le 04/10/2026).
function reachesEnd(res) {
  if (res.status === 200) return Number(res.headers.get("Content-Length")) || 0;
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("Content-Range") || "");
  if (res.status === 206 && m && Number(m[1]) === 0 && Number(m[2]) === Number(m[3]) - 1) return Number(m[3]);
  return 0;
}

// IMPORTANT : le fichier doit traverser le Worker SANS qu'aucun code JS ne
// touche chaque morceau. Un ReadableStream écrit en JS (lu morceau par
// morceau) fait grimper le temps de calcul du Worker ; au-delà de la limite
// (10 ms de calcul sur l'offre gratuite) Cloudflare coupe la réponse en
// plein milieu : un fichier de 2 Go s'arrêtait vers 80 Mo, d'où des zip
// "endommagés" (constaté le 04/10/2026, empreinte différente à 2,13 Go).
// On utilise donc un tuyau natif (IdentityTransformStream + pipeTo) : zéro
// calcul par morceau. La taille servie est connue d'avance (Content-Length
// ou Content-Range) ; pipeTo se termine quand tout est parti.
function relay(res, done) {
  const { readable, writable } = new IdentityTransformStream();
  res.body.pipeTo(writable).then(() => done(true), () => done(false));
  return readable;
}

// octets que cette réponse va envoyer
function servedBytes(res) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("Content-Range") || "");
  if (res.status === 206 && m) return Number(m[2]) - Number(m[1]) + 1;
  return Number(res.headers.get("Content-Length")) || 0;
}

function kindOf(type) {
  if (/^audio\//i.test(type)) return "audio";
  if (/^video\//i.test(type)) return "video";
  if (/^image\//i.test(type)) return "image";
  return "fichier";
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return deny(405, "Méthode refusée");

    const url = new URL(request.url);
    // lien signé en clair sur le réseau : jamais
    if (url.protocol !== "https:") return deny(403, "HTTPS obligatoire");
    if (!url.pathname.startsWith(BUCKET) || url.pathname.length <= BUCKET.length) return deny(404, "Introuvable");
    if (!url.searchParams.get("X-Amz-Signature")) return deny(403, "Lien non signé");
    const left = remaining(url.searchParams);
    if (left <= 0) return deny(403, "Lien expiré");

    const wt = url.searchParams.get("wt");
    // retiré du texte brut : réécrire toute la requête changerait l'encodage
    // des autres paramètres, et B2 refuserait la signature
    const search = wt ? url.search.replace(/([?&])wt=[^&]*(&|$)/, (_, a, b) => (b ? a : "")) : url.search;
    const burn = wt && /^[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,64}$/.test(wt) && request.method === "GET";

    const headers = new Headers();
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);

    // téléchargement "jusqu'au premier" : jamais de cache (le fichier doit
    // disparaître pour de bon après)
    const res = await fetch(UPSTREAM + url.pathname + search, burn
      ? { method: request.method, headers, cache: "no-store" }
      : {
        method: request.method,
        headers,
        cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": Math.min(left, 10800), "400-599": 0 } },
      });

    const expected = burn && res.body ? reachesEnd(res) : 0;
    const fromOrigin = !/^(HIT|STALE|REVALIDATED)$/i.test(res.headers.get("cf-cache-status") || "");
    const kind = kindOf(res.headers.get("Content-Type") || "");
    let body = res.body;
    if (body && res.ok && request.method === "GET") {
      const n = servedBytes(res);
      body = relay(res, (complete) => {
        // compteur de bande passante (admin) : seulement ce qui est parti en entier
        if (complete && env.BW_SECRET && n > 0) {
          ctx.waitUntil(fetch(BW_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-bw-secret": env.BW_SECRET },
            body: JSON.stringify({ kind, delivered: n, origin: fromOrigin ? n : 0 }),
          }).catch(() => {}));
        }
        // "jusqu'au premier téléchargement" : seulement si TOUT est parti
        if (expected && complete && n === expected) {
          ctx.waitUntil(fetch(COMPLETE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "complete", wt }),
          }).catch(() => {}));
        }
      });
    }
    const out = new Response(body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    for (const [k, v] of Object.entries(hardening)) out.headers.set(k, v);
    // "sandbox" empêcherait le lecteur PDF du navigateur de s'ouvrir
    if (/^application\/pdf/i.test(out.headers.get("Content-Type") || "")) {
      out.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }
    for (const h of ["x-amz-request-id", "x-amz-id-2", "Access-Control-Allow-Credentials", "Vary"]) out.headers.delete(h);
    return out;
  },
};
