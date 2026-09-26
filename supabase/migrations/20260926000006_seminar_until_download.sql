-- Envois "jusqu'au premier téléchargement" (défaut pour les archives :
-- sessions FL Studio zippées...). Pas de date limite ; chaque fichier est
-- détruit dès son premier téléchargement COMPLET par un destinataire.
--
-- Qui constate le téléchargement complet : le relais Cloudflare
-- (cloudflare/files-worker.js), qui voit passer le dernier octet, puis
-- transfer-open (action "complete", jeton signé HMAC) -> burn_transfer_file.
-- La purge horaire efface ensuite le fichier (burned_at) ; elle ne purge
-- pas un espace qui abrite encore un fichier en attente de téléchargement.

alter table transfers add column until_download boolean not null default false;
alter table files add column burned_at timestamptz;
create index files_burned on files (burned_at) where burned_at is not null;

-- la date "sans limite" (9999-12-31) ne doit pas être ramenée à la purge
-- de l'espace
create or replace function transfers_clamp_expiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_purge timestamptz;
begin
  if new.until_download and new.expires_at > now() then return new; end if;
  select purge_at into v_purge from spaces where id = new.space_id;
  if new.expires_at > v_purge then
    new.expires_at := v_purge;
  end if;
  return new;
end $$;

drop function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean);

create or replace function create_transfer(
  p_space     uuid,
  p_title     text,
  p_file_ids  uuid[],
  p_emails    text[]  default '{}',
  p_message   text    default null,
  p_reply_to  text    default null,
  p_days      int     default 7,
  p_notify    boolean default true,
  p_until_download boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := me(p_space);
  v_space    spaces;
  v_transfer transfers;
  v_emails   text[];
  v_email    text;
  v_wanted   int;
  v_found    int;
  v_recent   int;
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

  -- destinataires : normalises, dedoublonnes, valides un par un pour
  -- pouvoir dire lequel est faux
  select coalesce(array_agg(distinct e), '{}') into v_emails
  from (select lower(trim(x)) as e from unnest(coalesce(p_emails, '{}')) x) s
  where e <> '';

  foreach v_email in array v_emails loop
    if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
      raise exception 'EMAIL_INVALIDE:%', v_email;
    end if;
  end loop;

  if coalesce(array_length(v_emails, 1), 0) > 20 then
    raise exception 'TROP_DE_DESTINATAIRES';
  end if;

  -- garde-fou : l'espace ne doit pas pouvoir servir de relais de spam
  select count(*) into v_recent from transfer_recipients r
  where r.space_id = p_space and r.created_at > now() - interval '24 hours';
  if v_recent + coalesce(array_length(v_emails, 1), 0) > 200 then
    raise exception 'QUOTA_EMAILS';
  end if;

  if p_reply_to is not null and trim(p_reply_to) <> ''
     and lower(trim(p_reply_to)) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALIDE:%', p_reply_to;
  end if;

  insert into transfers (space_id, sender_id, title, message, reply_to,
                         expires_at, notify_sender, until_download)
  values (p_space, v_me, trim(p_title),
          nullif(trim(coalesce(p_message, '')), ''),
          nullif(lower(trim(coalesce(p_reply_to, ''))), ''),
          case when coalesce(p_until_download, false) then timestamptz '9999-12-31'
               else now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))) end,
          coalesce(p_notify, true),
          coalesce(p_until_download, false))
  returning * into v_transfer;

  insert into transfer_files (transfer_id, file_id, space_id, position)
  select v_transfer.id, x.id, p_space, min(x.ord)::int
  from unnest(p_file_ids) with ordinality as x(id, ord)
  group by x.id;

  insert into transfer_recipients (transfer_id, space_id, email)
  select v_transfer.id, p_space, e from unnest(v_emails) e;

  return jsonb_build_object(
    'id',         v_transfer.id,
    'token',      v_transfer.token,
    'expires_at', v_transfer.expires_at,
    'until_download', v_transfer.until_download,
    'recipients', coalesce(array_length(v_emails, 1), 0)
  );
end $$;

revoke all    on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean, boolean) from public, anon;
grant execute on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean, boolean) to authenticated;

-- Premier téléchargement complet d'un fichier d'un envoi "jusqu'au
-- téléchargement" : true la première fois seulement (verrou burned_at).
create or replace function burn_transfer_file(p_transfer uuid, p_file uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update files f set burned_at = now()
   where f.id = p_file and f.burned_at is null
     and exists (select 1 from transfer_files tf join transfers t on t.id = tf.transfer_id
                  where tf.file_id = p_file and tf.transfer_id = p_transfer
                    and t.until_download and t.expires_at > now());
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function burn_transfer_file(uuid, uuid) from public, anon, authenticated;
grant execute on function burn_transfer_file(uuid, uuid) to service_role;

-- Espaces à ne pas purger tout de suite : ils abritent un fichier encore
-- attendu (envoi "jusqu'au téléchargement" actif, fichier pas détruit)
create or replace function spaces_holding_downloads(p_spaces uuid[])
returns table (space_id uuid, file_id uuid) language sql stable security definer set search_path = public as $$
  select distinct f.space_id, f.id
    from files f
    join transfer_files tf on tf.file_id = f.id
    join transfers t on t.id = tf.transfer_id
   where f.space_id = any(p_spaces) and f.burned_at is null
     and t.until_download and t.expires_at > now()
$$;
revoke all on function spaces_holding_downloads(uuid[]) from public, anon, authenticated;
grant execute on function spaces_holding_downloads(uuid[]) to service_role;

-- Repousse la purge d'un tel espace de 7 jours (au-delà de la limite de 60
-- jours imposée aux utilisateurs : c'est le serveur qui décide ici)
create or replace function pin_space_for_downloads(p_space uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('wt.pin', '1', true);
  update spaces set purge_at = greatest(purge_at, now() + interval '7 days') where id = p_space and purge_at is not null;
end $$;
revoke all on function pin_space_for_downloads(uuid) from public, anon, authenticated;
grant execute on function pin_space_for_downloads(uuid) to service_role;

-- La limite de 60 jours reste pour les utilisateurs ; seul
-- pin_space_for_downloads (serveur) la franchit.
create or replace function spaces_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := old.created_at;

  if new.purge_at is null then
    if old.purge_at is not null then
      if old.mode <> 'revue' then
        raise exception 'CONSERVATION_RETOURS';
      end if;
      if (select count(*) from spaces where purge_at is null and created_by = old.created_by) >= 3
         or (select count(*) from spaces where purge_at is null) >= 500 then
        raise exception 'QUOTA_CONSERVATION';
      end if;
    end if;
    return new;
  end if;

  if coalesce(current_setting('wt.pin', true), '') = '1' then
    if new.expires_at > new.purge_at then new.expires_at := new.purge_at; end if;
    return new;
  end if;

  -- 60 jours au total depuis la création, prolongations comprises ; en
  -- sortant d'une conservation illimitée, 37 jours à partir d'aujourd'hui
  if new.purge_at > greatest(
       old.created_at + interval '60 days',
       case when old.purge_at is null then now() + interval '37 days' else old.created_at end) then
    raise exception 'DUREE_MAX';
  end if;
  if new.expires_at > new.purge_at then new.expires_at := new.purge_at; end if;
  return new;
end $$;
