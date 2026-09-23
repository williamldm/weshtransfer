// Page publique d'un envoi (t.html?k=...). Aucune session requise : le
// token EST l'autorisation. Deployee avec --no-verify-jwt.
//
// POST { k }                               -> contenu de l'envoi + URLs signees
// POST { k, action: "download" }           -> comptabilise un telechargement
//
// Deux sortes de token : celui d'un destinataire (lien personnel, permet
// de savoir qui a telecharge) ou celui de l'envoi (lien partage).

import { admin } from "../_shared/supabase.ts";
import { json, preflight, readJson } from "../_shared/http.ts";
import { downloadNoticeMail, mailConfig, sendEmails } from "../_shared/email.ts";
import { b2Config, presignGet } from "../_shared/b2.ts";

const URL_TTL = 6 * 3600;

type Transfer = {
  id: string;
  title: string;
  message: string | null;
  reply_to: string | null;
  notify_sender: boolean;
  expires_at: string;
  sender: { pseudo: string } | null;
  space: { name: string; purge_at: string } | null;
};

const TRANSFER_COLS =
  "id, title, message, reply_to, notify_sender, expires_at, sender:participants(pseudo), space:spaces(name, purge_at)";

Deno.serve(async (req) => {
  const early = preflight(req);
  if (early) return early;

  const body = await readJson(req);
  const k = typeof body.k === "string" ? body.k : "";
  if (!/^[0-9a-f]{32}$/.test(k)) return json({ error: "LIEN_INCONNU" }, 404);

  const db = admin();

  // 1. lien personnel d'un destinataire ?
  const { data: recipient } = await db
    .from("transfer_recipients")
    .select("id, email, transfer_id, first_opened_at")
    .eq("token", k)
    .maybeSingle();

  // 2. sinon, lien partage de l'envoi
  const query = db.from("transfers").select(TRANSFER_COLS);
  const { data: transfer } = await (recipient
    ? query.eq("id", recipient.transfer_id)
    : query.eq("token", k)
  ).maybeSingle<Transfer>();

  if (!transfer) return json({ error: "LIEN_INCONNU" }, 404);

  const expired = new Date(transfer.expires_at) < new Date()
    || (transfer.space && new Date(transfer.space.purge_at) < new Date());

  if (expired) {
    return json({
      error: "LIEN_EXPIRE",
      title: transfer.title,
      sender: transfer.sender?.pseudo ?? null,
    }, 410);
  }

  // ---------------------------------------------- comptage d'un telechargement
  if (body.action === "download") {
    const { data: reg } = await db.rpc("register_transfer_download", {
      p_transfer: transfer.id,
      p_recipient: recipient?.id ?? null,
    });

    const first = !!(reg as { first?: boolean } | null)?.first;
    const cfg = mailConfig();

    // L'expediteur est prevenu une fois par destinataire (ou une fois pour le
    // lien partage), jamais a chaque clic.
    if (first && cfg && transfer.notify_sender && transfer.reply_to) {
      const mail = downloadNoticeMail({
        who: recipient?.email ?? null,
        title: transfer.title,
        spaceName: transfer.space?.name ?? "",
      });
      await sendEmails(cfg, [{
        to: transfer.reply_to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }]);
    }
    return json({ ok: true });
  }

  // ------------------------------------------------------ ouverture de la page
  if (recipient && !recipient.first_opened_at) {
    await db.from("transfer_recipients")
      .update({ first_opened_at: new Date().toISOString() })
      .eq("id", recipient.id);
  }

  const { data: items, error } = await db
    .from("transfer_files")
    .select(`position, file:files(
      id, original_name, size_bytes, kind, duration_sec, peaks, label, version_no,
      mime_type, storage_path, backend,
      project:projects(title),
      uploader:participants(pseudo)
    )`)
    .eq("transfer_id", transfer.id)
    .order("position");

  if (error) return json({ error: "ERREUR_BASE", detail: error.message }, 500);

  type FileRow = {
    id: string; original_name: string; size_bytes: number | null; kind: string;
    duration_sec: number | null; peaks: number[] | null; label: string | null;
    version_no: number; mime_type: string | null; storage_path: string; backend: string;
    project: { title: string } | null; uploader: { pseudo: string } | null;
  };

  const files = (items ?? [])
    .map((i) => (i as unknown as { file: FileRow | null }).file)
    .filter((f): f is FileRow => !!f);

  // URLs signées selon l'endroit où vit chaque fichier (Storage ou B2)
  const urls = new Map<string, { url: string; download: string }>();
  const onSupabase = files.filter((f) => f.backend !== "b2");
  if (onSupabase.length) {
    const { data } = await db.storage.from("seminar")
      .createSignedUrls(onSupabase.map((f) => f.storage_path), URL_TTL);
    const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
    for (const f of onSupabase) {
      const url = byPath.get(f.storage_path);
      if (url) urls.set(f.id, { url, download: `${url}&download=${encodeURIComponent(f.original_name)}` });
    }
  }
  const b2 = b2Config();
  if (b2) {
    await Promise.all(files.filter((f) => f.backend === "b2").map(async (f) => {
      urls.set(f.id, {
        url: await presignGet(b2, f.storage_path, URL_TTL),
        download: await presignGet(b2, f.storage_path, URL_TTL, f.original_name),
      });
    }));
  }

  return json({
    title: transfer.title,
    message: transfer.message,
    sender: transfer.sender?.pseudo ?? null,
    space: transfer.space?.name ?? null,
    expires_at: transfer.expires_at,
    recipient: recipient?.email ?? null,
    files: files.map((f) => {
      const signed = urls.get(f.id);
      return {
        id: f.id,
        name: f.original_name,
        size: f.size_bytes,
        kind: f.kind,
        duration: f.duration_sec,
        peaks: f.peaks,
        label: f.label,
        version: f.version_no,
        mime: f.mime_type,
        project: f.project?.title ?? null,
        uploader: f.uploader?.pseudo ?? null,
        url: signed?.url ?? null,
        download_url: signed?.download ?? null,
      };
    }),
  });
});
