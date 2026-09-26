// Espace admin (admin.html, liée nulle part) : tous les transferts,
// utilisateurs et espaces, en lecture seule. La page ne décide de rien :
// c'est la fonction "admin" qui vérifie que le compte connecté fait partie
// des administrateurs, et qui renvoie les données.

import { invoke } from "./db.js?v=91";
import { accountEmail, login, logout } from "./session.js?v=91";
import { ensureVerified } from "./verify.js?v=91";
import { icon } from "./icons.js?v=91";
import { esc, toast, errorText, formatBytes, formatDate, timeAgo, plural, fileBadge, confirmSheet } from "./ui.js?v=91";
import { isAudio, categoryOf } from "./files.js?v=91";

const root = document.getElementById("adm");
const who = document.getElementById("who");

const MODES = { envoi: "Envois", seminaire: "Séminaire", revue: "Verdict" };
const STATUS = { pending: "en attente", sent: "envoyé", failed: "échec", bounced: "rejeté" };

let data = null;
let tab = "transfers";
let query = "";
let fileSort = "recent";
let storage = null;      // résultat de la vérification B2
let mail = null;         // état des voies d'envoi (o2switch / Brevo)
const selected = new Set();   // fichiers cochés (suppression groupée)

function drawWho() {
  const email = accountEmail();
  who.innerHTML = email
    ? esc(email) + ' <button class="btn btn-ghost btn-sm" data-logout>' + icon("logout", 16) + "<span>Déconnexion</span></button>"
    : "";
}

// ------------------------------------------------------------ connexion

function drawLogin(message) {
  root.innerHTML =
    '<section class="adm-login">' +
      "<h1>Admin</h1>" +
      '<p class="muted">' + esc(message || "Connecte-toi avec l'adresse administrateur : un code à 6 chiffres arrive par email.") + "</p>" +
      '<form data-login novalidate>' +
        '<label class="field"><span class="label">Email</span>' +
          '<input class="input" type="email" name="email" autocomplete="email" required value="' + esc(accountEmail() || "") + '"></label>' +
        '<button class="btn btn-primary btn-block" type="submit">Continuer</button>' +
      "</form>" +
    "</section>";
  root.querySelector("[data-login]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("Adresse invalide", "err"); return; }
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      if (await ensureVerified(email, { optional: false }) !== "ok") return;
      await login(email);
      drawWho();
      await load();
    } catch (err) {
      toast(errorText(err), "err");
    } finally {
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------------------ données

async function load() {
  root.innerHTML = '<div class="skeleton tall"></div><div class="skeleton"></div>';
  try {
    data = await invoke("admin", { action: "overview" });
    draw();
  } catch (err) {
    const code = String(err && err.message);
    if (code === "INTERDIT") drawLogin(accountEmail() ? "Le compte " + accountEmail() + " n'a pas accès à cette page." : "");
    else if (code === "NON_AUTHENTIFIE") drawLogin();
    else root.innerHTML = '<p class="adm-error">' + esc(errorText(err)) + ' <button class="btn btn-sm" data-reload>Réessayer</button></p>';
  }
}

const matches = (obj) => !query || JSON.stringify(obj).toLowerCase().includes(query);
const when = (iso) => (iso ? '<span title="' + esc(formatDate(iso, true)) + '">' + esc(timeAgo(iso)) + "</span>" : "jamais");

function stat(label, value, sub) {
  return '<div class="adm-stat"><b>' + esc(String(value)) + "</b><span>" + esc(label) + "</span>" + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
}

function drawTransfers() {
  const list = data.transfers.filter(matches);
  if (!list.length) return '<p class="adm-empty">Aucun transfert.</p>';
  return list.map((t) => {
    const opened = t.recipients.filter((r) => r.opened).length;
    const got = t.recipients.filter((r) => r.downloaded).length;
    return '<details class="adm-row">' +
      "<summary>" +
        '<span class="adm-main"><b>' + esc(t.title || "Sans titre") + "</b>" +
          "<small>" + esc(t.sender || "?") + (t.sender_email ? " · " + esc(t.sender_email) : "") + " · " + when(t.created_at) + "</small></span>" +
        '<span class="adm-nums"><span>' + plural(t.files.length, "fichier", "fichiers") + " · " + esc(formatBytes(t.size)) + "</span>" +
          "<small>" + plural(t.recipients.length, "destinataire", "destinataires") + " · " + opened + " ouvert · " + t.downloads + " dl</small></span>" +
      "</summary>" +
      '<div class="adm-detail">' +
        (t.message ? '<p class="adm-msg">' + esc(t.message) + "</p>" : "") +
        "<h4>Destinataires</h4><ul>" + (t.recipients.length ? t.recipients.map((r) =>
          "<li>" + esc(r.email) + ' <span class="adm-pill">' + esc(STATUS[r.status] || r.status || "") + "</span>" +
            (r.opened ? ' <span class="adm-pill is-ok">ouvert ' + esc(timeAgo(r.opened)) + "</span>" : "") +
            (r.downloaded ? ' <span class="adm-pill is-ok">téléchargé</span>' : "") +
            (r.error ? ' <span class="adm-pill is-err">' + esc(r.error) + "</span>" : "") + "</li>").join("") : "<li>Lien seul, sans email</li>") + "</ul>" +
        "<h4>Fichiers</h4><ul>" + t.files.map((f) => "<li>" + esc(f.name) + ' <span class="muted">' + esc(formatBytes(f.size)) + "</span></li>").join("") + "</ul>" +
        '<p class="muted small">Espace : ' + esc(t.space || "?") + " · expire " + esc(formatDate(t.expires_at, true)) + " · " + got + " destinataire(s) ont téléchargé</p>" +
        '<p class="adm-links">' +
          '<button class="btn btn-sm btn-danger" data-del-transfer="' + esc(t.id) + '" data-with-files="1">' + icon("trash", 16) + "<span>Supprimer le transfert et ses fichiers</span></button>" +
          '<button class="btn btn-sm" data-del-transfer="' + esc(t.id) + '" data-with-files="0">' + icon("link", 16) + "<span>Couper le lien seulement</span></button>" +
        "</p>" +
      "</div>" +
    "</details>";
  }).join("");
}

function drawUsers() {
  const list = data.users.filter(matches);
  if (!list.length) return '<p class="adm-empty">Aucun utilisateur.</p>';
  return list.map((u) =>
    '<details class="adm-row">' +
      "<summary>" +
        '<span class="adm-main"><b>' + (u.email ? esc(u.email) : u.pseudos.length ? esc(u.pseudos.join(", ")) : "Anonyme") + "</b>" +
          "<small>" + (u.anonymous ? "appareil anonyme" : "compte") + (u.email && u.pseudos.length ? " · " + esc(u.pseudos.join(", ")) : "") +
            " · créé " + when(u.created_at) + "</small></span>" +
        '<span class="adm-nums"><span>' + plural(u.spaces.length, "espace", "espaces") + " · " + plural(u.transfers, "transfert", "transferts") + "</span>" +
          "<small>" + plural(u.files, "fichier", "fichiers") + " · " + esc(formatBytes(u.bytes)) + "</small></span>" +
      "</summary>" +
      '<div class="adm-detail">' +
        "<h4>Espaces</h4><ul>" + (u.spaces.length ? u.spaces.map((s) =>
          "<li>" + esc(s.name) + ' <span class="adm-pill">' + esc(MODES[s.mode] || s.mode || "") + "</span>" + (s.host ? ' <span class="adm-pill is-ok">host</span>' : "") + "</li>").join("") : "<li>Aucun</li>") + "</ul>" +
        (u.emails.length ? "<h4>Emails vérifiés</h4><ul>" + u.emails.map((e) => "<li>" + esc(e) + "</li>").join("") + "</ul>" : "") +
        '<p class="muted small">Dernière connexion : ' + when(u.last_sign_in_at) + ' · <span class="mono">' + esc(u.id) + "</span></p>" +
      "</div>" +
    "</details>").join("");
}

function drawSpaces() {
  const list = data.spaces.filter(matches);
  if (!list.length) return '<p class="adm-empty">Aucun espace.</p>';
  return list.map((s) =>
    '<div class="adm-row is-flat">' +
      '<span class="adm-main"><b>' + esc(s.name) + ' <span class="adm-pill">' + esc(MODES[s.mode] || s.mode) + "</span></b>" +
        '<small><span class="mono">' + esc(s.code) + "</span> · host " + esc(s.host || "?") + " · créé " + when(s.created_at) +
          " · " + (s.purge_at ? "effacé le " + esc(formatDate(s.purge_at)) : "conservé") + "</small></span>" +
      '<span class="adm-nums"><span>' + plural(s.members, "membre", "membres") + "</span>" +
        "<small>" + plural(s.files, "fichier", "fichiers") + " · " + esc(formatBytes(s.bytes)) + "</small></span>" +
      '<button class="btn btn-ghost btn-icon btn-sm" data-del-space="' + esc(s.id) + '" aria-label="Supprimer l\'espace" title="Supprimer l\'espace">' + icon("trash", 16) + "</button>" +
    "</div>").join("");
}

const FILE_STATUS = { ready: "", uploading: "en cours d'envoi", failed: "échec", pending: "en attente" };

function drawStorage() {
  if (!storage) {
    return '<div class="adm-storage"><span class="muted small">Ce que contient vraiment le stockage B2, comparé à la base : fichiers orphelins (sur B2 sans fiche), fiches sans fichier, envois inachevés.</span>' +
      '<button class="btn btn-sm" data-storage>' + icon("layers", 16) + "<span>Vérifier le stockage B2</span></button></div>";
  }
  if (storage.loading) return '<div class="adm-storage"><span class="muted small">Lecture du bucket B2...</span></div>';
  const s = storage;
  return '<div class="adm-storage is-done">' +
    '<div class="adm-storage-nums">' +
      "<span><b>" + s.objects + "</b> objets sur B2 · " + esc(formatBytes(s.bytes)) + "</span>" +
      '<span class="' + (s.orphan_count ? "is-warn" : "") + '"><b>' + s.orphan_count + "</b> orphelin" + (s.orphan_count > 1 ? "s" : "") + (s.orphan_count ? " · " + esc(formatBytes(s.orphan_bytes)) : "") + "</span>" +
      '<span class="' + (s.missing_count ? "is-warn" : "") + '"><b>' + s.missing_count + "</b> fiche" + (s.missing_count > 1 ? "s" : "") + " sans fichier</span>" +
      "<span><b>" + s.unfinished_uploads + "</b> envoi" + (s.unfinished_uploads > 1 ? "s" : "") + " inachevé" + (s.unfinished_uploads > 1 ? "s" : "") + "</span>" +
      (s.legacy ? "<span><b>" + s.legacy + "</b> sur l'ancien stockage Supabase</span>" : "") +
    "</div>" +
    (s.orphans.length ? "<h4>Orphelins (sur B2, inconnus de la base)</h4><ul>" + s.orphans.map((o) =>
      '<li><span class="mono">' + esc(o.key) + "</span> · " + esc(formatBytes(o.size)) + (o.modified ? " · " + esc(timeAgo(o.modified)) : "") + "</li>").join("") + "</ul>" : "") +
    (s.missing.length ? "<h4>Fiches sans fichier sur B2</h4><ul>" + s.missing.map((m) =>
      "<li>" + esc(m.name) + ' · <span class="mono">' + esc(m.path) + "</span></li>").join("") + "</ul>" : "") +
    '<p class="adm-links">' +
      (s.orphan_count || s.unfinished_uploads
        ? '<button class="btn btn-sm btn-danger" data-clean-orphans>' + icon("trash", 16) + "<span>Nettoyer : " +
            plural(s.orphan_count, "orphelin", "orphelins") + (s.unfinished_uploads ? " + " + plural(s.unfinished_uploads, "envoi abandonné", "envois abandonnés") : "") + "</span></button>"
        : "") +
      '<button class="btn btn-ghost btn-sm" data-storage>' + icon("retry", 16) + "<span>Revérifier</span></button>" +
    "</p>" +
  "</div>";
}

function visibleFiles() {
  let list = data.files.filter(matches);
  if (fileSort === "size") list = list.slice().sort((a, b) => b.size - a.size);
  return list;
}

function drawFiles() {
  const list = visibleFiles();
  const total = list.reduce((n, f) => n + f.size, 0);
  const allOn = list.length && list.every((f) => selected.has(f.id));
  return drawStorage() +
    '<div class="adm-subbar">' +
      '<label class="adm-check-all"><input type="checkbox" data-sel-all' + (allOn ? " checked" : "") + (list.length ? "" : " disabled") + ">" +
        '<span class="muted small">' + plural(list.length, "fichier", "fichiers") + " · " + esc(formatBytes(total)) + "</span></label>" +
      '<select class="input adm-sort" data-sort><option value="recent"' + (fileSort === "recent" ? " selected" : "") + '>Plus récents</option>' +
        '<option value="size"' + (fileSort === "size" ? " selected" : "") + ">Plus lourds</option></select></div>" +
    (list.length ? list.map((f) =>
      '<div class="adm-row adm-file-row' + (selected.has(f.id) ? " is-selected" : "") + '">' +
        '<label class="adm-check" aria-label="Sélectionner ' + esc(f.name) + '"><input type="checkbox" data-sel="' + esc(f.id) + '"' + (selected.has(f.id) ? " checked" : "") + "></label>" +
        '<details data-file="' + esc(f.id) + '">' +
          "<summary>" +
            '<span class="adm-file-badge">' + fileBadge(f.name, f.mime, f.kind) + "</span>" +
            '<span class="adm-main"><b>' + esc(f.name) + "</b>" +
              "<small>" + esc(f.space || "?") + (f.mode ? " (" + esc(MODES[f.mode] || f.mode) + ")" : "") +
                (f.project ? " · " + esc(f.project) + (f.version > 1 ? " v" + f.version : "") : "") +
                " · " + esc(f.uploader || "?") + " · " + when(f.created_at) + "</small></span>" +
            '<span class="adm-nums"><span>' + esc(formatBytes(f.size)) + "</span>" +
              "<small>" + (FILE_STATUS[f.status] ? '<span class="adm-pill is-err">' + esc(FILE_STATUS[f.status]) + "</span> " : "") +
                (f.transfer ? "transfert · " : "") +
                (f.expires ? "effacé " + esc(formatDate(f.expires)) : "conservé") + "</small></span>" +
          "</summary>" +
          '<div class="adm-detail" data-preview><p class="muted small">Chargement...</p></div>' +
        "</details>" +
        '<button class="btn btn-ghost btn-icon btn-sm adm-trash" data-del-file="' + esc(f.id) + '" aria-label="Supprimer ' + esc(f.name) + '" title="Supprimer">' + icon("trash", 16) + "</button>" +
      "</div>").join("") : '<p class="adm-empty">Aucun fichier.</p>');
}

// Barre du bas quand des fichiers sont cochés
function drawSelection() {
  let bar = document.querySelector("[data-selbar]");
  const picked = data ? data.files.filter((f) => selected.has(f.id)) : [];
  if (tab !== "files" || !picked.length) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "adm-selbar";
    bar.setAttribute("data-selbar", "");
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => {
      if (e.target.closest("[data-sel-none]")) { selected.clear(); drawList(); drawSelection(); }
      if (e.target.closest("[data-sel-delete]")) deleteFiles([...selected]);
    });
  }
  const bytes = picked.reduce((n, f) => n + f.size, 0);
  bar.innerHTML = "<span><b>" + plural(picked.length, "fichier sélectionné", "fichiers sélectionnés") + "</b> · " + esc(formatBytes(bytes)) + "</span>" +
    '<button class="btn btn-ghost btn-sm" data-sel-none>Tout désélectionner</button>' +
    '<button class="btn btn-sm btn-danger" data-sel-delete>' + icon("trash", 16) + "<span>Supprimer</span></button>";
}

// Suppression (un ou plusieurs fichiers) : confirmée, définitive, B2 compris.
async function deleteFiles(ids) {
  const picked = data.files.filter((f) => ids.includes(f.id));
  if (!picked.length) return;
  const bytes = picked.reduce((n, f) => n + f.size, 0);
  const ok = await confirmSheet(
    (picked.length === 1 ? picked[0].name + " sera effacé du stockage et de son espace"
      : plural(picked.length, "fichier sera effacé", "fichiers seront effacés") + " du stockage et de leur espace") +
      " (" + formatBytes(bytes) + "). Définitif.",
    { ok: "Supprimer", danger: true, title: picked.length === 1 ? "Supprimer ce fichier" : "Supprimer " + picked.length + " fichiers" });
  if (!ok) return;
  let deleted = [];
  let failed = [];
  try {
    // par paquets de 100 (limite de la fonction)
    for (let i = 0; i < ids.length; i += 100) {
      const r = await invoke("admin", { action: "delete-files", file_ids: ids.slice(i, i + 100) });
      deleted = deleted.concat(r.deleted || []);
      failed = failed.concat(r.failed || []);
    }
  } catch (err) {
    toast(errorText(err), "err");
  }
  // la liste se met à jour sans tout recharger
  const gone = new Set(deleted);
  data.files = data.files.filter((f) => !gone.has(f.id));
  for (const id of gone) selected.delete(id);
  data.stats.files -= gone.size;
  data.stats.bytes -= picked.filter((f) => gone.has(f.id)).reduce((n, f) => n + f.size, 0);
  if (deleted.length) toast(plural(deleted.length, "fichier supprimé", "fichiers supprimés"), "ok");
  if (failed.length) toast(plural(failed.length, "échec", "échecs") + " : " + failed[0].error, "err");
  draw();
  drawSelection();
}

// Aperçu à l'ouverture d'une ligne : lecteur, image ou vidéo, et lien de
// téléchargement (URL signée 10 minutes, demandée à la fonction admin).
async function openPreview(row) {
  const box = row.querySelector("[data-preview]");
  if (!box || box.dataset.done) return;
  box.dataset.done = "1";
  const f = data.files.find((x) => x.id === row.dataset.file);
  try {
    const r = await invoke("admin", { action: "sign", file_id: f.id });
    const cat = categoryOf(f.name, f.mime);
    const media = isAudio(f.name, f.mime)
      ? '<audio controls preload="metadata" src="' + esc(r.url) + '"></audio>'
      : cat === "image" ? '<img class="adm-preview" src="' + esc(r.url) + '" alt="">'
      : cat === "video" ? '<video class="adm-preview" controls preload="metadata" src="' + esc(r.url) + '"></video>'
      : "";
    box.innerHTML = media +
      '<p class="adm-links"><a class="btn btn-sm" href="' + esc(r.download) + '" rel="noopener">' + icon("download", 16) + "<span>Télécharger</span></a>" +
        '<button class="btn btn-sm btn-danger" data-del-file="' + esc(f.id) + '">' + icon("trash", 16) + "<span>Supprimer</span></button>" +
        '<span class="muted small">Lien valable 10 minutes · <span class="mono">' + esc(f.id) + "</span> · " + esc(f.backend || "") + "</span></p>";
  } catch (err) {
    box.innerHTML = '<p class="muted small">Aperçu impossible : ' + esc(errorText(err)) + "</p>" +
      '<p class="adm-links"><button class="btn btn-sm btn-danger" data-del-file="' + esc(f.id) + '">' + icon("trash", 16) + "<span>Supprimer</span></button></p>";
    delete box.dataset.done;
  }
}

async function checkStorage() {
  storage = { loading: true };
  drawList();
  try {
    storage = await invoke("admin", { action: "storage" });
  } catch (err) {
    storage = null;
    toast(errorText(err), "err");
  }
  drawList();
}

// ------------------------------------------------------------ emails

async function loadMail() {
  mail = { loading: true };
  try {
    mail = await invoke("admin", { action: "mail" });
  } catch (err) {
    mail = { error: errorText(err) };
  }
  drawList();
}

const EVENT = { pause: "Coupure", resume: "Reprise", blacklist: "Liste noire", bounce: "Rebond", engagement: "Ouvertures", probe: "Sonde", error: "Erreur" };

function drawMail() {
  if (!mail || mail.loading) return '<div class="skeleton tall"></div>';
  if (mail.error) return '<p class="adm-error">' + esc(mail.error) + "</p>";
  const r = mail.route || {};
  const paused = r.smtp_paused_until && new Date(r.smtp_paused_until) > new Date();
  const state = !mail.smtp_configured ? "non configurée (tout part par Brevo)"
    : paused ? (r.manual ? "coupée à la main" : "coupée jusqu'au " + formatDate(r.smtp_paused_until, true)) : "active";
  const d = mail.day || {};
  const line = (via, label) => {
    const x = d[via] || { ok: 0, failed: 0, bounced: 0 };
    return stat(label + " (24 h)", x.ok, x.failed + " refusés · " + x.bounced + " rebonds");
  };
  const chk = r.last_check || {};
  const opens = chk.opens ? "o2switch " + chk.opens.smtp.opened + "/" + chk.opens.smtp.n + " · Brevo " + chk.opens.brevo.opened + "/" + chk.opens.brevo.n : "pas encore mesuré";
  return '<div class="adm-mail">' +
    '<p><b>Voie o2switch : ' + esc(state) + "</b>" + (paused && r.reason ? '<br><span class="muted small">' + esc(r.reason) + "</span>" : "") + "</p>" +
    '<div class="adm-stats">' + line("smtp", "o2switch") + line("brevo", "Brevo") + line("none", "Non partis") + "</div>" +
    '<p class="muted small">Dernier contrôle : ' + (r.checked_at ? when(r.checked_at) : "jamais") +
      " · listes noires : " + esc(chk.blacklists ? (chk.blacklists.length ? chk.blacklists.join(", ") : "aucune") : "?") +
      " · liens ouverts : " + esc(opens) +
      " · sonde SPF/DKIM : " + esc(Array.isArray(chk.probe) ? chk.probe.join(", ") : (chk.probe || "en attente")) +
      (chk.imap_error ? " · boîte : " + esc(chk.imap_error) : "") + "</p>" +
    "<p>" + (paused
      ? '<button class="btn btn-sm" data-mail-resume>Rétablir o2switch</button>'
      : '<button class="btn btn-sm" data-mail-pause' + (mail.smtp_configured ? "" : " disabled") + ">Tout envoyer par Brevo</button>") +
    ' <button class="btn btn-sm btn-ghost" data-mail-reload>' + icon("retry", 16) + "<span>Actualiser</span></button></p>" +
    (mail.events.length ? "<h3>Historique</h3><ul class=\"adm-events\">" + mail.events.map((e) =>
      "<li>" + when(e.created_at) + " · <b>" + esc(EVENT[e.kind] || e.kind) + "</b> " + esc(e.detail || "") + "</li>").join("") + "</ul>" : "") +
  "</div>";
}

root.addEventListener("click", async (e) => {
  if (e.target.closest("[data-mail-reload]")) { loadMail(); return; }
  const pause = e.target.closest("[data-mail-pause]");
  if (!pause && !e.target.closest("[data-mail-resume]")) return;
  if (pause && !await confirmSheet("Tous les emails partiront par Brevo (quota de 300 par jour) jusqu'à ce que tu rétablisses o2switch.",
    { ok: "Tout envoyer par Brevo", title: "Couper o2switch" })) return;
  try {
    await invoke("admin", { action: pause ? "mail-pause" : "mail-resume" });
    toast(pause ? "o2switch coupée" : "o2switch rétablie", "ok");
    loadMail();
  } catch (err) { toast(errorText(err), "err"); }
});

function draw() {
  const st = data.stats;
  const modes = Object.entries(st.spaces_by_mode).map(([m, n]) => n + " " + (MODES[m] || m).toLowerCase()).join(", ");
  const counts = { transfers: data.transfers.length, users: data.users.length, spaces: data.spaces.length, files: data.files.length, mail: "" };
  root.innerHTML =
    '<div class="adm-head"><h1>Vue d\'ensemble</h1>' +
      '<button class="btn btn-sm" data-reload>' + icon("retry", 16) + "<span>Actualiser</span></button></div>" +
    '<p class="muted small">Données du ' + esc(formatDate(data.generated_at, true)) + (st.truncated ? " · listes tronquées à 5000 lignes" : "") + "</p>" +
    '<div class="adm-stats">' +
      stat("utilisateurs", st.users, st.accounts + " avec compte") +
      stat("transferts", st.transfers, st.recipients + " destinataires") +
      stat("téléchargements", st.downloads) +
      stat("espaces", st.spaces, modes) +
      stat("fichiers", st.files) +
      stat("stockage", formatBytes(st.bytes)) +
    "</div>" +
    '<div class="adm-bar">' +
      '<div class="deck-tabs adm-tabs" role="tablist">' +
        [["transfers", "Transferts"], ["users", "Utilisateurs"], ["spaces", "Espaces"], ["files", "Fichiers"], ["mail", "Emails"]].map(([k, l]) =>
          '<button role="tab" data-tab="' + k + '" aria-selected="' + (tab === k) + '">' + l + " <span>" + counts[k] + "</span></button>").join("") +
      "</div>" +
      '<input class="input adm-search" type="search" placeholder="Rechercher (email, blaze, fichier...)" value="' + esc(query) + '" data-search>' +
    "</div>" +
    '<div class="adm-list" data-list></div>';
  drawList();
}

function drawList() {
  const el = root.querySelector("[data-list]");
  if (!el) return;
  if (tab === "mail" && !mail) loadMail();
  el.innerHTML = tab === "users" ? drawUsers() : tab === "spaces" ? drawSpaces() : tab === "files" ? drawFiles() :
    tab === "mail" ? drawMail() : drawTransfers();
  drawSelection();
}

// ------------------------------------------------------------ événements

root.addEventListener("click", (e) => {
  if (e.target.closest("[data-reload]")) { load(); return; }
  const t = e.target.closest("[data-tab]");
  if (t) {
    tab = t.dataset.tab;
    for (const b of root.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b === t));
    drawList();
  }
});
root.addEventListener("click", (e) => {
  if (e.target.closest("[data-storage]")) checkStorage();
});

// Retraits (contenu illicite, abus) : définitifs, fichiers B2 compris.
root.addEventListener("click", async (e) => {
  const df = e.target.closest("[data-del-file]");
  const ds = e.target.closest("[data-del-space]");
  if (!df && !ds) return;
  e.preventDefault();
  if (df) { deleteFiles([df.dataset.delFile]); return; }
  const s = data.spaces.find((x) => x.id === ds.dataset.delSpace);
  const ok = await confirmSheet("L'espace " + (s ? s.name : "") + " sera effacé pour tous ses membres : fichiers, transferts, commentaires. Définitif.",
    { ok: "Tout supprimer", danger: true, title: "Supprimer l'espace" });
  if (!ok) return;
  try { const r = await invoke("admin", { action: "delete-space", space_id: ds.dataset.delSpace }); toast("Espace supprimé (" + r.files + " fichiers)", "ok"); load(); }
  catch (err) { toast(errorText(err), "err"); }
});
// "toggle" ne remonte pas : écouté en phase de capture
root.addEventListener("toggle", (e) => {
  if (e.target.matches && e.target.matches("[data-file]") && e.target.open) openPreview(e.target);
}, true);
// cases à cocher des fichiers
root.addEventListener("change", (e) => {
  const one = e.target.closest("[data-sel]");
  if (one) {
    if (one.checked) selected.add(one.dataset.sel); else selected.delete(one.dataset.sel);
    one.closest(".adm-file-row").classList.toggle("is-selected", one.checked);
    const all = root.querySelector("[data-sel-all]");
    if (all) all.checked = visibleFiles().every((f) => selected.has(f.id));
    drawSelection();
    return;
  }
  if (e.target.matches("[data-sel-all]")) {
    for (const f of visibleFiles()) { if (e.target.checked) selected.add(f.id); else selected.delete(f.id); }
    drawList();
  }
});

// transferts : supprimer (avec ou sans ses fichiers)
root.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-del-transfer]");
  if (!b) return;
  const t = data.transfers.find((x) => x.id === b.dataset.delTransfer);
  const withFiles = b.dataset.withFiles === "1";
  const ok = await confirmSheet(withFiles
    ? "Le transfert " + (t ? "\"" + t.title + "\" " : "") + "et ses " + plural(t ? t.files.length : 0, "fichier", "fichiers") + " seront effacés. Le lien ne marchera plus. Définitif."
    : "Le lien du transfert ne marchera plus. Les fichiers restent dans leur espace.",
    { ok: withFiles ? "Tout supprimer" : "Couper le lien", danger: true, title: "Supprimer le transfert" });
  if (!ok) return;
  try {
    const r = await invoke("admin", { action: "delete-transfer", transfer_id: b.dataset.delTransfer, with_files: withFiles });
    toast("Transfert supprimé" + (withFiles ? " (" + plural(r.files || 0, "fichier", "fichiers") + ")" : ""), r.ok ? "ok" : "err");
    load();
  } catch (err) { toast(errorText(err), "err"); }
});

// stockage : nettoyage des orphelins et des envois abandonnés
root.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-clean-orphans]")) return;
  const ok = await confirmSheet("Les fichiers présents sur B2 sans fiche dans la base (depuis plus d'une heure) et les envois abandonnés depuis plus d'un jour seront effacés. Définitif.",
    { ok: "Nettoyer", danger: true, title: "Nettoyer le stockage" });
  if (!ok) return;
  try {
    const r = await invoke("admin", { action: "delete-orphans" });
    toast(plural(r.orphans, "orphelin effacé", "orphelins effacés") + " (" + formatBytes(r.bytes) + ")" +
      (r.aborted ? ", " + plural(r.aborted, "envoi annulé", "envois annulés") : ""), "ok");
    checkStorage();
  } catch (err) { toast(errorText(err), "err"); }
});

root.addEventListener("change", (e) => {
  if (!e.target.matches("[data-sort]")) return;
  fileSort = e.target.value;
  drawList();
});
root.addEventListener("input", (e) => {
  if (!e.target.matches("[data-search]")) return;
  query = e.target.value.trim().toLowerCase();
  drawList();
});
who.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-logout]")) return;
  await logout();
  data = null;
  drawWho();
  drawLogin();
});

drawWho();
if (accountEmail()) load();
else drawLogin();
