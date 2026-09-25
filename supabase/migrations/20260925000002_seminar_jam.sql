-- Séminaire façon jam : chaque son disparaît au plus tard 5 jours après
-- son ajout. La purge (purge-spaces) passe désormais toutes les heures et
-- prend les fichiers de plus de 5 jours moins 70 minutes : aucun fichier
-- ne dépasse les 5 jours. Un morceau dont le dernier fichier part est
-- retiré de la file avec lui.

create or replace function files_after_delete_drop_empty_jam() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from spaces where id = old.space_id and mode = 'seminaire')
     and not exists (select 1 from files where project_id = old.project_id) then
    delete from projects where id = old.project_id;
  end if;
  return null;
end $$;

create trigger files_after_delete_drop_empty_jam after delete on files
  for each row execute function files_after_delete_drop_empty_jam();

-- Fichiers de séminaire arrivés au bout (lu par purge-spaces, service_role)
create or replace function jam_expired_files(p_limit int default 500)
returns table (id uuid, storage_path text, backend text)
language sql security definer set search_path = public as $$
  select f.id, f.storage_path, f.backend
    from files f join spaces s on s.id = f.space_id
   where s.mode = 'seminaire'
     and f.created_at < now() - interval '5 days' + interval '70 minutes'
   order by f.created_at
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
$$;
revoke all on function jam_expired_files(int) from public, anon, authenticated;
grant execute on function jam_expired_files(int) to service_role;

select cron.alter_job((select jobid from cron.job where jobname = 'seminaire-purge'), schedule := '17 * * * *');
