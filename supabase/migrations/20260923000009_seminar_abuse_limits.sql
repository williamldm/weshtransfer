-- Garde-fous contre les abus : un site sans compte, c'est un site où
-- n'importe qui peut revenir avec une nouvelle session anonyme. Chaque
-- limite existe donc deux fois : par appareil (auth.uid()) et par adresse
-- IP (cf-connecting-ip, posé par Cloudflare, impossible à falsifier depuis
-- le navigateur ; stockée hachée).
--
-- 1. Durée de vie d'un espace plafonnée (le host prolongeait sans fin).
-- 2. Taille des fichiers relevée par le serveur, jamais déclarée par le
--    client : chaque fichier B2 doit correspondre à un upload terminé et
--    vérifié (upload_sessions), qui sert aussi aux quotas d'upload.
-- 3. Plafonds par espace (fichiers, morceaux, commentaires, envois) et
--    cadence (commentaires, morceaux).
-- 4. Essais de code d'espace limités (sinon on énumère les codes).
-- 5. Création d'espaces limitée aussi par IP.
-- 6. Plus d'upload direct vers le Storage Supabase : B2 est le stockage.
-- 7. Colonnes que le client n'a pas à choisir (dates, validations)
--    imposées par le serveur.

-- ------------------------------------------------------------ outils

create or replace function client_ip_hash() returns text
language sql stable set search_path = public as $$
  select encode(sha256(convert_to('wt:' || coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::json->>'cf-connecting-ip', ''),
    nullif(split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1), ''),
    'inconnue'), 'utf8')), 'hex')
$$;
revoke all on function client_ip_hash() from public, anon, authenticated;

create table rate_events (
  kind    text not null,
  user_id uuid,
  ip_hash text,
  at      timestamptz not null default now()
);
create index rate_events_user_idx on rate_events (kind, user_id, at);
create index rate_events_ip_idx   on rate_events (kind, ip_hash, at);
alter table rate_events enable row level security;
revoke all on rate_events from public, anon, authenticated;

-- nombre d'événements récents pour cet appareil et pour cette IP
create or replace function rate_counts(p_kind text, p_window interval, out by_user int, out by_ip int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from rate_events where kind = p_kind and user_id = auth.uid() and at > now() - p_window),
    (select count(*)::int from rate_events where kind = p_kind and ip_hash = client_ip_hash() and at > now() - p_window)
$$;
revoke all on function rate_counts(text, interval) from public, anon, authenticated;

create or replace function rate_log(p_kind text) returns void
language sql security definer set search_path = public as $$
  insert into rate_events (kind, user_id, ip_hash) values (p_kind, auth.uid(), client_ip_hash())
$$;
revoke all on function rate_log(text) from public, anon, authenticated;

-- --------------------------------------------- 1. durée de vie plafonnée

create or replace function spaces_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  -- 60 jours au total depuis la création, prolongations comprises
  if new.purge_at > old.created_at + interval '60 days' then
    raise exception 'DUREE_MAX';
  end if;
  if new.expires_at > new.purge_at then new.expires_at := new.purge_at; end if;
  new.created_at := old.created_at;
  return new;
end $$;
create trigger spaces_before_update before update on spaces
  for each row execute function spaces_before_update();

-- ------------------------------------- 2. uploads suivis par le serveur

create table upload_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  space_id       uuid not null references spaces(id) on delete cascade,
  storage_path   text not null unique,
  upload_id      text not null,
  declared_bytes bigint not null check (declared_bytes > 0),
  size_bytes     bigint,
  ip_hash        text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  used_at        timestamptz
);
create index upload_sessions_user_idx  on upload_sessions (user_id, created_at);
create index upload_sessions_ip_idx    on upload_sessions (ip_hash, created_at);
create index upload_sessions_space_idx on upload_sessions (space_id);
create index upload_sessions_day_idx   on upload_sessions (created_at);
alter table upload_sessions enable row level security;
revoke all on upload_sessions from public, anon, authenticated;

-- État des quotas avant d'ouvrir un upload (appelé par l'Edge Function
-- storage avec la clé service : auth.uid() n'y existe pas, d'où les
-- paramètres). Les uploads ouverts depuis plus de 2 jours sans être
-- terminés ont été annulés par B2 (règle de cycle de vie) : ils ne
-- comptent plus pour l'espace.
create or replace function upload_budget(p_user uuid, p_ip text, p_space uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_day',   (select coalesce(sum(declared_bytes), 0) from upload_sessions
                   where user_id = p_user and created_at > now() - interval '24 hours'),
    'ip_day',     (select coalesce(sum(declared_bytes), 0) from upload_sessions
                   where ip_hash = p_ip and created_at > now() - interval '24 hours'),
    'global_day', (select coalesce(sum(declared_bytes), 0) from upload_sessions
                   where created_at > now() - interval '24 hours'),
    'open',       (select count(*) from upload_sessions
                   where user_id = p_user and completed_at is null and created_at > now() - interval '24 hours'),
    'space',      (select coalesce(sum(size_bytes), 0) from files where space_id = p_space)
                + (select coalesce(sum(coalesce(size_bytes, declared_bytes)), 0) from upload_sessions
                   where space_id = p_space and used_at is null
                     and (completed_at is not null or created_at > now() - interval '2 days'))
  )
$$;
revoke all on function upload_budget(uuid, text, uuid) from public, anon, authenticated;
grant execute on function upload_budget(uuid, text, uuid) to service_role;

-- ------------------------------------------- 3. plafonds et cadence

create or replace function files_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_space uuid;
  v_size  bigint;
begin
  select space_id into v_space from projects where id = new.project_id;
  if v_space is null then
    raise exception 'PROJET_INCONNU';
  end if;
  new.space_id    := v_space;
  new.uploaded_by := coalesce(new.uploaded_by, me(v_space));
  new.created_at  := now();
  new.approved_at := null;
  new.approved_by := null;

  if new.storage_path not like
       'spaces/' || v_space || '/' || new.project_id || '/' || new.id || '.%' then
    raise exception 'CHEMIN_INVALIDE';
  end if;

  if (select count(*) from files where space_id = v_space) >= 1000 then
    raise exception 'ESPACE_PLEIN';
  end if;

  -- La taille vient de ce qui a réellement été stocké, pas du client.
  if new.backend = 'b2' then
    update upload_sessions set used_at = now()
    where storage_path = new.storage_path and user_id = auth.uid()
      and completed_at is not null and used_at is null
    returning size_bytes into v_size;
  else
    select (o.metadata->>'size')::bigint into v_size
    from storage.objects o
    where o.bucket_id = 'seminar' and o.name = new.storage_path and o.owner_id = auth.uid()::text;
  end if;
  if v_size is null then
    raise exception 'UPLOAD_INCONNU';
  end if;
  new.size_bytes := v_size;

  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  select coalesce(max(version_no), 0) + 1 into new.version_no
  from files where project_id = new.project_id;

  return new;
end $$;

create or replace function comments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from files where id = new.file_id;
  if v_space is null then
    raise exception 'FICHIER_INCONNU';
  end if;
  new.space_id    := v_space;
  new.author_id   := coalesce(new.author_id, me(v_space));
  new.created_at  := now();
  new.resolved_at := null;
  new.resolved_by := null;

  if (select count(*) from comments
      where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'TROP_RAPIDE';
  end if;
  if (select count(*) from comments where space_id = v_space) >= 5000 then
    raise exception 'ESPACE_PLEIN';
  end if;
  return new;
end $$;

create or replace function projects_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by       := coalesce(new.created_by, me(new.space_id));
  new.created_at       := now();
  new.last_activity_at := now();

  if (select count(*) from projects
      where created_by = new.created_by and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'TROP_RAPIDE';
  end if;
  if (select count(*) from projects where space_id = new.space_id) >= 500 then
    raise exception 'ESPACE_PLEIN';
  end if;
  return new;
end $$;

create or replace function transfers_before_insert_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from transfers
      where space_id = new.space_id and created_at > now() - interval '24 hours') >= 100 then
    raise exception 'QUOTA_ENVOIS';
  end if;
  return new;
end $$;
create trigger transfers_before_insert_limit before insert on transfers
  for each row execute function transfers_before_insert_limit();

-- ------------------------------------ 4. essais de code limités
-- Un code faux ne lève plus d'exception (elle annulerait la trace de
-- l'essai) : la fonction renvoie { error: 'CODE_INVALIDE' }.

create or replace function join_space(p_code text, p_pseudo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s      spaces;
  v_pid  uuid;
  v_host boolean;
  v_rate record;
begin
  if auth.uid() is null then
    raise exception 'NON_AUTHENTIFIE';
  end if;

  -- 10 codes faux par heure et par appareil, 30 par IP (un groupe entier
  -- sur le même wifi se trompe rarement 30 fois)
  select * into v_rate from rate_counts('join_fail', interval '1 hour');
  if v_rate.by_user >= 10 or v_rate.by_ip >= 30 then
    raise exception 'TROP_D_ESSAIS_CODE';
  end if;

  select * into s from spaces where code = upper(trim(p_code));
  if not found then
    perform rate_log('join_fail');
    return jsonb_build_object('error', 'CODE_INVALIDE');
  end if;
  if s.purge_at < now() then raise exception 'ESPACE_EXPIRE'; end if;

  if s.is_locked and not exists (
       select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid())
  then
    raise exception 'ESPACE_VERROUILLE';
  end if;

  if (select count(*) from participants p where p.space_id = s.id) >= 200
     and not exists (select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid()) then
    raise exception 'ESPACE_PLEIN';
  end if;

  v_host := not exists (select 1 from participants p where p.space_id = s.id);

  begin
    insert into participants (space_id, user_id, pseudo, is_host)
    values (s.id, auth.uid(), trim(p_pseudo), v_host)
    on conflict on constraint participants_space_id_user_id_key do update
      set pseudo = excluded.pseudo, last_seen_at = now()
    returning participants.id, participants.is_host into v_pid, v_host;
  exception
    when unique_violation then
      raise exception 'PSEUDO_PRIS';
  end;

  return jsonb_build_object(
    'space_id',       s.id,
    'participant_id', v_pid,
    'name',           s.name,
    'code',           s.code,
    'mode',           s.mode,
    'expires_at',     s.expires_at,
    'is_locked',      s.is_locked,
    'max_file_bytes', s.max_file_bytes,
    'is_host',        v_host
  );
end $$;

-- ------------------------------- 5. création d'espaces limitée par IP

create or replace function create_my_space(p_name text, p_mode text, p_pseudo text, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  v_space spaces;
  v_pid   uuid;
  v_rate  record;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'NON_AUTHENTIFIE'; end if;
  if p_mode not in ('seminaire', 'envoi', 'revue') then raise exception 'MODE_INVALIDE'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'NOM_INVALIDE'; end if;
  if char_length(trim(coalesce(p_pseudo, ''))) not between 2 and 24 then raise exception 'PSEUDO_INVALIDE'; end if;

  -- 5 par jour et par appareil, 10 par jour et par IP
  select * into v_rate from rate_counts('space_create', interval '24 hours');
  if v_rate.by_user >= 5 or v_rate.by_ip >= 10
     or (select count(*) from spaces
         where created_by = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'QUOTA_ESPACES';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from spaces where code = v_code);
  end loop;

  insert into spaces (code, name, mode, created_by, expires_at, purge_at)
  values (v_code, trim(p_name), p_mode, auth.uid(),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 30))),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 30)) + 7))
  returning * into v_space;

  insert into participants (space_id, user_id, pseudo, is_host)
  values (v_space.id, auth.uid(), trim(p_pseudo), true)
  returning id into v_pid;

  perform rate_log('space_create');

  return jsonb_build_object(
    'space_id', v_space.id, 'participant_id', v_pid, 'name', v_space.name,
    'code', v_space.code, 'mode', v_space.mode, 'expires_at', v_space.expires_at,
    'is_locked', false, 'max_file_bytes', v_space.max_file_bytes, 'is_host', true
  );
end $$;

-- ---------------------- 6. plus d'upload direct vers le Storage Supabase
-- B2 est le stockage. Les fichiers déjà sur Supabase restent lisibles et
-- supprimables. Pour revenir à Supabase (B2 coupé), recréer ces deux
-- policies (migration 20260908000004).
drop policy if exists seminar_member_write on storage.objects;
drop policy if exists seminar_owner_update on storage.objects;

-- ------------------------------------ codes de vérification : par IP
alter table email_codes add column ip_hash text;
create index email_codes_ip_idx on email_codes (ip_hash, created_at);

-- ------------------------------------------------ ménage quotidien

select cron.schedule('seminaire-menage', '47 4 * * *', $cron$
  delete from rate_events where at < now() - interval '2 days';
  delete from email_codes where created_at < now() - interval '2 days';
  delete from upload_sessions
   where created_at < now() - interval '3 days'
     and (used_at is not null or completed_at is null);
$cron$);
