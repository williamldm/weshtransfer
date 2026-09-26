// Choix de la voie d'envoi : o2switch (gratuit) tant qu'elle est saine,
// Brevo sinon. Voir la migration 20260926000004 (mail_route, mail_log).
//
// La voie o2switch est écartée quand :
//   - le disjoncteur est ouvert (mail_route.smtp_paused_until) ;
//   - son plafond du jour ou de l'heure est atteint ; le plafond du jour
//     monte par paliers (chauffe) : une nouvelle source qui envoie d'un coup
//     beaucoup d'emails est exactement ce que les filtres punissent.
// Plafonds réglables : SMTP_DAY_MAX (400), SMTP_HOUR_MAX (60).

// deno-lint-ignore-file no-explicit-any

export type SmtpRoute = { ok: boolean; left: number; reason: string };

const num = (name: string, def: number) => {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v >= 0 ? v : def;
};

// Chauffe : jours depuis le premier email o2switch réussi (journal 30 j)
function warmCap(days: number, max: number): number {
  if (days < 3) return Math.min(max, 60);
  if (days < 7) return Math.min(max, 150);
  if (days < 14) return Math.min(max, 300);
  return max;
}

export async function smtpRoute(db: any): Promise<SmtpRoute> {
  const { data: route } = await db.from("mail_route").select("smtp_paused_until, reason").eq("id", 1).maybeSingle();
  if (route?.smtp_paused_until && new Date(route.smtp_paused_until) > new Date()) {
    return { ok: false, left: 0, reason: `coupée : ${route.reason ?? "?"}` };
  }
  const now = Date.now();
  const [day, hour, first] = await Promise.all([
    db.from("mail_log").select("id", { count: "exact", head: true })
      .eq("via", "smtp").eq("ok", true).gte("created_at", new Date(now - 86400e3).toISOString()),
    db.from("mail_log").select("id", { count: "exact", head: true })
      .eq("via", "smtp").eq("ok", true).gte("created_at", new Date(now - 3600e3).toISOString()),
    db.from("mail_log").select("created_at").eq("via", "smtp").eq("ok", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (day.error || hour.error) return { ok: false, left: 0, reason: "journal illisible" };
  const days = first.data ? (now - new Date(first.data.created_at).getTime()) / 86400e3 : 0;
  const dayCap = warmCap(days, num("SMTP_DAY_MAX", 400));
  const left = Math.min(dayCap - (day.count ?? 0), num("SMTP_HOUR_MAX", 60) - (hour.count ?? 0));
  if (left <= 0) return { ok: false, left: 0, reason: "plafond o2switch atteint" };
  return { ok: true, left, reason: "" };
}

// ------------------------------------------------ lecture des erreurs

// Le destinataire n'existe pas : ni o2switch ni Brevo n'y peuvent rien, et
// réessayer ailleurs abîmerait aussi la réputation de Brevo.
export function badRecipient(err: string): boolean {
  return /\b5\.1\.(1|10)\b|user unknown|unknown user|no such user|does not exist|mailbox unavailable|recipient address rejected|invalid recipient|address not found/i
    .test(err) && !spamSignal(err);
}

// Refus qui parle de spam, de réputation, de liste noire ou d'authentification
export function spamSignal(err: string): boolean {
  return /\b5\.7\.\d+\b|\b4\.7\.\d+\b|spam|blocked|block ?list|blacklist|reputation|policy|dmarc|dkim|spf|unsolicited|\brbl\b|spamhaus|junk|rate limited|too many/i
    .test(err);
}

export async function trip(db: any, hours: number, why: string): Promise<void> {
  const until = new Date(Date.now() + hours * 3600e3).toISOString();
  const { error } = await db.rpc("mail_trip", { until, why });
  if (error) console.error("mail_trip :", error.message);
  else console.warn(`Voie o2switch coupée ${hours} h : ${why}`);
}

export type LogRow = {
  via: "smtp" | "brevo" | "none";
  ok: boolean;
  kind?: string | null;
  to: string;
  message_id?: string | null;
  ref?: string | null;
  error?: string | null;
};

export async function logMails(db: any, rows: LogRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db.from("mail_log").insert(rows.map((r) => ({
    via: r.via,
    ok: r.ok,
    kind: r.kind ?? null,
    to_domain: (r.to.split("@")[1] || "").toLowerCase().slice(0, 120),
    message_id: r.message_id ?? null,
    ref: r.ref ?? null,
    error: r.error ? r.error.slice(0, 500) : null,
  })));
  if (error) console.error("mail_log :", error.message);
}
