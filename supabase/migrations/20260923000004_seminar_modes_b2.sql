-- Seminaire : modes d'espace et stockage des fichiers sur Backblaze B2.
--
-- 1. Un espace a un mode :
--    'seminaire' : morceaux, versions, commentaires (le salon du groupe)
--    'envoi'     : l'accueil est directement l'envoi par email facon
--                  WeTransfer, les morceaux restent en coulisse.
-- 2. Chaque fichier sait ou il est stocke : 'supabase' (Storage) ou 'b2'
--    (Backblaze B2, compatible S3). Les nouveaux fichiers vont sur B2 des
--    que l'Edge Function storage a ses identifiants ; les anciens restent
--    lisibles la ou ils sont.

alter table spaces add column mode text not null default 'seminaire'
  check (mode in ('seminaire', 'envoi'));

alter table files add column backend text not null default 'supabase'
  check (backend in ('supabase', 'b2'));

-- ------------------------------------------------ creation d'un espace
drop function if exists create_space(text, int);

create or replace function create_space(p_name text, p_days int default 14, p_mode text default 'seminaire')
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

  insert into spaces (code, name, mode, expires_at, purge_at)
  values (v_code, p_name, p_mode,
          now() + make_interval(days => p_days),
          now() + make_interval(days => p_days + 7))
  returning * into v_space;

  return v_space;
end $$;

revoke all    on function create_space(text, int, text) from public, anon, authenticated;
grant execute on function create_space(text, int, text) to service_role;

-- ------------------------------------------ entree : renvoie aussi le mode
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

  if s.is_locked and not exists (
       select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid())
  then
    raise exception 'ESPACE_VERROUILLE';
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

revoke all    on function join_space(text, text) from public, anon;
grant execute on function join_space(text, text) to authenticated;
