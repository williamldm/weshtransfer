-- Emails : o2switch d'abord (gratuit), Brevo en secours. Un disjoncteur
-- coupe la voie o2switch dès qu'un signal dit que ses emails risquent de
-- finir en spam : refus "spam / politique" au moment de l'envoi, rebonds
-- 5.7.x reçus dans la boîte d'envoi, IP sur liste noire, destinataires qui
-- n'ouvrent plus les liens (comparé à Brevo). Brevo prend alors tout le
-- trafic jusqu'à ce que la voie soit saine. Tout est côté serveur
-- (service_role) : aucun accès depuis l'appli.

-- Journal de chaque email parti (ou refusé), 30 jours
create table mail_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  via         text not null check (via in ('smtp', 'brevo', 'none')),
  ok          boolean not null,
  kind        text,
  to_domain   text,
  message_id  text,
  ref         uuid,           -- transfer_recipients.id quand c'est un envoi
  error       text,
  bounced_at  timestamptz,
  bounce      text            -- code + diagnostic du rebond
);
create index mail_log_recent on mail_log (created_at desc);
create index mail_log_msg on mail_log (message_id) where message_id is not null;
create index mail_log_ref on mail_log (ref) where ref is not null;

-- État de la voie o2switch (une seule ligne)
create table mail_route (
  id            int primary key default 1 check (id = 1),
  smtp_paused_until timestamptz,
  reason        text,
  manual        boolean not null default false,   -- coupée à la main : pas de reprise auto
  checked_at    timestamptz,
  last_check    jsonb,
  updated_at    timestamptz not null default now()
);
insert into mail_route (id) values (1);

-- Événements du disjoncteur (historique lisible dans l'admin)
create table mail_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null,   -- pause, resume, blacklist, bounce, engagement, error
  detail      text
);
create index mail_events_recent on mail_events (created_at desc);

alter table mail_log enable row level security;
alter table mail_route enable row level security;
alter table mail_events enable row level security;
revoke all on mail_log, mail_route, mail_events from anon, authenticated;

-- Coupe la voie o2switch jusqu'à `until` (ne raccourcit jamais une coupure
-- plus longue déjà en cours, ne remplace pas une coupure manuelle)
create or replace function mail_trip(until timestamptz, why text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update mail_route
     set smtp_paused_until = greatest(coalesce(smtp_paused_until, now()), until),
         reason = case when manual then reason else left(why, 500) end,
         updated_at = now()
   where id = 1;
  insert into mail_events (kind, detail) values ('pause', left(why, 1000));
end $$;
revoke all on function mail_trip(timestamptz, text) from public, anon, authenticated;
grant execute on function mail_trip(timestamptz, text) to service_role;

-- Contrôle de santé toutes les heures (liste noire, rebonds, ouvertures)
select cron.schedule('weshtransfer-mail-health', '17 * * * *', $cron$
  select net.http_post(
    url     := 'https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/mail-health',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'seminaire_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
