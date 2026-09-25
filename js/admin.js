// Espace admin (admin.html, liée nulle part) : tous les transferts,
// utilisateurs et espaces, en lecture seule. La page ne décide de rien :
// c'est la fonction "admin" qui vérifie que le compte connecté fait partie
// des administrateurs, et qui renvoie les données.

import { invoke } from "./db.js?v=53";
import { accountEmail, login, logout } from "./session.js?v=53";
import { ensureVerified } from "./verify.js?v=53";
import { icon } from "./icons.js?v=53";
import { esc, toast, errorText, formatBytes, formatDate, timeAgo, plural } from "./ui.js?v=53";

const root = document.getElementById("adm");
const who = document.getElementById("who");

const MODES = { envoi: "Envois", seminaire: "Séminaire", revue: "Verdict" };
const STATUS = { pending: "en attente", sent: "envoyé", failed: "échec", bounced: "rejeté" };

let data = null;
let tab = "transfers";
let query = "";

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
    "</div>").join("");
}

function draw() {
  const st = data.stats;
  const modes = Object.entries(st.spaces_by_mode).map(([m, n]) => n + " " + (MODES[m] || m).toLowerCase()).join(", ");
  const counts = { transfers: data.transfers.length, users: data.users.length, spaces: data.spaces.length };
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
        [["transfers", "Transferts"], ["users", "Utilisateurs"], ["spaces", "Espaces"]].map(([k, l]) =>
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
  el.innerHTML = tab === "users" ? drawUsers() : tab === "spaces" ? drawSpaces() : drawTransfers();
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
