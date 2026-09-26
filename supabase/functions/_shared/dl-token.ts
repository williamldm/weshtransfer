// Jeton "téléchargement complet" : collé par transfer-open aux liens de
// téléchargement d'un envoi "jusqu'au premier téléchargement", relayé tel
// quel par le Worker Cloudflare quand le dernier octet est parti. Signé
// HMAC (secret DL_SECRET) : impossible d'en fabriquer un pour un autre
// fichier. Le Worker n'a aucun secret.

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("DL_SECRET") ?? "";
  if (secret.length < 32) return null;
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function makeDlToken(transferId: string, fileId: string): Promise<string | null> {
  const k = await key();
  if (!k) return null;
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(`${transferId}.${fileId}`));
  return `${transferId}.${fileId}.${b64url(sig)}`;
}

export async function readDlToken(token: string): Promise<{ transferId: string; fileId: string } | null> {
  const [transferId, fileId, sig] = String(token || "").split(".");
  if (!UUID.test(transferId ?? "") || !UUID.test(fileId ?? "") || !sig) return null;
  const expected = await makeDlToken(transferId, fileId);
  if (!expected) return null;
  const got = `${transferId}.${fileId}.${sig}`;
  if (got.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { transferId, fileId } : null;
}
