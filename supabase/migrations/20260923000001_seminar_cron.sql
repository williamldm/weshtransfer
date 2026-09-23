-- Seminaire : purge quotidienne des espaces arrives a expiration.
--
-- pg_cron declenche chaque nuit un appel HTTP (pg_net) a l'Edge Function
-- purge-spaces, qui supprime d'abord les fichiers du Storage puis l'espace.
-- Le secret partage est lu dans Vault au moment de l'appel : il n'apparait
-- ni dans ce fichier ni dans la table cron.job.
--
-- Prerequis (une fois, hors migration, valeur jamais versionnee) :
--   select vault.create_secret('<secret>', 'seminaire_cron_secret');
--   supabase secrets set CRON_SECRET=<secret>

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- idempotent : on remplace la tache si elle existe deja
select cron.unschedule(jobid) from cron.job where jobname = 'seminaire-purge';

select cron.schedule(
  'seminaire-purge',
  '17 4 * * *',   -- 04h17 UTC chaque jour
  $job$
    select net.http_post(
      url     := 'https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/purge-spaces',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'seminaire_cron_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
