-- Envois par lien seul, façon WeTransfer (30/09/2026).
--
-- On n'envoie plus de fichiers par email : un envoi donne un lien à
-- partager, sans compte ni adresse à vérifier. En échange :
--   - un lien vit 7 jours au plus, "jusqu'au premier téléchargement"
--     compris (avant : 30 jours, et sans limite pour ce mode) ;
--   - une même adresse IP ne crée qu'un envoi toutes les 10 minutes ;
--   - plus aucun email lié aux envois : ni aux destinataires, ni à
--     l'expéditeur (confirmation "a décollé", avis d'ouverture et de
--     téléchargement). create_transfer ignore donc destinataires et email
--     d'expéditeur ; la signature ne change pas (anciens onglets ouverts).
--
-- À appliquer dans l'éditeur SQL de Supabase (coller tout le fichier) ou
-- avec supabase db push. Le site marche avec ou sans : sans elle, seules
-- les limites ne sont pas imposées par le serveur.

-- ------------------------------------------ 7 jours au plus, toujours
-- Aussi à la modification : un client ne peut pas repousser la date
-- (grant update (expires_at) sert à "désactiver le lien maintenant").
create or replace function transfers_clamp_expiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_purge timestamptz;
  v_max   timestamptz := coalesce(new.created_at, now()) + interval '7 days';
begin
  if new.expires_at > v_max then new.expires_at := v_max; end if;
  select purge_at into v_purge from spaces where id = new.space_id;
  -- "jusqu'au premier téléchargement" : l'espace est gardé tant que le
  -- fichier est attendu (pin_space_for_downloads), pas de ramenée à la purge
  if new.until_download and new.expires_at > now() then return new; end if;
  if new.expires_at > v_purge then new.expires_at := v_purge; end if;
  return new;
end $$;

-- ------------------------------ un envoi par IP toutes les 10 minutes
-- Secondes à attendre avant que CETTE IP puisse créer un envoi (0 = tout
-- de suite). Sert à l'appli pour prévenir avant l'upload ; la vraie
-- barrière est dans create_transfer.
create or replace function transfer_wait_seconds() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(greatest(0, ceil(extract(epoch from (max(at) + interval '10 minutes' - now()))))::int, 0)
    from rate_events
   where kind = 'transfer' and ip_hash = client_ip_hash() and at > now() - interval '10 minutes'
$$;
revoke all on function transfer_wait_seconds() from public, anon;
grant execute on function transfer_wait_seconds() to authenticated;

create or replace function create_transfer(
  p_space     uuid,
  p_title     text,
  p_file_ids  uuid[],
  p_emails    text[]  default '{}',    -- ignoré : plus d'envoi par email
  p_message   text    default null,
  p_reply_to  text    default null,    -- ignoré : plus d'email à l'expéditeur
  p_days      int     default 7,
  p_notify    boolean default true,    -- ignoré
  p_until_download boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := me(p_space);
  v_space    spaces;
  v_transfer transfers;
  v_wanted   int;
  v_found    int;
  v_ip       text := client_ip_hash();
begin
  if v_me is null then raise exception 'NON_MEMBRE'; end if;

  select * into v_space from spaces where id = p_space;
  if v_space.purge_at < now() then raise exception 'ESPACE_EXPIRE'; end if;

  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'TITRE_INVALIDE';
  end if;

  -- fichiers : au moins un, tous dans CET espace, tous complets
  select count(distinct x) into v_wanted from unnest(coalesce(p_file_ids, '{}')) x;
  if v_wanted = 0   then raise exception 'AUCUN_FICHIER';     end if;
  if v_wanted > 100 then raise exception 'TROP_DE_FICHIERS';  end if;

  select count(*) into v_found from files f
  where f.id = any(p_file_ids) and f.space_id = p_space and f.status = 'ready';
  if v_found <> v_wanted then raise exception 'FICHIER_INVALIDE'; end if;

  -- une IP, un envoi par 10 minutes. Verrou par IP : deux clics
  -- simultanés ne passent pas tous les deux.
  perform pg_advisory_xact_lock(hashtextextended('transfer:' || v_ip, 0));
  if exists (select 1 from rate_events
              where kind = 'transfer' and ip_hash = v_ip and at > now() - interval '10 minutes') then
    raise exception 'UN_ENVOI_PAR_DIX_MINUTES';
  end if;

  insert into transfers (space_id, sender_id, title, message, reply_to,
                         expires_at, notify_sender, until_download)
  values (p_space, v_me, trim(p_title),
          nullif(trim(coalesce(p_message, '')), ''),
          null,
          now() + case when coalesce(p_until_download, false) then interval '7 days'
                       else make_interval(days => greatest(1, least(coalesce(p_days, 7), 7))) end,
          false,
          coalesce(p_until_download, false))
  returning * into v_transfer;

  insert into transfer_files (transfer_id, file_id, space_id, position)
  select v_transfer.id, x.id, p_space, min(x.ord)::int
  from unnest(p_file_ids) with ordinality as x(id, ord)
  group by x.id;

  perform rate_log('transfer');

  return jsonb_build_object(
    'id',         v_transfer.id,
    'token',      v_transfer.token,
    'expires_at', v_transfer.expires_at,
    'until_download', v_transfer.until_download,
    'recipients', 0
  );
end $$;

revoke all    on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean, boolean) from public, anon;
grant execute on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean, boolean) to authenticated;

-- ------------------------------------- les envois déjà faits
-- Plus d'avis par email (ouverture, téléchargement) pour eux non plus.
-- Leur date n'est pas touchée : un lien déjà partagé pour 30 jours reste
-- valable jusqu'au bout.
update transfers set notify_sender = false where notify_sender;
