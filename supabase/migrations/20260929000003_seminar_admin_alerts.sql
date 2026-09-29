-- Alertes email pour l'admin (fonction admin-alerts, toutes les heures).
-- Une ligne par alerte en cours : elle n'est envoyée qu'à son apparition,
-- puis rappelée au plus une fois par 24 h tant qu'elle dure ; sa
-- disparition est annoncée une fois. Fermé au navigateur.

create table admin_alerts (
  key          text primary key,
  level        text not null check (level in ('warn', 'crit')),
  title        text not null,
  detail       text,
  first_at     timestamptz not null default now(),
  last_sent_at timestamptz,
  seen_at      timestamptz not null default now()
);
alter table admin_alerts enable row level security;
revoke all on admin_alerts from public, anon, authenticated;

-- taille de la base (le plan gratuit Supabase s'arrête à 500 Mo)
create or replace function db_size() returns bigint
language sql stable security definer set search_path = public as $$
  select pg_database_size(current_database())
$$;
revoke all on function db_size() from public, anon, authenticated;
grant execute on function db_size() to service_role;

select cron.schedule('weshtransfer-admin-alerts', '47 * * * *', $cron$
  select net.http_post(
    url     := 'https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/admin-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'seminaire_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
