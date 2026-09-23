// Client SMTP minimal : TLS implicite (port 465), AUTH PLAIN, une connexion
// pour plusieurs messages. Les Edge Functions refusent les ports 25 et 587,
// d'où le 465. Corps et en-têtes encodés en base64 : aucun souci d'accents,
// de longueur de ligne ni de point en début de ligne.
//
// Secrets : SMTP_HOST (ex. mail.weshtransfer.fr), SMTP_USER (l'adresse
// complète de la boîte), SMTP_PASS, SMTP_PORT (facultatif, 465).

export type SmtpConfig = { host: string; port: number; user: string; pass: string };

export type SmtpMessage = {
  from: { name?: string; email: string };
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
};

export function smtpConfig(): SmtpConfig | null {
  const host = Deno.env.get("SMTP_HOST");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !user || !pass) return null;
  return { host, user, pass, port: Number(Deno.env.get("SMTP_PORT") || 465) };
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const TIMEOUT_MS = 20000;

function b64(text: string): string {
  const bytes = enc.encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function wrap76(s: string): string {
  return s.replace(/.{1,76}/g, "$&\r\n");
}

// En-tête non ASCII : mots encodés RFC 2047, découpés par caractères (jamais
// au milieu d'un caractère multi-octet), une ligne repliée par morceau.
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const chars = [...value];
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 30) parts.push(`=?UTF-8?B?${b64(chars.slice(i, i + 30).join(""))}?=`);
  return parts.join("\r\n ");
}

function address(email: string): string {
  // les adresses sont validées en amont ; ceinture et bretelles contre
  // l'injection d'en-têtes
  if (/[\r\n<>\s]/.test(email) || !email.includes("@")) throw new Error(`adresse refusée : ${email}`);
  return `<${email}>`;
}

function buildMessage(m: SmtpMessage): { id: string; data: string } {
  const domain = m.from.email.split("@")[1];
  const id = `${crypto.randomUUID()}@${domain}`;
  const boundary = `wt_${crypto.randomUUID().replace(/-/g, "")}`;
  const from = m.from.name ? `${encodeHeader(m.from.name)} ${address(m.from.email)}` : address(m.from.email);
  const headers = [
    `From: ${from}`,
    `To: ${address(m.to)}`,
    ...(m.replyTo ? [`Reply-To: ${address(m.replyTo)}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}>`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  const data = headers.join("\r\n") + "\r\n\r\n" +
    part("text/plain", m.text) + part("text/html", m.html) + `--${boundary}--\r\n`;
  return { id, data };
}

class Session {
  private buf = "";
  constructor(private conn: Deno.TlsConn) {}

  private async readLine(): Promise<string> {
    while (!this.buf.includes("\r\n")) {
      const chunk = new Uint8Array(4096);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("SMTP : connexion fermée par le serveur");
      this.buf += dec.decode(chunk.subarray(0, n));
    }
    const i = this.buf.indexOf("\r\n");
    const line = this.buf.slice(0, i);
    this.buf = this.buf.slice(i + 2);
    return line;
  }

  // Réponse complète (multi-lignes "250-...", dernière ligne "250 ...")
  async expect(codes: number[]): Promise<string> {
    let line: string;
    const all: string[] = [];
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("SMTP : délai dépassé")), TIMEOUT_MS);
    });
    try {
      do {
        line = await Promise.race([this.readLine(), timeout]);
        all.push(line);
      } while (/^\d{3}-/.test(line));
    } finally {
      clearTimeout(timer);
    }
    const code = Number(line.slice(0, 3));
    if (!codes.includes(code)) throw new Error(`SMTP ${all.join(" | ").slice(0, 300)}`);
    return all.join("\n");
  }

  async cmd(line: string, codes: number[]): Promise<string> {
    await this.conn.write(enc.encode(line + "\r\n"));
    return this.expect(codes);
  }

  async send(from: string, m: SmtpMessage): Promise<string> {
    const { id, data } = buildMessage(m);
    await this.cmd(`MAIL FROM:${address(from)}`, [250]);
    await this.cmd(`RCPT TO:${address(m.to)}`, [250, 251]);
    await this.cmd("DATA", [354]);
    // base64 partout : aucune ligne ne commence par un point, rien à échapper
    await this.conn.write(enc.encode(data + ".\r\n"));
    await this.expect([250]);
    return id;
  }

  close() {
    try { this.conn.close(); } catch { /* déjà fermée */ }
  }
}

// Ouvre une session authentifiée, envoie chaque message à la suite, rend un
// résultat par message (un refus n'arrête pas les suivants). Une erreur de
// connexion ou d'authentification fait échouer tout le lot.
export async function smtpSendAll(
  cfg: SmtpConfig,
  messages: SmtpMessage[],
): Promise<({ ok: true; id: string } | { ok: false; error: string })[]> {
  const conn = await Deno.connectTls({ hostname: cfg.host, port: cfg.port });
  const s = new Session(conn);
  try {
    await s.expect([220]);
    await s.cmd(`EHLO ${cfg.user.split("@")[1] || "localhost"}`, [250]);
    await s.cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, [235]);
    const results = [];
    for (const m of messages) {
      try {
        results.push({ ok: true as const, id: await s.send(cfg.user, m) });
      } catch (err) {
        results.push({ ok: false as const, error: (err as Error).message });
        // remet la transaction à zéro pour le message suivant
        await s.cmd("RSET", [250]).catch(() => {});
      }
    }
    await s.cmd("QUIT", [221]).catch(() => {});
    return results;
  } finally {
    s.close();
  }
}
