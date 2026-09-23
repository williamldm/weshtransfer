-- Seminaire : le host peut supprimer les fichiers de son espace dans le
-- Storage, pas seulement la ligne en base. Sans ca, un fichier supprime par
-- le host (et non par son auteur) restait orphelin dans le bucket jusqu'a
-- la purge, et comptait contre le quota de stockage.

drop policy if exists seminar_member_delete on storage.objects;
create policy seminar_owner_or_host_delete on storage.objects for delete
  to authenticated
  using (bucket_id = 'seminar'
         and is_member(((storage.foldername(name))[2])::uuid)
         and (owner_id = auth.uid()::text
              or is_host(((storage.foldername(name))[2])::uuid)));
