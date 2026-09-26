// Backblaze B2 via son API compatible S3, signée en SigV4 (aws4fetch).
//
// Secrets (supabase secrets set ...) :
//   B2_KEY_ID      keyID de la clé d'application (restreinte au bucket)
//   B2_APP_KEY     applicationKey
//   B2_BUCKET      nom du bucket (privé)
//   B2_ENDPOINT    ex. https://s3.eu-central-003.backblazeb2.com
// Tant que l'un manque, b2Config() renvoie null et l'appli reste sur le
// Storage Supabase : rien ne casse pendant la mise en place.

import { AwsClient } from "npm:aws4fetch@1.0.20";

export type B2 = { aws: AwsClient; base: string; bucket: string };

export function b2Config(): B2 | null {
  const keyId = Deno.env.get("B2_KEY_ID");
  const appKey = Deno.env.get("B2_APP_KEY");
  const bucket = Deno.env.get("B2_BUCKET");
  const endpoint = (Deno.env.get("B2_ENDPOINT") ?? "").replace(/\/+$/, "");
  if (!keyId || !appKey || !bucket || !endpoint) return null;

  // https://s3.<region>.backblazeb2.com -> <region>
  const region = /s3\.([a-z0-9-]+)\.backblazeb2\.com/.exec(endpoint)?.[1] ?? "us-east-1";
  return {
    aws: new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, service: "s3", region }),
    base: `${endpoint}/${bucket}`,
    bucket,
  };
}

function objectUrl(b2: B2, key: string): URL {
  return new URL(`${b2.base}/${key.split("/").map(encodeURIComponent).join("/")}`);
}

function tag(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function unxml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

async function call(b2: B2, url: URL, init: RequestInit = {}): Promise<string> {
  const res = await b2.aws.fetch(url.toString(), init);
  const text = await res.text();
  if (!res.ok) {
    const code = tag(text, "Code")[0] ?? `HTTP ${res.status}`;
    const msg = tag(text, "Message")[0] ?? "";
    throw new Error(`B2 ${code}${msg ? " : " + msg : ""}`);
  }
  return text;
}

// ------------------------------------------------------------ lecture

// URL signée de lecture. Avec downloadName, le navigateur télécharge sous
// le nom d'origine au lieu de <uuid>.wav. Le paramètre doit être signé.
// Économie d'egress B2 : une URL signée STABLE par fenêtre de 3 h (même
// date de signature pour tout le monde), et une consigne de cache au
// navigateur (fichiers immuables : chaque version a sa propre clé). Réécouter
// un son, recharger la page, suivre une jam ou zipper un envoi déjà écouté
// ne retélécharge plus rien depuis B2 : le navigateur a déjà le fichier
// sous cette même adresse. Validité : au moins `expires`, au plus
// `expires` + 3 h.
const SIGN_WINDOW = 3 * 3600;

export async function presignGet(b2: B2, key: string, expires: number, downloadName?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % SIGN_WINDOW);
  const datetime = new Date(start * 1000).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const url = objectUrl(b2, key);
  url.searchParams.set("X-Amz-Expires", String(Math.min(expires + SIGN_WINDOW, 604800)));
  url.searchParams.set("response-cache-control", `private, max-age=${expires}, immutable`);
  if (downloadName) {
    url.searchParams.set(
      "response-content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    );
  }
  const signed = await b2.aws.sign(url.toString(), { method: "GET", aws: { signQuery: true, datetime } });
  return signed.url;
}

// Tout ce que contient le bucket (admin : comparaison avec la base).
export type B2Object = { key: string; size: number; modified: string };
export async function listObjects(b2: B2, prefix = "", max = 50000): Promise<B2Object[]> {
  const out: B2Object[] = [];
  let token = "";
  for (;;) {
    const url = new URL(b2.base);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("max-keys", "1000");
    if (prefix) url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const xml = await call(b2, url);
    for (const c of tag(xml, "Contents")) {
      out.push({
        key: unxml(tag(c, "Key")[0] ?? ""),
        size: Number(tag(c, "Size")[0] ?? 0),
        modified: tag(c, "LastModified")[0] ?? "",
      });
    }
    if (tag(xml, "IsTruncated")[0] !== "true" || out.length >= max) break;
    token = unxml(tag(xml, "NextContinuationToken")[0] ?? "");
    if (!token) break;
  }
  return out;
}

// -------------------------------------------------- upload multipart
// Le navigateur envoie les parties directement à B2 (URL signées) : les
// octets ne transitent jamais par l'Edge Function.

export async function createMultipart(b2: B2, key: string, contentType: string): Promise<string> {
  const url = objectUrl(b2, key);
  url.search = "uploads";
  const xml = await call(b2, url, { method: "POST", headers: { "Content-Type": contentType } });
  const id = tag(xml, "UploadId")[0];
  if (!id) throw new Error("B2 : UploadId manquant");
  return id;
}

// La taille de la partie est signée (Content-Length dans les en-têtes
// signés) : l'URL n'accepte que ce nombre exact d'octets. Sans ça, une URL
// de partie accepterait jusqu'à 5 Go, quelle que soit la taille annoncée.
export async function presignPart(
  b2: B2, key: string, uploadId: string, part: number, expires: number, length: number,
): Promise<string> {
  const url = objectUrl(b2, key);
  url.searchParams.set("partNumber", String(part));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await b2.aws.sign(url.toString(), {
    method: "PUT",
    headers: { "Content-Length": String(length) },
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url;
}

export type Part = { part: number; etag: string; size: number };

export async function listParts(b2: B2, key: string, uploadId: string): Promise<Part[]> {
  const parts: Part[] = [];
  let marker = "0";
  for (;;) {
    const url = objectUrl(b2, key);
    url.searchParams.set("uploadId", uploadId);
    url.searchParams.set("max-parts", "1000");
    url.searchParams.set("part-number-marker", marker);
    const xml = await call(b2, url);
    for (const p of tag(xml, "Part")) {
      parts.push({
        part: Number(tag(p, "PartNumber")[0]),
        etag: unxml(tag(p, "ETag")[0] ?? ""),
        size: Number(tag(p, "Size")[0] ?? 0),
      });
    }
    if (tag(xml, "IsTruncated")[0] !== "true") break;
    marker = tag(xml, "NextPartNumberMarker")[0] ?? "";
    if (!marker) break;
  }
  return parts.sort((a, b) => a.part - b.part);
}

// Les ETag sont relus côté serveur (listParts) : le navigateur n'a pas à
// les lire, donc pas besoin d'exposer l'en-tête ETag dans le CORS du bucket.
export async function completeMultipart(b2: B2, key: string, uploadId: string): Promise<number> {
  const parts = await listParts(b2, key, uploadId);
  if (!parts.length) throw new Error("B2 : aucune partie reçue");
  const body = "<CompleteMultipartUpload>" +
    parts.map((p) => `<Part><PartNumber>${p.part}</PartNumber><ETag>${p.etag}</ETag></Part>`).join("") +
    "</CompleteMultipartUpload>";
  const url = objectUrl(b2, key);
  url.searchParams.set("uploadId", uploadId);
  await call(b2, url, { method: "POST", body, headers: { "Content-Type": "application/xml" } });
  return parts.reduce((s, p) => s + p.size, 0);
}

export async function abortMultipart(b2: B2, key: string, uploadId: string): Promise<void> {
  const url = objectUrl(b2, key);
  url.searchParams.set("uploadId", uploadId);
  await call(b2, url, { method: "DELETE" }).catch(() => {});
}

// ---------------------------------------------------------- suppression
// B2 garde par défaut toutes les versions : un DELETE simple ne fait que
// masquer le fichier, qui reste stocké et facturé. On supprime donc chaque
// version explicitement, et on annule les uploads multipart abandonnés.

async function listVersions(b2: B2, prefix: string): Promise<{ key: string; version: string }[]> {
  const out: { key: string; version: string }[] = [];
  let keyMarker = "";
  let versionMarker = "";
  for (;;) {
    const url = new URL(b2.base);
    url.search = "versions";
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", "1000");
    if (keyMarker) url.searchParams.set("key-marker", keyMarker);
    if (versionMarker) url.searchParams.set("version-id-marker", versionMarker);
    const xml = await call(b2, url);
    for (const block of [...tag(xml, "Version"), ...tag(xml, "DeleteMarker")]) {
      const key = unxml(tag(block, "Key")[0] ?? "");
      const version = tag(block, "VersionId")[0] ?? "";
      if (key) out.push({ key, version });
    }
    if (tag(xml, "IsTruncated")[0] !== "true") break;
    keyMarker = unxml(tag(xml, "NextKeyMarker")[0] ?? "");
    versionMarker = tag(xml, "NextVersionIdMarker")[0] ?? "";
    if (!keyMarker) break;
  }
  return out;
}

export async function listUploads(b2: B2, prefix: string): Promise<{ key: string; uploadId: string; initiated: string }[]> {
  const url = new URL(b2.base);
  url.search = "uploads";
  url.searchParams.set("prefix", prefix);
  const xml = await call(b2, url);
  return tag(xml, "Upload").map((u) => ({
    key: unxml(tag(u, "Key")[0] ?? ""),
    uploadId: tag(u, "UploadId")[0] ?? "",
    initiated: tag(u, "Initiated")[0] ?? "",
  })).filter((u) => u.key && u.uploadId);
}

async function deleteVersion(b2: B2, key: string, version: string): Promise<void> {
  const url = objectUrl(b2, key);
  if (version) url.searchParams.set("versionId", version);
  await call(b2, url, { method: "DELETE" });
}

// Supprime tout ce qui commence par prefix (un fichier ou un espace entier).
export async function deletePrefix(b2: B2, prefix: string): Promise<number> {
  for (const u of await listUploads(b2, prefix)) await abortMultipart(b2, u.key, u.uploadId);

  const versions = await listVersions(b2, prefix);
  for (let i = 0; i < versions.length; i += 8) {
    await Promise.all(versions.slice(i, i + 8).map((v) => deleteVersion(b2, v.key, v.version)));
  }
  return new Set(versions.map((v) => v.key)).size;
}
