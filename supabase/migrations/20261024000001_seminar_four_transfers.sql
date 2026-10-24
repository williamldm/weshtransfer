-- Envois : 4 liens par fenêtre de 10 minutes et par connexion (au lieu
-- d'un seul), pour enchaîner plusieurs envois sans attendre. Le message
-- d'erreur garde son nom (UN_ENVOI_PAR_DIX_MINUTES) ; l'attente annoncée
-- à l'appli est celle de la fin de la fenêtre, quand les 4 sont pris.

create or replace function transfer_wait_seconds() returns int
language sql stable security definer set search_path = public as $$
  select coalesce(greatest(0, ceil(extract(epoch from ((array_agg(at order by at desc))[4] + interval '10 minutes' - now()))))::int, 0)
    from rate_events
   where kind = 'transfer' and ip_hash = client_ip_hash() and at > now() - interval '10 minutes'
$$;

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

  -- une IP : 4 envois par fenêtre de 10 minutes (avant : 1). Verrou par IP :
  -- deux clics simultanés ne passent pas tous les deux.
  perform pg_advisory_xact_lock(hashtextextended('transfer:' || v_ip, 0));
  if (select count(*) from rate_events
       where kind = 'transfer' and ip_hash = v_ip and at > now() - interval '10 minutes') >= 4 then
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
