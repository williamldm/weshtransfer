-- 3 Go envoyés par adresse IP (et par appareil) sur 24 h glissantes.
-- Avec une limite aussi basse, on ne compte que ce qui compte vraiment :
-- les envois terminés (taille réelle) et ceux en cours depuis moins de
-- 2 h (taille annoncée). Un envoi raté ou abandonné ne mange plus le
-- quota (sinon un fichier de 2 Go qui échoue puis qu'on relance suffisait
-- à bloquer la journée).
create or replace function public.upload_budget(p_user uuid, p_ip text, p_space uuid)
returns jsonb
language sql stable security definer set search_path = public as $function$
  with recent as (
    select user_id, ip_hash,
           case when completed_at is not null then coalesce(size_bytes, declared_bytes)
                when created_at > now() - interval '2 hours' then declared_bytes
                else 0 end as bytes
      from upload_sessions
     where created_at > now() - interval '24 hours'
  )
  select jsonb_build_object(
    'user_day',   (select coalesce(sum(bytes), 0) from recent where user_id = p_user),
    'ip_day',     (select coalesce(sum(bytes), 0) from recent where ip_hash = p_ip),
    'global_day', (select coalesce(sum(bytes), 0) from recent),
    'open',       (select count(*) from upload_sessions
                   where user_id = p_user and completed_at is null and created_at > now() - interval '24 hours'),
    'space',      (select coalesce(sum(size_bytes), 0) from files where space_id = p_space)
                + (select coalesce(sum(coalesce(size_bytes, declared_bytes)), 0) from upload_sessions
                   where space_id = p_space and used_at is null
                     and (completed_at is not null or created_at > now() - interval '2 days'))
  )
$function$;
revoke all on function public.upload_budget(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.upload_budget(uuid, text, uuid) to service_role;
