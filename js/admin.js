// Espace admin (admin.html, liée nulle part) : tableau de bord. Aperçu,
// envois, espaces, fichiers, utilisateurs, bande passante, emails. La page
// ne décide de rien : c'est la fonction "admin" qui vérifie que le compte
// connecté fait partie des administrateurs, et qui renvoie les données.

import { invoke } from "./db.js?v=130";
import { accountEmail, login, logout } from "./session.js?v=130";
import { ensureVerified } from "./verify.js?v=130";
import { icon } from "./icons.js?v=130";
import { esc, toast, errorText, formatBytes, formatDate, timeAgo, plural, fileBadge, confirmSheet } from "./ui.js?v=130";
import { isAudio, categoryOf } from "./files.js?v=130";

const root = document.getElementById("adm");
const who = document.getElementById("who");

const MODES = { envoi: "Envois", seminaire: "Séminaire", revue: "Verdict" };
const STATUS = { pending: "en attente", sent: "envoyé", failed: "échec", bounced: "rejeté" };

// Les sections : identifiant, nom, icône, phrase sous le titre
const NAV = [
  ["overview", "Aperçu", "sparkle", "Ce qui se passe, et ce qui demande ton attention."],
  ["transfers", "Envois", "send", "Chaque envoi, ses destinataires, ses ouvertures."],
  ["spaces", "Espaces", "layers", "Envois, séminaires et verdicts."],
  ["files", "Fichiers", "file", "Tout ce qui est stocké, écoutable, supprimable."],
  ["users", "Utilisateurs", "users", "Comptes et appareils anonymes."],
  ["bandwidth", "Bande passante", "download", "Ce que le site sert, et ce que ça coûte."],
  ["mail", "Emails", "mail", "Voies d'envoi, surveillance et test anti-spam."]
];
const SEARCHABLE = new Set(["transfers", "spaces", "files", "users"]);

let data = null;
let tab = NAV.some((n) => n[0] === location.hash.slice(1)) ? location.hash.slice(1) : "overview";
let query = "";
let modeFilter = "all";
let fileSort = "recent";
let storage = null;      // résultat de la vérification B2
let mail = null;         // état des voies d'envoi (o2switch / Brevo)
let bw = null;           // bande passante et stockage
let bwDays = 14;
const selected = new Set();   // fichiers cochés (suppression groupée)

function drawWho() {
  const email = accountEmail();
  who.innerHTML = email
    ? '<span class="adm-email">' + esc(email) + "</span>" + ' <button class="btn btn-ghost btn-sm" data-logout>' + icon("logout", 16) + "<span>Déconnexion</span></button>"
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
    // le reste de l'aperçu (emails, bande passante) arrive en arrière-plan
    loadMail();
    loadBandwidth();
  } catch (err) {
    const code = String(err && err.message);
    if (code === "INTERDIT") drawLogin(accountEmail() ? "Le compte " + accountEmail() + " n'a pas accès à cette page." : "");
    else if (code === "NON_AUTHENTIFIE") drawLogin();
    else root.innerHTML = '<p class="adm-error">' + esc(errorText(err)) + ' <button class="btn btn-sm" data-reload>Réessayer</button></p>';
  }
}

const matches = (obj) => !query || JSON.stringify(obj).toLowerCase().includes(query);
const when = (iso) => (iso ? '<span title="' + esc(formatDate(iso, true)) + '">' + esc(timeAgo(iso)) + "</span>" : "jamais");
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const listOf = (html) => '<div class="adm-list">' + html + "</div>";

// ------------------------------------------------------------ bande passante

async function loadBandwidth() {
  bw = { loading: true };
  try {
    bw = await invoke("admin", { action: "bandwidth", days: 30 });
  } catch (err) {
    bw = { error: errorText(err) };
  }
  if (tab === "overview" || tab === "bandwidth") drawBody();
}

// les 'n' derniers jours, un objet par jour (les jours sans trafic à zéro)
function bwSeries(n) {
  const byDay = new Map();
  for (const r of bw.rows) {
    const d = byDay.get(r.day) || { day: r.day, delivered: 0, origin: 0, requests: 0, upload: 0 };
    if (r.kind === "upload") d.upload += r.delivered;
    else { d.delivered += r.delivered; d.origin += r.origin; d.requests += r.requests; }
    byDay.set(r.day, d);
  }
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400e3).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    out.push(byDay.get(day) || { day, delivered: 0, origin: 0, requests: 0, upload: 0 });
  }
  return out;
}

const shortDay = (iso) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

// Barres empilées par jour : servi par le cache (bleu, en bas) et tiré de
// B2 (orange, au-dessus). Survol : détail du jour.
function bwChart(days) {
  // largeur réelle du conteneur : le texte du graphique garde sa taille sur téléphone
  const box = root.querySelector("[data-list]");
  const W = Math.round(Math.min(720, Math.max(300, (box ? box.clientWidth : 720) - 42))), H = W < 500 ? 200 : 236, L = 50, R = 6, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const max = Math.max(1, ...days.map((d) => d.delivered));
  // plafond "rond" : 1, 2, 2,5 ou 5 x 10^n
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= max) || max;
  const y = (v) => T + ph - (v / top) * ph;
  const band = pw / days.length;
  const bw_ = Math.min(30, band * 0.62);
  const ticks = [0, top / 2, top];
  const every = days.length > 16 ? 4 : days.length > 8 ? 2 : 1;
  let g = "";
  for (const t of ticks) {
    g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>' +
      '<text x="' + (L - 8) + '" y="' + (y(t) + 3) + '" text-anchor="end">' + esc(t ? formatBytes(t) : "0") + "</text>";
  }
  days.forEach((d, i) => {
    const cx = L + band * i + band / 2, x = cx - bw_ / 2;
    const cache = Math.max(0, d.delivered - d.origin);
    const hc = (cache / top) * ph, ho = (d.origin / top) * ph;
    // segments séparés par 2 px, dessus arrondi
    if (hc > 0) g += '<rect x="' + x + '" y="' + (T + ph - hc) + '" width="' + bw_ + '" height="' + hc + '" rx="' + (ho > 0 ? 0 : 4) + '" fill="var(--viz-1)"/>';
    if (ho > 0) g += '<rect x="' + x + '" y="' + (T + ph - hc - ho - (hc > 0 ? 2 : 0)) + '" width="' + bw_ + '" height="' + ho + '" rx="4" fill="var(--viz-2)"/>';
    if (i % every === 0 || i === days.length - 1) g += '<text x="' + cx + '" y="' + (H - 6) + '" text-anchor="middle">' + shortDay(d.day) + "</text>";
    g += '<rect class="col" data-i="' + i + '" x="' + (cx - band / 2) + '" y="' + T + '" width="' + band + '" height="' + ph + '"/>';
  });
  return '<div class="adm-plot" style="position:relative">' +
    '<svg class="adm-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Bande passante servie par jour">' + g + "</svg>" +
    '<div class="adm-tip" data-tip hidden></div></div>';
}

function bwTip(d) {
  const cache = Math.max(0, d.delivered - d.origin);
  return "<b>" + esc(shortDay(d.day)) + "</b>" +
    '<i style="background:var(--viz-1)"></i>Servi par le cache : ' + esc(formatBytes(cache)) + "<br>" +
    '<i style="background:var(--viz-2)"></i>Tiré de B2 : ' + esc(formatBytes(d.origin)) + "<br>" +
    "Reçu (envois) : " + esc(formatBytes(d.upload)) + " · " + d.requests + " requête" + (d.requests > 1 ? "s" : "");
}

function drawBandwidth() {
  if (!bw || bw.loading) return '<div class="skeleton tall"></div>';
  if (bw.error) return '<p class="adm-error">' + esc(bw.error) + "</p>";
  const days = bwSeries(bwDays);
  const sum = (k) => days.reduce((n, d) => n + d[k], 0);
  const delivered = sum("delivered"), origin = sum("origin"), uploaded = sum("upload");
  const cached = delivered - origin;
  const s = bw.storage;
  const usedPct = pct(s.used, s.cap);
  const kinds = {};
  for (const r of bw.rows) {
    if (r.kind === "upload" || r.day < days[0].day) continue;
    const k = kinds[r.kind] || (kinds[r.kind] = { delivered: 0, origin: 0, requests: 0 });
    k.delivered += r.delivered; k.origin += r.origin; k.requests += r.requests;
  }
  const KIND = { audio: "Audio", video: "Vidéo", image: "Images", fichier: "Fichiers (zip, documents...)" };
  const empty = !bw.rows.length;
  return '<div class="adm-chips" role="group" aria-label="Période">' +
      [7, 14, 30].map((n) => '<button data-bwdays="' + n + '" aria-pressed="' + (bwDays === n) + '">' + n + " jours</button>").join("") +
    "</div>" +
    '<div class="adm-kpis">' +
      kpi("Servi aux visiteurs", formatBytes(delivered), "par Cloudflare, sur " + bwDays + " jours") +
      kpi("Tiré de B2", formatBytes(origin), "sortie B2 vers Cloudflare : gratuite") +
      kpi("Absorbé par le cache", delivered ? pct(cached, delivered) + " %" : "—", delivered ? formatBytes(cached) + " qui n'ont pas touché B2" : "en attente de trafic") +
      kpi("Reçu (envois)", formatBytes(uploaded), "fichiers déposés sur B2") +
    "</div>" +
    '<div class="adm-card adm-viz" style="margin-top:var(--sp-4)">' +
      '<div class="adm-card-head"><h2>Servi par jour</h2>' +
        '<div class="adm-legend" style="margin:0"><span><i style="background:var(--viz-1)"></i>Cache</span><span><i style="background:var(--viz-2)"></i>B2</span></div></div>' +
      (empty ? '<p class="adm-empty">Mesure démarrée le 29/09/2026 : les chiffres apparaissent dès la première écoute ou le premier téléchargement.</p>' : bwChart(days)) +
      '<details style="margin-top:var(--sp-3)"><summary class="adm-link">Voir en tableau</summary>' +
        '<table class="adm-table"><thead><tr><th>Jour</th><th>Servi</th><th>B2</th><th>Reçu</th><th>Req.</th></tr></thead><tbody>' +
        days.slice().reverse().filter((d) => d.delivered || d.upload).map((d) =>
          "<tr><td>" + esc(shortDay(d.day)) + "</td><td>" + esc(formatBytes(d.delivered)) + "</td><td>" + esc(formatBytes(d.origin)) + "</td><td>" + esc(formatBytes(d.upload)) + "</td><td>" + d.requests + "</td></tr>").join("") +
        "</tbody></table></details>" +
    "</div>" +
    '<div class="adm-grid">' +
      '<div class="adm-card"><h2>Par type de contenu</h2>' +
        (Object.keys(kinds).length
          ? '<table class="adm-table"><thead><tr><th>Type</th><th>Servi</th><th>B2</th><th>Req.</th></tr></thead><tbody>' +
            Object.entries(kinds).sort((a, b) => b[1].delivered - a[1].delivered).map(([k, v]) =>
              "<tr><td>" + esc(KIND[k] || k) + "</td><td>" + esc(formatBytes(v.delivered)) + "</td><td>" + esc(formatBytes(v.origin)) + "</td><td>" + v.requests + "</td></tr>").join("") + "</tbody></table>"
          : '<p class="adm-empty" style="padding:0">Rien encore.</p>') +
      "</div>" +
      '<div class="adm-card"><h2>Stockage B2 <small>gratuit jusqu\'à ' + esc(formatBytes(s.free_tier)) + "</small></h2>" +
        '<div class="adm-kpi" style="border:0;padding:0;min-height:0;background:none"><b>' + esc(formatBytes(s.used)) + "</b><small>sur " + esc(formatBytes(s.cap)) + " autorisés par le site (" + usedPct + " %)</small></div>" +
        '<div class="adm-bar ' + (usedPct >= 90 ? "is-danger" : usedPct >= 70 ? "is-warn" : "") + '" style="margin-top:var(--sp-3)"><i style="width:' + Math.min(100, usedPct) + '%"></i></div>' +
        '<p class="adm-note">Au-delà, les nouveaux envois sont refusés jusqu\'à ce que des fichiers expirent. Limites par personne : ' +
          esc(formatBytes(bw.limits.user_day)) + " par appareil et par adresse IP, sur 24 h ; " + esc(formatBytes(bw.limits.global_day)) + " pour tout le site.</p>" +
      "</div>" +
    "</div>" +
    '<p class="adm-note">Ne compte que ce qui passe par files.weshtransfer.fr (écoutes, téléchargements, aperçus) ; les envois sont comptés à la fin du dépôt. Mesure démarrée le ' +
      esc(bw.since ? bw.since.slice(8, 10) + "/" + bw.since.slice(5, 7) + "/" + bw.since.slice(0, 4) : "29/09/2026") + ".</p>";
}

// ------------------------------------------------------------ aperçu

function kpi(label, value, sub, extra) {
  return '<div class="adm-kpi' + ((extra && extra.warn) ? " is-warn" : "") + '"><span>' + esc(label) + "</span><b>" + esc(String(value)) + "</b>" +
    (sub ? "<small>" + esc(sub) + "</small>" : "") + ((extra && extra.bar) || "") + "</div>";
}

function alerts() {
  const out = [];
  if (mail && !mail.loading && !mail.error) {
    const r = mail.route || {};
    const paused = r.smtp_paused_until && new Date(r.smtp_paused_until) > new Date();
    if (!mail.smtp_configured) out.push(["is-warn", "Emails", "o2switch n'est pas configuré : tout part par Brevo (300 par jour)."]);
    else if (paused) out.push(["is-warn", "Voie o2switch coupée", (r.manual ? "à la main" : r.reason || "") + " : tout part par Brevo."]);
    const bl = r.last_check && r.last_check.blacklists;
    if (bl && bl.length) out.push(["is-err", "Liste noire", bl.join(", ")]);
  }
  if (bw && !bw.loading && !bw.error) {
    const p = pct(bw.storage.used, bw.storage.cap);
    if (p >= 70) out.push([p >= 90 ? "is-err" : "is-warn", "Stockage à " + p + " %", formatBytes(bw.storage.used) + " sur " + formatBytes(bw.storage.cap) + " : les nouveaux envois seront refusés au plafond."]);
  }
  const week = Date.now() - 7 * 86400e3;
  const failed = data.transfers.filter((t) => new Date(t.created_at) > week).reduce((n, t) => n + t.recipients.filter((r) => r.status === "failed").length, 0);
  if (failed) out.push(["is-warn", plural(failed, "email en échec", "emails en échec"), "sur les envois des 7 derniers jours."]);
  if (data.stats.truncated) out.push(["is-warn", "Listes tronquées", "Les listes sont limitées à 5000 lignes."]);
  return out;
}

function drawOverview() {
  const st = data.stats;
  const day = Date.now() - 864e5;
  const sent24 = data.transfers.filter((t) => new Date(t.created_at) > day).length;
  const b = bw && !bw.loading && !bw.error ? bw : null;
  const usedPct = b ? pct(b.storage.used, b.storage.cap) : 0;
  const days7 = b ? bwSeries(7) : [];
  const dl7 = days7.reduce((n, d) => n + d.delivered, 0);
  const or7 = days7.reduce((n, d) => n + d.origin, 0);
  const m = mail && !mail.loading && !mail.error ? mail : null;
  const d = (m && m.day) || {};
  const ok = (via) => (d[via] ? d[via].ok : 0);
  const items = alerts();
  // Envois + tout ce qui est déposé dans un Verdict ou un séminaire
  // (nouvelles versions v2, v3... comprises). Les fichiers d'un espace
  // "Envois" sont déjà dans leur envoi : pas de doublon.
  const feed = [
    ...data.transfers.map((t) => ({
      at: t.created_at, kind: "Envoi", title: t.title || "Sans titre",
      sub: (t.sender || "?") + " · " + plural(t.files.length, "fichier", "fichiers") + " · " + formatBytes(t.size)
    })),
    ...data.files.filter((f) => f.mode !== "envoi").map((f) => ({
      at: f.created_at, kind: MODES[f.mode] || "Fichier",
      title: (f.project || f.name) + (f.version > 1 || f.mode === "revue" ? " · v" + f.version : ""),
      sub: (f.space || "?") + " · " + (f.uploader || "?") + " · " + formatBytes(f.size) + (f.project ? " · " + f.name : "")
    }))
  ].sort((a, c) => String(c.at).localeCompare(String(a.at))).slice(0, 12);
  const modes = Object.entries(st.spaces_by_mode).map(([k, n]) => n + " " + (MODES[k] || k).toLowerCase()).join(" · ");
  return '<div class="adm-kpis">' +
      kpi("Stockage", b ? formatBytes(b.storage.used) : "…", b ? "sur " + formatBytes(b.storage.cap) + " (" + usedPct + " %)" : "calcul en cours",
        { warn: usedPct >= 70, bar: b ? '<div class="adm-bar ' + (usedPct >= 90 ? "is-danger" : usedPct >= 70 ? "is-warn" : "") + '"><i style="width:' + Math.min(100, usedPct) + '%"></i></div>' : "" }) +
      kpi("Bande passante 7 j", b ? formatBytes(dl7) : "…", b ? (dl7 ? pct(dl7 - or7, dl7) + " % absorbés par le cache" : "aucun trafic mesuré") : "calcul en cours") +
      kpi("Emails, 24 h", m ? ok("smtp") + ok("brevo") : "…", m ? "o2switch " + ok("smtp") + " · Brevo " + ok("brevo") : "calcul en cours") +
      kpi("Envois, 24 h", sent24, plural(st.users, "utilisateur", "utilisateurs") + " · " + plural(st.spaces, "espace", "espaces")) +
    "</div>" +
    '<div class="adm-card" style="margin-top:var(--sp-4)"><h2>À surveiller</h2><ul class="adm-alerts">' +
      (items.length ? items.map(([cls, t, sub]) => '<li class="' + cls + '"><span class="dot"></span><span><b>' + esc(t) + "</b> " + esc(sub) + "</span></li>").join("")
        : '<li><span class="dot"></span><span><b>Rien à signaler.</b> Emails, stockage et envois sont dans le vert.</span></li>') +
    "</ul></div>" +
    '<div class="adm-card" style="margin-top:var(--sp-4)"><div class="adm-card-head"><h2>Activité récente</h2>' +
      '<span class="adm-tools"><button class="adm-link" data-go="transfers">Envois</button><button class="adm-link" data-go="files">Fichiers</button></span></div>' +
      '<ul class="adm-mini">' + (feed.map((x) => '<li><span class="t"><b>' + esc(x.title) + '</b><small><span class="adm-pill">' + esc(x.kind) + "</span> " + esc(x.sub) + '</small></span><span class="r">' + when(x.at) + "</span></li>").join("")
        || '<li><span class="r">Rien pour l\'instant.</span></li>') + "</ul></div>" +
    '<p class="adm-strip"><span><b>' + st.users + "</b> utilisateurs (" + st.accounts + " avec compte)</span><span><b>" + st.spaces + "</b> espaces : " + esc(modes) +
      "</span><span><b>" + st.transfers + "</b> envois · " + st.recipients + " destinataires · " + st.downloads + " téléchargements</span><span><b>" + st.files + "</b> fichiers · " + esc(formatBytes(st.bytes)) + "</span></p>";
}

// ------------------------------------------------------------ emails

let alertsState = null;   // alertes email pour l'admin

async function loadMail() {
  mail = { loading: true };
  try {
    const [m, a] = await Promise.all([
      invoke("admin", { action: "mail" }),
      invoke("admin", { action: "alerts" }).catch(() => null)
    ]);
    mail = m;
    alertsState = a;
  } catch (err) {
    mail = { error: errorText(err) };
  }
  if (tab === "overview" || tab === "mail") drawBody();
}

const EVENT = { pause: "Coupure", resume: "Reprise", blacklist: "Liste noire", bounce: "Rebond", engagement: "Ouvertures", probe: "Sonde", error: "Erreur", diagnostic: "Test" };
let mailTest = null;   // { id, state: "loading" | "ready" | "timeout" | "err", score, issues, report_url }

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
    return kpi(label + ", 24 h", x.ok, x.failed + " refusés · " + x.bounced + " rebonds");
  };
  const chk = r.last_check || {};
  const opens = chk.opens ? "o2switch " + chk.opens.smtp.opened + "/" + chk.opens.smtp.n + " · Brevo " + chk.opens.brevo.opened + "/" + chk.opens.brevo.n : "pas encore mesuré";
  return '<div class="adm-card">' +
      '<div class="adm-card-head"><span class="adm-state ' + (!mail.smtp_configured ? "is-warn" : paused ? "is-off" : "") + '"><i></i>Voie o2switch : ' + esc(state) + "</span>" +
        '<span class="adm-tools">' + (paused
          ? '<button class="btn btn-sm" data-mail-resume>Rétablir o2switch</button>'
          : '<button class="btn btn-sm" data-mail-pause' + (mail.smtp_configured ? "" : " disabled") + ">Tout envoyer par Brevo</button>") +
        ' <button class="btn btn-sm btn-ghost" data-mail-reload>' + icon("retry", 16) + "<span>Actualiser</span></button></span></div>" +
      (paused && r.reason ? '<p class="adm-note" style="margin:0 0 var(--sp-3)">' + esc(r.reason) + "</p>" : "") +
      '<div class="adm-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + line("smtp", "o2switch") + line("brevo", "Brevo") + line("none", "Non partis") + "</div>" +
      '<p class="adm-note">Dernier contrôle : ' + (r.checked_at ? when(r.checked_at) : "jamais") +
        " · listes noires : " + esc(chk.blacklists ? (chk.blacklists.length ? chk.blacklists.join(", ") : "aucune") : "?") +
        " · liens ouverts : " + esc(opens) +
        " · sonde SPF/DKIM : " + esc(Array.isArray(chk.probe) ? chk.probe.join(", ") : (chk.probe || "en attente")) +
        (chk.imap_error ? " · boîte : " + esc(chk.imap_error) : "") + "</p>" +
    "</div>" +
    drawAlertsCard() +
    '<div class="adm-card"><div class="adm-card-head"><h2>Test anti-spam <small>mail-tester.com</small></h2>' +
        '<button class="btn btn-sm" data-mail-test' + (mailTest && mailTest.state === "loading" ? " disabled" : "") + (mail.smtp_configured ? "" : " disabled") + ">" +
          (mailTest && mailTest.state === "loading" ? "Test en cours…" : "Tester la délivrabilité") + "</button></div>" +
      '<p class="adm-note" style="margin:0">Envoie un vrai email par o2switch vers une adresse jetable et note son contenu sur 10 (SPF, DKIM, listes noires, mots à risque). Évite de relancer plusieurs fois de suite : le service limite les essais rapprochés.</p>' +
      drawMailTest() +
    "</div>" +
    (mail.events.length ? '<div class="adm-card"><h2>Historique</h2><ul class="adm-events">' + mail.events.map((e) =>
      "<li>" + when(e.created_at) + " · <b>" + esc(EVENT[e.kind] || e.kind) + "</b> " + esc(e.detail || "") + "</li>").join("") + "</ul></div>" : "");
}

// Alertes par email : ce que le contrôle horaire surveille, ce qu'il voit
function drawAlertsCard() {
  const a = alertsState;
  const cur = a ? a.current : [];
  return '<div class="adm-card"><div class="adm-card-head"><h2>Alertes par email <small>' + esc(a && a.to.length ? a.to.join(", ") : "") + "</small></h2>" +
      '<button class="btn btn-sm" data-alert-test>' + icon("mail", 16) + "<span>M'envoyer un test</span></button></div>" +
    (cur.length
      ? '<ul class="adm-alerts">' + cur.map((x) => '<li class="' + (x.level === "crit" ? "is-err" : "is-warn") + '"><span class="dot"></span><span><b>' + esc(x.title) + "</b> " + esc(x.detail || "") + "</span></li>").join("") + "</ul>"
      : '<ul class="adm-alerts"><li><span class="dot"></span><span><b>Rien à signaler en ce moment.</b></span></li></ul>') +
    '<p class="adm-note">Contrôle toutes les heures : stockage (80 %), base de données, voie o2switch coupée, liste noire, email qui n\'est pas parti (dès le premier, sur le moment), quota Brevo, pic de bande passante. Un email groupé à l\'apparition d\'une alerte, un rappel par 24 h tant qu\'elle dure, et un mot quand c\'est réglé.</p>' +
  "</div>";
}

function drawMailTest() {
  if (!mailTest) return "";
  if (mailTest.state === "loading") return '<p class="adm-note">Email de test envoyé, analyse dans ~30 s...</p>';
  if (mailTest.state === "err") return '<p class="adm-error">' + esc(mailTest.error) + "</p>";
  if (mailTest.state === "timeout") return '<p class="adm-note">Pas encore analysé après 2 minutes. <a href="' + esc(mailTest.report_url) + '" target="_blank" rel="noopener">Voir la page</a> (elle se termine toute seule).</p>';
  const score = mailTest.score;
  const cls = score == null ? "" : score >= 8 ? "st-ok" : score >= 5 ? "" : "st-bad";
  return '<div class="adm-mailtest">' +
    '<p style="margin:0"><b class="' + cls + '">Score : ' + (score != null ? score + " / 10" : "?") + "</b> — " +
      '<a href="' + esc(mailTest.report_url) + '" target="_blank" rel="noopener">rapport complet&nbsp;&rarr;</a></p>' +
    (mailTest.issues.length ? '<ul class="adm-events" style="margin-top:var(--sp-2)">' + mailTest.issues.map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul>"
      : '<p class="adm-note">Rien à améliorer trouvé.</p>') +
  "</div>";
}

async function pollMailTest(id, triesLeft) {
  let r;
  try { r = await invoke("admin", { action: "mail-test-check", id }); }
  catch (err) { mailTest = { id, state: "err", error: errorText(err) }; drawBody(); return; }
  if (r.ready) {
    mailTest = { id, state: "ready", score: r.score, issues: r.issues, report_url: r.report_url };
    drawBody();
    return;
  }
  if (triesLeft <= 0) {
    mailTest = { id, state: "timeout", report_url: "https://www.mail-tester.com/" + id };
    drawBody();
    return;
  }
  setTimeout(() => pollMailTest(id, triesLeft - 1), 8000);
}

// ------------------------------------------------------------ coque

function setTab(next, push) {
  if (!NAV.some((n) => n[0] === next)) next = "overview";
  tab = next;
  query = "";
  try { history.replaceState(null, "", "#" + next); } catch (err) { /* privé */ }
  if (push !== false) window.scrollTo(0, 0);
  drawShell();
}

function counts() {
  return { transfers: data.transfers.length, spaces: data.spaces.length, files: data.files.length, users: data.users.length };
}

function drawShell() {
  const c = counts();
  const cur = NAV.find((n) => n[0] === tab);
  root.innerHTML =
    '<div class="adm-shell">' +
      '<nav class="adm-nav" aria-label="Sections">' +
        NAV.map(([k, label, ic]) => '<button data-tab="' + k + '"' + (tab === k ? ' aria-current="page"' : "") + ">" + icon(ic, 18) + "<span>" + label + "</span>" + (c[k] != null ? '<span class="n">' + c[k] + "</span>" : "") + "</button>").join("") +
      "</nav>" +
      "<section>" +
        '<div class="adm-page-head"><div><h1>' + esc(cur[1]) + "</h1><p>" + esc(cur[3]) + (tab === "overview" ? " Données du " + esc(formatDate(data.generated_at, true)) + "." : "") + "</p></div>" +
          '<div class="adm-tools">' +
            (SEARCHABLE.has(tab) ? '<input class="input adm-search" type="search" placeholder="Rechercher…" value="' + esc(query) + '" data-search>' : "") +
            '<button class="btn btn-sm" data-reload>' + icon("retry", 16) + "<span>Actualiser</span></button></div></div>" +
        '<div data-list></div>' +
      "</section>" +
    "</div>";
  drawBody();
}

function draw() { drawShell(); }

function drawBody() {
  const el = root.querySelector("[data-list]");
  if (!el || !data) return;
  if (tab === "mail" && !mail) loadMail();
  if (tab === "bandwidth" && !bw) loadBandwidth();
  let html;
  if (tab === "overview") html = drawOverview();
  else if (tab === "transfers") html = listOf(drawTransfers());
  else if (tab === "spaces") html = drawSpacesPage();
  else if (tab === "files") html = drawFiles();
  else if (tab === "users") html = listOf(drawUsers());
  else if (tab === "bandwidth") html = drawBandwidth();
  else html = drawMail();
  el.innerHTML = html;
  drawSelection();
}

function drawSpacesPage() {
  const modes = ["all", ...Object.keys(MODES)];
  return '<div class="adm-chips" role="group" aria-label="Type">' +
    modes.map((m) => '<button data-mode="' + m + '" aria-pressed="' + (modeFilter === m) + '">' + (m === "all" ? "Tous" : MODES[m]) + "</button>").join("") + "</div>" +
    listOf(drawSpaces());
}

// ------------------------------------------------------------ envois, espaces, utilisateurs

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
  const list = data.spaces.filter((s) => (modeFilter === "all" || s.mode === modeFilter) && matches(s));
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
    return '<div class="adm-card adm-storage"><div class="adm-card-head"><h2>Contrôle du stockage B2</h2><button class="btn btn-sm" data-storage>' + icon("layers", 16) + "<span>Vérifier</span></button></div>" +
      '<p class="adm-note" style="margin:0">Compare ce que contient vraiment B2 à la base : fichiers orphelins (sur B2 sans fiche), fiches sans fichier, envois inachevés.</p></div>';
  }
  if (storage.loading) return '<div class="adm-card adm-storage"><p class="adm-note" style="margin:0">Lecture du bucket B2...</p></div>';
  const s = storage;
  return '<div class="adm-card adm-storage"><div class="adm-card-head"><h2>Contrôle du stockage B2</h2></div>' +
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
    (list.length ? listOf(list.map((f) =>
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
      "</div>").join("")) : '<p class="adm-empty">Aucun fichier.</p>');
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
      if (e.target.closest("[data-sel-none]")) { selected.clear(); drawBody(); drawSelection(); }
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
  drawBody();
  try {
    storage = await invoke("admin", { action: "storage" });
  } catch (err) {
    storage = null;
    toast(errorText(err), "err");
  }
  drawBody();
}


// ------------------------------------------------------------ événements

root.addEventListener("click", (e) => {
  if (e.target.closest("[data-reload]")) { load(); return; }
  const t = e.target.closest("[data-tab]") || e.target.closest("[data-go]");
  if (t) { setTab(t.dataset.tab || t.dataset.go); return; }
  const m = e.target.closest("[data-mode]");
  if (m) { modeFilter = m.dataset.mode; drawBody(); return; }
  const d = e.target.closest("[data-bwdays]");
  if (d) { bwDays = Number(d.dataset.bwdays); drawBody(); return; }
  if (e.target.closest("[data-storage]")) checkStorage();
});

// graphique : détail du jour au survol
root.addEventListener("pointermove", (e) => {
  const col = e.target.closest && e.target.closest(".adm-chart .col");
  const plot = root.querySelector(".adm-plot");
  const tip = plot && plot.querySelector("[data-tip]");
  if (!tip) return;
  if (!col) { tip.hidden = true; return; }
  const days = bwSeries(bwDays);
  const d = days[Number(col.dataset.i)];
  const svg = plot.querySelector("svg");
  const box = svg.getBoundingClientRect();
  const c = col.getBoundingClientRect();
  tip.innerHTML = bwTip(d);
  tip.hidden = false;
  const left = Math.min(Math.max(c.left + c.width / 2 - box.left, 90), box.width - 90);
  tip.style.left = left + "px";
  tip.style.top = Math.max(0, (e.clientY - box.top) - 12) + "px";
});
let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (tab === "bandwidth" && data) drawBody(); }, 150);
});
root.addEventListener("pointerleave", () => { const t = root.querySelector("[data-tip]"); if (t) t.hidden = true; });

root.addEventListener("click", async (e) => {
  const at = e.target.closest("[data-alert-test]");
  if (at) {
    at.disabled = true;
    try {
      const r = await invoke("admin", { action: "alerts-test" });
      toast(r.sent ? "Email de test envoyé (" + plural(r.count, "alerte", "alertes") + " en cours)" : "Email non parti : " + (r.reason || "voir l'onglet Emails"), r.sent ? "ok" : "err");
    } catch (err) { toast(errorText(err), "err"); }
    at.disabled = false;
    return;
  }
  if (e.target.closest("[data-mail-reload]")) { loadMail(); return; }
  if (e.target.closest("[data-mail-test]")) {
    try {
      const r = await invoke("admin", { action: "mail-test-start" });
      mailTest = { id: r.id, state: "loading" };
      drawBody();
      setTimeout(() => pollMailTest(r.id, 12), r.wait_seconds * 1000);
    } catch (err) { toast(errorText(err), "err"); }
    return;
  }
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
    drawBody();
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
  drawBody();
});
root.addEventListener("input", (e) => {
  if (!e.target.matches("[data-search]")) return;
  query = e.target.value.trim().toLowerCase();
  drawBody();
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
