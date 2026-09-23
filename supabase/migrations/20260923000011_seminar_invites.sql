-- Entrée sur invitation par email, pour les salons et les retours.
--
-- L'hôte invite une adresse ; l'invité reçoit un lien personnel. En
-- l'ouvrant, il reçoit un code à 6 chiffres à CETTE adresse : un lien
-- transféré ne suffit donc pas pour entrer. Une fois vérifié, l'appareil
-- est retenu (session + sender_emails) : plus de code à retaper. Sur un
-- nouvel appareil, la même personne revérifie son email et retrouve sa
-- place (même blaze, mêmes commentaires).
--
-- spaces.access : 'code'   = entrée avec le code d'espace (comme avant)
--                 'invite' = entrée sur invitation uniquement
-- Les nouveaux salons et retours naissent en 'invite' ; les espaces
-- existants restent en 'code'. L'hôte peut basculer.

alter table spaces add column access text not null default 'code'
  check (access in ('code', 'invite'));
grant update (access) on spaces to authenticated;

create table space_invites (
  id                  uuid primary key default gen_random_uuid(),
  space_id            uuid not null references spaces(id) on delete cascade,
  email               text not null check (email = lower(email) and char_length(email) <= 254),
  token_hash          text not null unique,          -- sha256 du jeton du lien, jamais le jeton
  invited_by          uuid references participants(id) on delete set null,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  accepted_at         timestamptz,
  accepted_participant uuid references participants(id) on delete set null,
  unique (space_id, email)
);
create index space_invites_space_idx on space_invites (space_id, created_at);

alter table space_invites enable row level security;
revoke all on space_invites from public, anon, authenticated;
-- l'hôte voit et annule les invitations de son espace ; tout le reste
-- (création, acceptation) passe par l'Edge Function invite
grant select (id, space_id, email, created_at, expires_at, accepted_at) on space_invites to authenticated;
grant delete on space_invites to authenticated;
create policy invite_host_read on space_invites for select using (is_host(space_id));
create policy invite_host_delete on space_invites for delete using (is_host(space_id));

-- ------------------------------------------ plus d'entrée par code seul

create or replace function join_space(p_code text, p_pseudo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s      spaces;
  v_pid  uuid;
  v_host boolean;
  v_rate record;
  v_in   boolean;
begin
  if auth.uid() is null then
    raise exception 'NON_AUTHENTIFIE';
  end if;

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

  v_in := exists (select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid());

  -- sur invitation : le code ne fait entrer que ceux qui sont déjà dedans
  if s.access = 'invite' and not v_in then
    raise exception 'INVITATION_REQUISE';
  end if;
  if s.is_locked and not v_in then
    raise exception 'ESPACE_VERROUILLE';
  end if;
  if not v_in and (select count(*) from participants p where p.space_id = s.id) >= 200 then
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
    'space_id', s.id, 'participant_id', v_pid, 'name', s.name, 'code', s.code,
    'mode', s.mode, 'access', s.access, 'expires_at', s.expires_at,
    'is_locked', s.is_locked, 'max_file_bytes', s.max_file_bytes, 'is_host', v_host
  );
end $$;

-- ------------------------ nouveaux salons et retours : sur invitation

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

  insert into spaces (code, name, mode, access, created_by, expires_at, purge_at)
  values (v_code, trim(p_name), p_mode,
          case when p_mode = 'envoi' then 'code' else 'invite' end,
          auth.uid(),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 30))),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 30), 30)) + 7))
  returning * into v_space;

  insert into participants (space_id, user_id, pseudo, is_host)
  values (v_space.id, auth.uid(), trim(p_pseudo), true)
  returning id into v_pid;

  perform rate_log('space_create');

  return jsonb_build_object(
    'space_id', v_space.id, 'participant_id', v_pid, 'name', v_space.name,
    'code', v_space.code, 'mode', v_space.mode, 'access', v_space.access, 'expires_at', v_space.expires_at,
    'is_locked', false, 'max_file_bytes', v_space.max_file_bytes, 'is_host', true
  );
end $$;
