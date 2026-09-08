-- Seminaire : RLS + RPC d'entree
-- Modele : auth anonyme (signInAnonymously) => role "authenticated" + auth.uid() stable.
-- L'appartenance a un espace se materialise par une ligne dans participants,
-- creee uniquement par join_space() qui verifie le code court.

-- ------------------------------------------------------------- helpers
-- security definer obligatoire : sinon la policy de participants s'appelle
-- elle-meme et part en recursion infinie.
create or replace function is_member(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from participants
    where space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function me(p_space uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from participants
  where space_id = p_space and user_id = auth.uid();
$$;

create or replace function is_host(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from participants
    where space_id = p_space and user_id = auth.uid() and is_host
  );
$$;

grant execute on function is_member(uuid), me(uuid), is_host(uuid) to authenticated;

-- ---------------------------------------------------------- privileges
-- anon (pas encore authentifie) n'a acces a rien : tout passe par le JWT anonyme.
revoke all on table spaces, participants, projects, files, comments from anon;

grant select                         on table spaces       to authenticated;
grant update                         on table spaces       to authenticated;
grant select, update                 on table participants to authenticated;
grant select, insert, update, delete on table projects     to authenticated;
grant select, insert, update, delete on table files        to authenticated;
grant select, insert, delete         on table comments     to authenticated;

alter table spaces       enable row level security;
alter table participants enable row level security;
alter table projects     enable row level security;
alter table files        enable row level security;
alter table comments     enable row level security;

-- ------------------------------------------------------------- spaces
create policy space_read  on spaces for select using (is_member(id));
create policy space_admin on spaces for update using (is_host(id)) with check (is_host(id));
-- pas d'insert/delete client : creation via create_space(), suppression via la purge.

-- -------------------------------------------------------- participants
create policy part_read on participants for select using (is_member(space_id));
create policy part_self on participants for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------ projects
create policy proj_read   on projects for select using (is_member(space_id));
create policy proj_insert on projects for insert with check (created_by = me(space_id));
create policy proj_update on projects for update
  using (is_member(space_id)) with check (is_member(space_id));
create policy proj_delete on projects for delete
  using (created_by = me(space_id) or is_host(space_id));

-- --------------------------------------------------------------- files
create policy file_read   on files for select using (is_member(space_id));
create policy file_insert on files for insert with check (uploaded_by = me(space_id));
create policy file_update on files for update
  using (uploaded_by = me(space_id)) with check (uploaded_by = me(space_id));
create policy file_delete on files for delete
  using (uploaded_by = me(space_id) or is_host(space_id));

-- ------------------------------------------------------------ comments
create policy cmt_read   on comments for select using (is_member(space_id));
create policy cmt_insert on comments for insert with check (author_id = me(space_id));
create policy cmt_delete on comments for delete
  using (author_id = me(space_id) or is_host(space_id));

-- ------------------------------------------------- entree dans l'espace
-- Seule porte d'entree : verifie le code, cree/rafraichit le participant.
-- Le tout premier arrivant devient host.
create or replace function join_space(p_code text, p_pseudo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s      spaces;
  v_pid  uuid;
  v_host boolean;
begin
  if auth.uid() is null then
    raise exception 'NON_AUTHENTIFIE';
  end if;

  select * into s from spaces where code = upper(trim(p_code));
  if not found          then raise exception 'CODE_INVALIDE'; end if;
  if s.purge_at < now() then raise exception 'ESPACE_EXPIRE';  end if;

  -- un espace verrouille n'accepte plus de nouveau venu, mais laisse
  -- revenir ceux qui sont deja dedans (changement de telephone, cache vide...)
  if s.is_locked and not exists (
       select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid())
  then
    raise exception 'ESPACE_VERROUILLE';
  end if;

  -- le tout premier arrivant devient host
  v_host := not exists (select 1 from participants p where p.space_id = s.id);

  begin
    insert into participants (space_id, user_id, pseudo, is_host)
    values (s.id, auth.uid(), trim(p_pseudo), v_host)
    on conflict on constraint participants_space_id_user_id_key do update
      set pseudo = excluded.pseudo, last_seen_at = now()
    returning participants.id, participants.is_host into v_pid, v_host;
  exception
    when unique_violation then
      -- l'autre index unique : (space_id, lower(pseudo))
      raise exception 'PSEUDO_PRIS';
  end;

  return jsonb_build_object(
    'space_id',       s.id,
    'participant_id', v_pid,
    'name',           s.name,
    'code',           s.code,
    'expires_at',     s.expires_at,
    'is_locked',      s.is_locked,
    'max_file_bytes', s.max_file_bytes,
    'is_host',        v_host
  );
end $$;

revoke all    on function join_space(text, text) from public, anon;
grant execute on function join_space(text, text) to authenticated;

-- ------------------------------------------------- creation d'un espace
-- Reservee au service_role (Edge Function create-space ou SQL editor).
create or replace function create_space(p_name text, p_days int default 14)
returns spaces
language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  v_space spaces;
  -- alphabet sans caracteres ambigus (0/O, 1/I) : dictable a l'oral
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from spaces where code = v_code);
  end loop;

  insert into spaces (code, name, expires_at, purge_at)
  values (v_code, p_name,
          now() + make_interval(days => p_days),
          now() + make_interval(days => p_days + 7))
  returning * into v_space;

  return v_space;
end $$;

revoke all    on function create_space(text, int) from public, anon, authenticated;
grant execute on function create_space(text, int) to service_role;
