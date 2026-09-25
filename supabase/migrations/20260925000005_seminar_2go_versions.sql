-- 1. 2 Go par fichier (au lieu de 3), pour tous les espaces.
alter table spaces alter column max_file_bytes set default 2147483648;
update spaces set max_file_bytes = 2147483648 where max_file_bytes > 2147483648;

-- 2. Une nouvelle version remplace les précédentes.
--    "Version" n'est pas toujours une version : un envoi range tous ses
--    fichiers dans un même morceau, des stems déposés ensemble aussi. Seuls
--    les dépôts marqués "replaces" (Envoyer la v2, ajout d'une version à un
--    morceau existant) effacent ce qui précède, jamais les fichiers du même
--    lot (batch), jamais dans un espace d'envoi, et seulement les versions
--    de l'auteur du dépôt (ou toutes, pour le host).
--    Les retours passent sur la nouvelle version, les transferts aussi.
--    Les fichiers stockés partent dans storage_trash, vidée par la purge
--    horaire (B2 n'est pas joignable depuis la base).

alter table files add column if not exists replaces boolean not null default false;
alter table files add column if not exists batch uuid;
grant insert (replaces, batch) on files to authenticated;

create table if not exists storage_trash (
  id           bigint generated always as identity primary key,
  storage_path text not null,
  backend      text not null,
  queued_at    timestamptz not null default now()
);
alter table storage_trash enable row level security;
revoke all on storage_trash from anon, authenticated;

create or replace function files_after_insert_replace() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mode text;
  v_host boolean;
  v_old  uuid[];
begin
  select mode into v_mode from spaces where id = new.space_id;
  if v_mode is null or v_mode = 'envoi' then return null; end if;
  select is_host into v_host from participants where id = new.uploaded_by;

  select array_agg(f.id) into v_old
    from files f
   where f.project_id = new.project_id
     and f.id <> new.id
     and f.version_no < new.version_no
     and (new.batch is null or f.batch is distinct from new.batch)
     and (coalesce(v_host, false) or f.uploaded_by = new.uploaded_by);
  if v_old is null then return null; end if;

  -- les retours suivent la nouvelle version (horodatages compris)
  update comments set file_id = new.id where file_id = any(v_old);
  -- les transferts déjà partis servent désormais la nouvelle version
  update transfer_files tf set file_id = new.id
   where tf.file_id = any(v_old)
     and not exists (select 1 from transfer_files x where x.transfer_id = tf.transfer_id and x.file_id = new.id);
  -- les fichiers stockés : à effacer par la purge
  insert into storage_trash (storage_path, backend)
    select storage_path, backend from files where id = any(v_old);
  delete from files where id = any(v_old);
  return null;
end $$;
revoke all on function files_after_insert_replace() from public, anon, authenticated;

drop trigger if exists files_after_insert_replace on files;
create trigger files_after_insert_replace after insert on files
  for each row when (new.replaces) execute function files_after_insert_replace();
