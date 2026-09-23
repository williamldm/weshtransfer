-- WeshTransfer : mode "revue" (retours de mix).
-- L'ingé son dépose ses mix, l'artiste commente à la seconde près ; chaque
-- commentaire devient une correction qu'on coche, et une version peut être
-- validée.
--
-- resolved_by / approved_by stockent le BLAZE, sans clé étrangère vers
-- participants : un second lien vers cette table rendrait ambigus tous les
-- embeds PostgREST existants (author:participants, uploader:participants).

alter table spaces drop constraint spaces_mode_check;
alter table spaces add constraint spaces_mode_check check (mode in ('seminaire', 'envoi', 'revue'));

alter table comments add column resolved_at timestamptz;
alter table comments add column resolved_by text;
alter table files add column approved_at timestamptz;
alter table files add column approved_by text;

-- Cocher / décocher une correction : tout membre de l'espace.
create or replace function set_comment_resolved(p_comment uuid, p_resolved boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_space uuid;
  v_me    uuid;
begin
  select space_id into v_space from comments where id = p_comment;
  v_me := me(v_space);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  update comments
     set resolved_at = case when p_resolved then now() end,
         resolved_by = case when p_resolved then (select pseudo from participants where id = v_me) end
   where id = p_comment;
end $$;

-- Valider / dévalider une version : tout membre de l'espace.
create or replace function set_file_approved(p_file uuid, p_approved boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_space uuid;
  v_me    uuid;
begin
  select space_id into v_space from files where id = p_file;
  v_me := me(v_space);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  update files
     set approved_at = case when p_approved then now() end,
         approved_by = case when p_approved then (select pseudo from participants where id = v_me) end
   where id = p_file;
end $$;

revoke all    on function set_comment_resolved(uuid, boolean) from public, anon;
grant execute on function set_comment_resolved(uuid, boolean) to authenticated;
revoke all    on function set_file_approved(uuid, boolean) from public, anon;
grant execute on function set_file_approved(uuid, boolean) to authenticated;

-- La création en libre-service accepte le nouveau mode.
create or replace function create_my_space(p_name text, p_mode text, p_pseudo text, p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code  text;
  v_space spaces;
  v_pid   uuid;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'NON_AUTHENTIFIE'; end if;
  if p_mode not in ('seminaire', 'envoi', 'revue') then raise exception 'MODE_INVALIDE'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 60 then raise exception 'NOM_INVALIDE'; end if;
  if char_length(trim(coalesce(p_pseudo, ''))) not between 2 and 24 then raise exception 'PSEUDO_INVALIDE'; end if;

  if (select count(*) from spaces
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

  return jsonb_build_object(
    'space_id', v_space.id, 'participant_id', v_pid, 'name', v_space.name,
    'code', v_space.code, 'mode', v_space.mode, 'expires_at', v_space.expires_at,
    'is_locked', false, 'max_file_bytes', v_space.max_file_bytes, 'is_host', true
  );
end $$;
