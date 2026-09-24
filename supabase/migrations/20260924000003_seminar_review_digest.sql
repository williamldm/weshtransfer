-- Retours de mix : l'ingé est prévenu par email quand l'artiste a fait ses
-- retours. Un seul email récapitulatif, envoyé quand l'artiste n'a plus
-- rien fait depuis 10 minutes (ou tout de suite s'il appuie sur "J'ai
-- fini, prévenir l'ingé") : nouveaux retours, corrections refusées,
-- réponses, corrections validées, mix validé.
--
-- L'adresse de l'ingé est vérifiée par code (sender_emails) et n'est
-- lisible par personne d'autre : table fermée au navigateur, gérée par
-- l'Edge Function review-digest. Pas de clé étrangère vers spaces (la
-- suppression du participant, donc de l'espace, emporte l'abonnement) :
-- une table reliant spaces et participants rendrait ambigus les embeds.

create table review_subscriptions (
  participant_id uuid primary key references participants(id) on delete cascade,
  space_id       uuid not null,
  email          text not null check (email = lower(email) and char_length(email) <= 254),
  since          timestamptz not null default now(),   -- événements postérieurs = à signaler
  last_sent_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index review_subscriptions_space_idx on review_subscriptions (space_id);
alter table review_subscriptions enable row level security;
revoke all on review_subscriptions from public, anon, authenticated;

-- "Pas encore réglé" : on garde l'heure, pour le récapitulatif
alter table comments add column reopened_at timestamptz;

create or replace function set_comment_verified(p_comment uuid, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c         comments;
  v_project uuid;
  v_me      uuid;
  v_reason  text := nullif(trim(left(coalesce(p_reason, ''), 1000)), '');
begin
  select * into c from comments where id = p_comment and parent_id is null;
  if not found then raise exception 'RETOUR_INCONNU'; end if;
  v_me := me(c.space_id);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  if c.resolved_at is null then raise exception 'PAS_CORRIGE'; end if;
  select project_id into v_project from files where id = c.file_id;
  if is_engineer(v_project) and c.author_id is distinct from v_me then
    raise exception 'RESERVE_ARTISTE';
  end if;

  if p_ok then
    update comments set verified_at = now(), verified_by = (select pseudo from participants where id = v_me)
    where id = p_comment;
  else
    update comments set resolved_at = null, resolved_by = null, resolved_in = null,
      resolution_note = null, verified_at = null, verified_by = null, reopened_at = now()
    where id = p_comment;
    if v_reason is not null then
      insert into comments (file_id, body, parent_id) values (c.file_id, v_reason, c.id);
    end if;
  end if;
end $$;

-- Toutes les 5 minutes : récapitulatifs prêts (artiste inactif depuis 10 min)
select cron.schedule('seminaire-retours', '*/5 * * * *', $cron$
  select net.http_post(
    url     := 'https://mqjzzcnzbsbhololiiyw.supabase.co/functions/v1/review-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets
                        where name = 'seminaire_cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$cron$);
