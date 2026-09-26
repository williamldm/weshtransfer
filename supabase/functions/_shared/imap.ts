// Client IMAP minimal (TLS, port 993) : lire les rebonds et les rapports qui
// arrivent dans la boîte d'envoi o2switch. Lecture seule, sauf le drapeau
// \Seen posé sur ce qui a été traité. Mêmes identifiants que le SMTP.

const enc = new TextEncoder();
const dec = new TextDecoder();
const TIMEOUT_MS = 20000;

function quote(s: string): string {
  if (/[\r\n\0]/.test(s)) throw new Error("IMAP : caractère interdit");
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class Imap {
  private buf = new Uint8Array(0);
  private n = 0;
  private constructor(private conn: Deno.TlsConn) {}

  static async open(host: string, port = 993): Promise<Imap> {
    const im = new Imap(await Deno.connectTls({ hostname: host, port }));
    const hello = await im.line();
    if (!/^\* (OK|PREAUTH)/i.test(hello)) throw new Error(`IMAP : ${hello.slice(0, 200)}`);
    return im;
  }

  private async fill(): Promise<void> {
    const chunk = new Uint8Array(16384);
    let timer: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("IMAP : délai dépassé")), TIMEOUT_MS);
    });
    try {
      const got = await Promise.race([this.conn.read(chunk), timeout]);
      if (got === null) throw new Error("IMAP : connexion fermée");
      const next = new Uint8Array(this.buf.length + got);
      next.set(this.buf);
      next.set(chunk.subarray(0, got), this.buf.length);
      this.buf = next;
    } finally {
      clearTimeout(timer);
    }
  }

  private async line(): Promise<string> {
    for (;;) {
      const i = this.buf.findIndex((b, k) => b === 10 && k > 0 && this.buf[k - 1] === 13);
      if (i >= 0) {
        const out = dec.decode(this.buf.subarray(0, i - 1));
        this.buf = this.buf.subarray(i + 1);
        return out;
      }
      if (this.buf.length > 1 << 20) throw new Error("IMAP : ligne trop longue");
      await this.fill();
    }
  }

  private async bytes(len: number): Promise<string> {
    while (this.buf.length < len) await this.fill();
    const out = dec.decode(this.buf.subarray(0, len));
    this.buf = this.buf.subarray(len);
    return out;
  }

  // Envoie une commande, rend les réponses non étiquetées (littéraux
  // {n} recollés dans la ligne qui les annonce)
  async cmd(command: string): Promise<string[]> {
    const tag = `w${++this.n}`;
    await this.conn.write(enc.encode(`${tag} ${command}\r\n`));
    const out: string[] = [];
    for (;;) {
      let l = await this.line();
      let m: RegExpMatchArray | null;
      while ((m = l.match(/\{(\d+)\}$/))) {
        const lit = await this.bytes(Number(m[1]));
        l = l + "\n" + lit + (await this.line());
      }
      if (l.startsWith(tag + " ")) {
        if (!/^\S+ OK/i.test(l)) throw new Error(`IMAP ${command.split(" ")[0]} : ${l.slice(0, 200)}`);
        return out;
      }
      out.push(l);
    }
  }

  login(user: string, pass: string) {
    return this.cmd(`LOGIN ${quote(user)} ${quote(pass)}`);
  }

  async close() {
    await this.cmd("LOGOUT").catch(() => {});
    try { this.conn.close(); } catch { /* déjà fermée */ }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function imapDate(d: Date): string {
  return `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

// Messages non lus de la boîte de réception depuis `since` : uid et début
// du message brut (en-têtes + corps, `max` octets)
export async function unreadMessages(im: Imap, since: Date, limit = 40, max = 24000): Promise<{ uid: string; raw: string }[]> {
  await im.cmd("SELECT INBOX");
  const found = await im.cmd(`UID SEARCH UNSEEN SINCE ${imapDate(since)}`);
  const uids = found.join(" ").replace(/^\* SEARCH/i, "").trim().split(/\s+/).filter((u) => /^\d+$/.test(u)).slice(-limit);
  const out: { uid: string; raw: string }[] = [];
  for (const uid of uids) {
    const res = await im.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.${max}>)`);
    const raw = res.join("\n");
    out.push({ uid, raw: raw.slice(raw.indexOf("\n") + 1) });
  }
  return out;
}

export async function markSeen(im: Imap, uids: string[]): Promise<void> {
  if (!uids.length) return;
  await im.cmd(`UID STORE ${uids.join(",")} +FLAGS.SILENT (\\Seen)`);
}
