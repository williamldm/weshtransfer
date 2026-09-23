-- WeshTransfer : n'importe qui peut créer son espace depuis le site.
-- Le créateur en devient host. Garde-fou : 5 espaces par utilisateur et
-- par 24 h (un utilisateur = une session anonyme = un appareil).

alter table spaces add column created_by uuid references auth.users(id) on delete set null;
create index spaces_created_by on spaces (created_by, created_at);

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
  if p_mode not in ('seminaire', 'envoi') then raise exception 'MODE_INVALIDE'; end if;
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

revoke all    on function create_my_space(text, text, text, int) from public, anon;
grant execute on function create_my_space(text, text, text, int) to authenticated;
