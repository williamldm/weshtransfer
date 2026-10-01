-- Un seul espace Envois par compte, imposé par le serveur (01/10/2026) :
-- create_my_space('envoi') rend l'espace existant au lieu d'en créer un 2e.

CREATE OR REPLACE FUNCTION public.create_my_space(p_name text, p_mode text, p_pseudo text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- un seul espace Envois par compte (ou appareil) : on rend celui qui
  -- existe au lieu d'en créer un 2e (sinon Mes envois se partagerait)
  if p_mode = 'envoi' then
    select s.* into v_space from spaces s join participants p on p.space_id = s.id
     where s.mode = 'envoi' and p.user_id = auth.uid() and p.is_host
       and (s.purge_at is null or s.purge_at > now())
     order by s.created_at desc limit 1;
    if found then
      select id into v_pid from participants where space_id = v_space.id and user_id = auth.uid();
      return jsonb_build_object(
        'space_id', v_space.id, 'participant_id', v_pid, 'name', v_space.name,
        'code', v_space.code, 'mode', v_space.mode, 'access', v_space.access, 'expires_at', v_space.expires_at,
        'is_locked', v_space.is_locked, 'max_file_bytes', v_space.max_file_bytes, 'is_host', true, 'existing', true
      );
    end if;
  end if;

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
end $function$;
