// Espace admin (page admin.html, liée nulle part) : tous les transferts,
// utilisateurs et espaces, en lecture seule.
//
// POST { action: "overview" }          -> { stats, users, transfers, spaces, files }
// POST { action: "sign", file_id }     -> { url, download }   (10 min)
// POST { action: "storage" }           -> ce que contient vraiment B2,
//                                          comparé à la base
// POST { action: "delete-files", file_ids }  -> retrait (contenu illicite, ménage)
// POST { action: "delete-transfer", transfer_id, with_files }
// POST { action: "delete-orphans" }          -> fichiers B2 sans fiche, envois abandonnés
// POST { action: "delete-space", space_id }  -> espace entier, fichiers compris
//
// Réservé aux adresses du secret ADMIN_EMAILS (séparées par des virgules,
// jamais écrites dans le dépôt, qui est public) : l'appelant doit être
// connecté au compte de cette adresse (session non anonyme, email
// confirmé). Déployée avec --no-verify-jwt : le JWT est vérifié ici.

import { admin } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { abortMultipart, b2Config, deletePrefix, listObjects, listUploads, presignGet } from "../_shared/b2.ts";
import { wipeSpace } from "../_shared/wipe.ts";

type Row = Record<string, unknown>;

const LIMIT = 5000;
const JAM_DAYS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Efface des fichiers : l'objet stocké d'abord (B2, toutes versions, ou
// ancien Storage), la fiche ensuite (commentaires et liens de transfert
// suivent en cascade ; un morceau de séminaire vide part avec).
async function removeFiles(db: ReturnType<typeof admin>, ids: string[]) {
  const { data: rows, error } = await db.from("files").select("id, storage_path, backend").in("id", ids);
  if (error) throw new Error(error.message);
  const b2 = b2Config();
  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  const list = (rows ?? []) as { id: string; storage_path: string; backend: string }[];
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async (f) => {
      try {
        if (f.backend === "b2") {
          if (!b2) throw new Error("B2 non configuré");
          await deletePrefix(b2, f.storage_path);
        } else {
          await db.storage.from("seminar").remove([f.storage_path]);
        }
        const { error: delErr } = await db.from("files").delete().eq("id", f.id);
        if (delErr) throw new Error(delErr.message);
        deleted.push(f.id);
      } catch (err) {
        failed.push({ id: f.id, error: (err as Error).message.slice(0, 200) });
      }
    }));
  }
  return { deleted, failed };
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

  // ------------------------------------------- écouter / télécharger
  if (body.action === "sign") {
    const fileId = String(body.file_id ?? "");
    if (!UUID.test(fileId)) return json({ error: "REQUETE_INVALIDE" }, 400);
    const { data: f } = await db.from("files").select("storage_path, backend, original_name").eq("id", fileId).maybeSingle();
    if (!f) return json({ error: "INTROUVABLE" }, 404);
    if (f.backend === "b2") {
      const b2 = b2Config();
      if (!b2) return json({ error: "B2_NON_CONFIGURE" }, 500);
      return json({
        url: await presignGet(b2, f.storage_path, 600),
        download: await presignGet(b2, f.storage_path, 600, f.original_name),
      });
    }
    const store = db.storage.from("seminar");
    const [a, b] = await Promise.all([
      store.createSignedUrl(f.storage_path, 600),
      store.createSignedUrl(f.storage_path, 600, { download: f.original_name }),
    ]);
    if (a.error || b.error) return json({ error: "INTROUVABLE" }, 404);
    return json({ url: a.data.signedUrl, download: b.data.signedUrl });
  }

  // ------------------------------------------------ retraits (modération)
  if (body.action === "delete-file" || body.action === "delete-files") {
    const ids = (body.action === "delete-file" ? [body.file_id] : (Array.isArray(body.file_ids) ? body.file_ids : []))
      .map(String).filter((id) => UUID.test(id)).slice(0, 200);
    if (!ids.length) return json({ error: "REQUETE_INVALIDE" }, 400);
    try {
      const r = await removeFiles(db, ids);
      console.log(`admin ${email} : ${r.deleted.length} fichier(s) supprimé(s), ${r.failed.length} échec(s)`);
      return json({ ok: !r.failed.length, ...r });
    } catch (err) {
      return json({ error: "ERREUR_STOCKAGE", detail: (err as Error).message.slice(0, 300) }, 502);
    }
  }

  if (body.action === "delete-transfer") {
    const transferId = String(body.transfer_id ?? "");
    if (!UUID.test(transferId)) return json({ error: "REQUETE_INVALIDE" }, 400);
    try {
      let files = { deleted: [] as string[], failed: [] as { id: string; error: string }[] };
      if (body.with_files) {
        const { data: tf } = await db.from("transfer_files").select("file_id").eq("transfer_id", transferId);
        const ids = (tf ?? []).map((r: { file_id: string }) => r.file_id);
        if (ids.length) files = await removeFiles(db, ids);
      }
      const { error } = await db.from("transfers").delete().eq("id", transferId);
      if (error) throw new Error(error.message);
      console.log(`admin ${email} : transfert ${transferId} supprimé (${files.deleted.length} fichiers)`);
      return json({ ok: !files.failed.length, files: files.deleted.length, failed: files.failed });
    } catch (err) {
      return json({ error: "ERREUR_STOCKAGE", detail: (err as Error).message.slice(0, 300) }, 502);
    }
  }

  // Ménage du bucket : objets sans fiche depuis plus d'une heure (un envoi
  // qui vient de finir n'a pas encore sa fiche), envois multipart
  // abandonnés depuis plus d'un jour.
  if (body.action === "delete-orphans") {
    const b2 = b2Config();
    if (!b2) return json({ error: "B2_NON_CONFIGURE" }, 500);
    try {
      const [objects, uploads, rows] = await Promise.all([
        listObjects(b2), listUploads(b2, ""), all(db, "files", "storage_path, backend"),
      ]);
      const known = new Set(rows.filter((r) => r.backend === "b2").map((r) => r.storage_path as string));
      const hourAgo = Date.now() - 3600e3;
      const dayAgo = Date.now() - 86400e3;
      const orphans = objects.filter((o) => !known.has(o.key) && (!o.modified || new Date(o.modified).getTime() < hourAgo));
      let bytes = 0;
      for (let i = 0; i < orphans.length; i += 8) {
        await Promise.all(orphans.slice(i, i + 8).map(async (o) => { await deletePrefix(b2, o.key); bytes += o.size; }));
      }
      const stale = uploads.filter((u) => u.initiated && new Date(u.initiated).getTime() < dayAgo);
      for (const u of stale) await abortMultipart(b2, u.key, u.uploadId).catch(() => {});
      console.log(`admin ${email} : ${orphans.length} orphelin(s), ${stale.length} envoi(s) abandonné(s) effacés`);
      return json({ ok: true, orphans: orphans.length, bytes, aborted: stale.length,
        kept_recent: objects.filter((o) => !known.has(o.key)).length - orphans.length });
    } catch (err) {
      return json({ error: "ERREUR_B2", detail: (err as Error).message.slice(0, 300) }, 500);
    }
  }
  if (body.action === "delete-space") {
    const spaceId = String(body.space_id ?? "");
    if (!UUID.test(spaceId)) return json({ error: "REQUETE_INVALIDE" }, 400);
    try {
      const files = await wipeSpace(db, spaceId);
      console.log(`admin ${email} : espace ${spaceId} supprimé (${files} fichiers)`);
      return json({ ok: true, files });
    } catch (err) {
      return json({ error: "ERREUR_STOCKAGE", detail: (err as Error).message.slice(0, 300) }, 502);
    }
  }

  // --------------------------------- emails : voie o2switch / Brevo
  if (body.action === "mail") {
    const since = new Date(Date.now() - 86400e3).toISOString();
    const [{ data: route }, { data: events }, { data: logs }] = await Promise.all([
      db.from("mail_route").select("*").eq("id", 1).maybeSingle(),
      db.from("mail_events").select("created_at, kind, detail").order("created_at", { ascending: false }).limit(20),
      db.from("mail_log").select("via, ok, bounced_at").gte("created_at", since).limit(5000),
    ]);
    const day: Record<string, { ok: number; failed: number; bounced: number }> = {};
    for (const l of logs ?? []) {
      const d = (day[l.via] ??= { ok: 0, failed: 0, bounced: 0 });
      if (l.bounced_at) d.bounced++;
      else if (l.ok) d.ok++;
      else d.failed++;
    }
    return json({
      smtp_configured: !!(Deno.env.get("SMTP_HOST") && Deno.env.get("SMTP_USER") && Deno.env.get("SMTP_PASS")),
      brevo_configured: !!Deno.env.get("BREVO_API_KEY"),
      route, events: events ?? [], day,
    });
  }
  if (body.action === "mail-pause" || body.action === "mail-resume") {
    const pause = body.action === "mail-pause";
    const { error } = await db.from("mail_route").update(pause
      ? { smtp_paused_until: "2100-01-01T00:00:00Z", manual: true, reason: "coupée à la main (admin)", updated_at: new Date().toISOString() }
      : { smtp_paused_until: null, manual: false, reason: null, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return json({ error: "ERREUR", detail: error.message }, 500);
    await db.from("mail_events").insert({ kind: pause ? "pause" : "resume", detail: "à la main, depuis l'admin" });
    return json({ ok: true });
  }

  // --------------------------------- le bucket B2, comparé à la base
  if (body.action === "storage") {
    const b2 = b2Config();
    if (!b2) return json({ error: "B2_NON_CONFIGURE" }, 500);
    try {
      const [objects, uploads, rows] = await Promise.all([
        listObjects(b2),
        listUploads(b2, ""),
        all(db, "files", "id, storage_path, backend, original_name, size_bytes"),
      ]);
      const known = new Map(rows.filter((r) => r.backend === "b2").map((r) => [r.storage_path as string, r]));
      const onB2 = new Set(objects.map((o) => o.key));
      const orphans = objects.filter((o) => !known.has(o.key));
      const missing = [...known.values()].filter((r) => !onB2.has(r.storage_path as string))
        .map((r) => ({ id: r.id, name: r.original_name, path: r.storage_path, size: Number(r.size_bytes) || 0 }));
      return json({
        objects: objects.length,
        bytes: objects.reduce((n, o) => n + o.size, 0),
        orphans: orphans.slice(0, 500),
        orphan_bytes: orphans.reduce((n, o) => n + o.size, 0),
        orphan_count: orphans.length,
        missing: missing.slice(0, 500),
        missing_count: missing.length,
        unfinished_uploads: uploads.length,
        legacy: rows.filter((r) => r.backend !== "b2").length,
      });
    } catch (err) {
      return json({ error: "ERREUR_B2", detail: (err as Error).message.slice(0, 300) }, 500);
    }
  }

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

    const [spaces, parts, files, transfers, recips, tfiles, senders, projects] = await Promise.all([
      all(db, "spaces", "id, code, name, mode, access, created_at, expires_at, purge_at, created_by", "created_at"),
      all(db, "participants", "id, space_id, user_id, pseudo, is_host, joined_at, last_seen_at"),
      all(db, "files", "id, space_id, project_id, original_name, mime_type, size_bytes, kind, status, created_at, uploaded_by, backend, version_no", "created_at"),
      all(db, "transfers", "id, space_id, sender_id, title, message, reply_to, expires_at, download_count, created_at", "created_at"),
      all(db, "transfer_recipients", "transfer_id, email, status, error, sent_at, first_opened_at, first_download_at"),
      all(db, "transfer_files", "transfer_id, file_id, position"),
      all(db, "sender_emails", "user_id, email, verified_at"),
      all(db, "projects", "id, title"),
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

    // ---------------------------------------------------------- fichiers
    const projectTitle = new Map(projects.map((p) => [p.id as string, p.title as string]));
    const inTransfer = new Set(tfiles.map((tf) => tf.file_id as string));
    const fileList = files.map((f) => {
      const s = spaceById.get(f.space_id as string);
      const up = partById.get(f.uploaded_by as string);
      const expires = s && s.mode === "seminaire"
        ? new Date(new Date(f.created_at as string).getTime() + JAM_DAYS * 86400000).toISOString()
        : s ? s.purge_at : null;
      return {
        id: f.id, name: f.original_name, mime: f.mime_type, size: Number(f.size_bytes) || 0,
        kind: f.kind, status: f.status, backend: f.backend, version: f.version_no, created_at: f.created_at,
        space: s ? s.name : null, mode: s ? s.mode : null, project: projectTitle.get(f.project_id as string) ?? null,
        uploader: up ? up.pseudo : null, expires, transfer: inTransfer.has(f.id as string),
      };
    });

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
      truncated: [spaces, parts, files, transfers, recips, tfiles, projects].some((l) => l.length >= LIMIT),
    };

    return json({ stats, users: userList, transfers: transferList, spaces: spaceList, files: fileList, generated_at: new Date().toISOString() });
  } catch (err) {
    return json({ error: "ERREUR_BASE", detail: (err as Error).message.slice(0, 300) }, 500);
  }
});
