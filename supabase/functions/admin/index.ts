// Espace admin (page admin.html, liée nulle part) : tous les transferts,
// utilisateurs et espaces, en lecture seule.
//
// POST { action: "overview" } -> { stats, users, transfers, spaces }
//
// Réservé aux adresses du secret ADMIN_EMAILS (séparées par des virgules,
// jamais écrites dans le dépôt, qui est public) : l'appelant doit être
// connecté au compte de cette adresse (session non anonyme, email
// confirmé). Déployée avec --no-verify-jwt : le JWT est vérifié ici.

import { admin } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";

type Row = Record<string, unknown>;

const LIMIT = 5000;

function admins(): Set<string> {
  return new Set((Deno.env.get("ADMIN_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

async function all(db: ReturnType<typeof admin>, table: string, cols: string, order?: string): Promise<Row[]> {
  let q = db.from(table).select(cols).limit(LIMIT);
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(`${table} : ${error.message}`);
  return (data ?? []) as Row[];
}

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const db = admin();
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token.startsWith("sb_")) return json({ error: "NON_AUTHENTIFIE" }, 401);
  const { data: who, error: whoErr } = await db.auth.getUser(token);
  const me = who?.user;
  if (whoErr || !me) return json({ error: "NON_AUTHENTIFIE" }, 401);
  const email = (me.email ?? "").toLowerCase();
  const allowed = admins();
  if (me.is_anonymous || !me.email_confirmed_at || !email || !allowed.has(email)) {
    return json({ error: "INTERDIT" }, 403);
  }

  const body = await readJson(req);
  if (body.action !== "overview") return json({ error: "ACTION_INCONNUE" }, 400);

  try {
    // utilisateurs (auth) : par pages de 1000
    const authUsers: Row[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error("users : " + error.message);
      authUsers.push(...(data.users as unknown as Row[]));
      if (data.users.length < 1000) break;
    }

    const [spaces, parts, files, transfers, recips, tfiles, senders] = await Promise.all([
      all(db, "spaces", "id, code, name, mode, access, created_at, expires_at, purge_at, created_by", "created_at"),
      all(db, "participants", "id, space_id, user_id, pseudo, is_host, joined_at, last_seen_at"),
      all(db, "files", "id, space_id, project_id, original_name, size_bytes, kind, status, created_at, uploaded_by", "created_at"),
      all(db, "transfers", "id, space_id, sender_id, title, message, reply_to, expires_at, download_count, created_at", "created_at"),
      all(db, "transfer_recipients", "transfer_id, email, status, error, sent_at, first_opened_at, first_download_at"),
      all(db, "transfer_files", "transfer_id, file_id, position"),
      all(db, "sender_emails", "user_id, email, verified_at"),
    ]);

    const spaceById = new Map(spaces.map((s) => [s.id as string, s]));
    const partById = new Map(parts.map((p) => [p.id as string, p]));
    const fileById = new Map(files.map((f) => [f.id as string, f]));

    // ---------------------------------------------------------- espaces
    const bySpace = new Map<string, { members: number; host: string; files: number; bytes: number }>();
    for (const s of spaces) bySpace.set(s.id as string, { members: 0, host: "", files: 0, bytes: 0 });
    for (const p of parts) {
      const agg = bySpace.get(p.space_id as string);
      if (!agg) continue;
      agg.members++;
      if (p.is_host) agg.host = p.pseudo as string;
    }
    for (const f of files) {
      const agg = bySpace.get(f.space_id as string);
      if (!agg) continue;
      agg.files++;
      agg.bytes += Number(f.size_bytes) || 0;
    }
    const spaceList = spaces.map((s) => ({
      id: s.id, name: s.name, code: s.code, mode: s.mode, access: s.access,
      created_at: s.created_at, purge_at: s.purge_at, ...bySpace.get(s.id as string),
    }));

    // -------------------------------------------------------- transferts
    const filesOf = new Map<string, Row[]>();
    for (const tf of tfiles) {
      const f = fileById.get(tf.file_id as string);
      if (!f) continue;
      const list = filesOf.get(tf.transfer_id as string) ?? [];
      list.push({ name: f.original_name, size: Number(f.size_bytes) || 0 });
      filesOf.set(tf.transfer_id as string, list);
    }
    const recipsOf = new Map<string, Row[]>();
    for (const r of recips) {
      const list = recipsOf.get(r.transfer_id as string) ?? [];
      list.push({ email: r.email, status: r.status, error: r.error, opened: r.first_opened_at, downloaded: r.first_download_at });
      recipsOf.set(r.transfer_id as string, list);
    }
    const transferList = transfers.map((t) => {
      const fl = filesOf.get(t.id as string) ?? [];
      const sender = partById.get(t.sender_id as string);
      const space = spaceById.get(t.space_id as string);
      return {
        id: t.id, title: t.title, message: t.message, created_at: t.created_at, expires_at: t.expires_at,
        downloads: t.download_count, sender: sender ? sender.pseudo : null, sender_email: t.reply_to,
        sender_user: sender ? sender.user_id : null,
        space: space ? space.name : null, files: fl, size: fl.reduce((n, f) => n + (f.size as number), 0),
        recipients: recipsOf.get(t.id as string) ?? [],
      };
    });

    // ----------------------------------------------------- utilisateurs
    const partsOf = new Map<string, Row[]>();
    for (const p of parts) {
      const list = partsOf.get(p.user_id as string) ?? [];
      list.push(p);
      partsOf.set(p.user_id as string, list);
    }
    const emailsOf = new Map<string, string[]>();
    for (const s of senders) {
      if (!s.verified_at) continue;
      const list = emailsOf.get(s.user_id as string) ?? [];
      list.push(s.email as string);
      emailsOf.set(s.user_id as string, list);
    }
    const sentBy = new Map<string, number>();
    const uploadedBy = new Map<string, { files: number; bytes: number }>();
    for (const t of transfers) {
      const p = partById.get(t.sender_id as string);
      if (p) sentBy.set(p.user_id as string, (sentBy.get(p.user_id as string) ?? 0) + 1);
    }
    for (const f of files) {
      const p = partById.get(f.uploaded_by as string);
      if (!p) continue;
      const u = uploadedBy.get(p.user_id as string) ?? { files: 0, bytes: 0 };
      u.files++;
      u.bytes += Number(f.size_bytes) || 0;
      uploadedBy.set(p.user_id as string, u);
    }
    const userList = authUsers.map((u) => {
      const ps = partsOf.get(u.id as string) ?? [];
      return {
        id: u.id, email: u.email || null, anonymous: !!u.is_anonymous,
        created_at: u.created_at, last_sign_in_at: u.last_sign_in_at,
        pseudos: [...new Set(ps.map((p) => p.pseudo as string))],
        spaces: ps.map((p) => {
          const s = spaceById.get(p.space_id as string);
          return { name: s ? s.name : "?", mode: s ? s.mode : null, host: !!p.is_host };
        }),
        emails: emailsOf.get(u.id as string) ?? [],
        transfers: sentBy.get(u.id as string) ?? 0,
        ...(uploadedBy.get(u.id as string) ?? { files: 0, bytes: 0 }),
      };
    }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const bytes = files.reduce((n, f) => n + (Number(f.size_bytes) || 0), 0);
    const stats = {
      users: userList.length,
      accounts: userList.filter((u) => !u.anonymous && u.email).length,
      spaces: spaces.length,
      spaces_by_mode: spaces.reduce((m: Record<string, number>, s) => { m[s.mode as string] = (m[s.mode as string] ?? 0) + 1; return m; }, {}),
      transfers: transfers.length,
      recipients: recips.length,
      downloads: transfers.reduce((n, t) => n + (Number(t.download_count) || 0), 0),
      files: files.length,
      bytes,
      truncated: [spaces, parts, files, transfers, recips, tfiles].some((l) => l.length >= LIMIT),
    };

    return json({ stats, users: userList, transfers: transferList, spaces: spaceList, generated_at: new Date().toISOString() });
  } catch (err) {
    return json({ error: "ERREUR_BASE", detail: (err as Error).message.slice(0, 300) }, 500);
  }
});
