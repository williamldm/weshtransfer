-- Seminaire : correction des privileges (faille trouvee en test reel).
--
-- Supabase donne par defaut TOUS les privileges (ALL) au role authenticated
-- sur chaque nouvelle table du schema public. Un "GRANT UPDATE (colonne)"
-- ne restreint donc rien tant que le privilege sur la table entiere existe :
-- un participant pouvait se promouvoir host, reecrire le storage_path de
-- son fichier vers celui d'un autre espace, ou reecrire le jeton d'un envoi.
--
-- Correctif : on retire les privileges de table en ecriture, puis on les
-- redonne au plus juste, colonne par colonne. La lecture reste geree par
-- la RLS.

revoke insert, update, delete, truncate, references, trigger
  on table spaces, participants, projects, files, comments,
           transfers, transfer_files, transfer_recipients
  from authenticated;

-- spaces : le host seul (policy), et seulement ces colonnes
grant update (name, is_locked, expires_at, purge_at)           on table spaces       to authenticated;

-- participants : son blaze et sa derniere visite, jamais is_host ni space_id
grant update (pseudo, last_seen_at)                            on table participants to authenticated;

grant insert, delete                                           on table projects     to authenticated;
grant update (title, notes, bpm, musical_key, archived)        on table projects     to authenticated;

-- files : jamais storage_path, project_id, space_id ni uploaded_by apres coup
grant insert, delete                                           on table files        to authenticated;
grant update (label, kind, bpm, musical_key, peaks, duration_sec) on table files     to authenticated;

grant insert, delete                                           on table comments     to authenticated;

-- transfers : revoquer (expires_at) ou supprimer ; jamais le jeton ni le compteur
grant delete                                                   on table transfers    to authenticated;
grant update (expires_at)                                      on table transfers    to authenticated;
-- transfer_files / transfer_recipients : lecture seule (ecritures via RPC
-- security definer et Edge Functions en service_role)

-- Le numero de version est toujours attribue par le serveur, meme si le
-- client en envoie un.
create or replace function files_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from projects where id = new.project_id;
  if v_space is null then
    raise exception 'PROJET_INCONNU';
  end if;
  new.space_id    := v_space;
  new.uploaded_by := coalesce(new.uploaded_by, me(v_space));

  if new.storage_path not like
       'spaces/' || v_space || '/' || new.project_id || '/' || new.id || '.%' then
    raise exception 'CHEMIN_INVALIDE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  select coalesce(max(version_no), 0) + 1 into new.version_no
  from files where project_id = new.project_id;

  return new;
end $$;

-- Storage : un membre ne peut ecraser (upsert) que ses propres fichiers.
drop policy if exists seminar_member_update on storage.objects;
create policy seminar_owner_update on storage.objects for update
  to authenticated
  using (bucket_id = 'seminar'
         and owner_id = auth.uid()::text
         and is_member(((storage.foldername(name))[2])::uuid));
