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
const BUCKET = "/weshtransfer/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Content-Disposition, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

function deny(status, msg) {
  return new Response(msg, { status, headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

// secondes restantes avant expiration du lien signé (<= 0 : expiré)
function remaining(q) {
  const d = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(q.get("X-Amz-Date") || "");
  const exp = Number(q.get("X-Amz-Expires"));
  if (!d || !Number.isFinite(exp)) return 0;
  const start = Date.UTC(+d[1], +d[2] - 1, +d[3], +d[4], +d[5], +d[6]) / 1000;
  return Math.floor(start + exp - Date.now() / 1000);
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return deny(405, "Méthode refusée");

    const url = new URL(request.url);
    if (!url.pathname.startsWith(BUCKET) || url.pathname.length <= BUCKET.length) return deny(404, "Introuvable");
    if (!url.searchParams.get("X-Amz-Signature")) return deny(403, "Lien non signé");
    const left = remaining(url.searchParams);
    if (left <= 0) return deny(403, "Lien expiré");

    const headers = new Headers();
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);

    const res = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers,
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": Math.min(left, 10800), "400-599": 0 } },
    });

    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    for (const h of ["x-amz-request-id", "x-amz-id-2", "Access-Control-Allow-Credentials", "Vary"]) out.headers.delete(h);
    return out;
  },
};
