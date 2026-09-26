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

// fin de fichier atteinte ? 200 complet, ou 206 qui se termine au dernier
// octet (reprise d'un téléchargement interrompu)
function reachesEnd(res) {
  if (res.status === 200) return Number(res.headers.get("Content-Length")) || 0;
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get("Content-Range") || "");
  if (res.status === 206 && m && Number(m[2]) === Number(m[3]) - 1) return Number(m[2]) - Number(m[1]) + 1;
  return 0;
}

function watchCompletion(body, expected, wt, ctx) {
  let seen = 0;
  const counter = new TransformStream({
    transform(chunk, controller) { seen += chunk.byteLength; controller.enqueue(chunk); },
    flush() {
      // flush n'arrive que si tout a été lu : un téléchargement annulé ne compte pas
      if (seen === expected) {
        ctx.waitUntil(fetch(COMPLETE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", wt }),
        }).catch(() => {}));
      }
    },
  });
  return body.pipeThrough(counter);
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
    const out = new Response(expected ? watchCompletion(res.body, expected, wt, ctx) : res.body, res);
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
