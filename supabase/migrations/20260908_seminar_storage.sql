-- Seminaire : bucket Storage + Realtime

-- ------------------------------------------------------------- bucket
-- Prive : aucune lecture publique, tout passe par des URLs signees.
-- allowed_mime_types volontairement NULL : sur mobile, un .m4a ou un .aiff
-- arrive souvent en application/octet-stream et serait rejete a tort.
-- Le filtrage se fait a l'extension cote client + file_size_limit ici.
insert into storage.buckets (id, name, public, file_size_limit)
values ('seminar', 'seminar', false, 3221225472)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Chemin : spaces/<space_id>/<project_id>/<file_id>.<ext>
-- foldername(name) => {spaces, <space_id>, <project_id>} donc [2] = space_id.
create policy seminar_member_read on storage.objects for select
  to authenticated
  using (bucket_id = 'seminar'
         and is_member(((storage.foldername(name))[2])::uuid));

create policy seminar_member_write on storage.objects for insert
  to authenticated
  with check (bucket_id = 'seminar'
              and is_member(((storage.foldername(name))[2])::uuid));

create policy seminar_member_update on storage.objects for update
  to authenticated
  using (bucket_id = 'seminar'
         and is_member(((storage.foldername(name))[2])::uuid));

create policy seminar_member_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'seminar'
         and owner_id = auth.uid()::text
         and is_member(((storage.foldername(name))[2])::uuid));

-- ----------------------------------------------------------- realtime
-- Les Postgres Changes repassent par la RLS du role authenticated :
-- un participant ne recoit que les evenements de son espace.
alter publication supabase_realtime add table projects, files, comments, participants;

-- Necessaire pour que les payloads DELETE/UPDATE contiennent de quoi
-- identifier la ligne cote client.
alter table projects     replica identity full;
alter table files        replica identity full;
alter table comments     replica identity full;
alter table participants replica identity full;
