-- Correctif : comments.resolved_in pointait vers files par une clé
-- étrangère. comments avait alors DEUX liens vers files (file_id et
-- resolved_in) et PostgREST refusait tout embed files <-> comments
-- ("more than one relationship was found") : la page d'un morceau ne
-- chargeait plus. Même règle que resolved_by / approved_by : pas de
-- seconde clé étrangère vers une table qu'on embarque.
--
-- set_comment_resolved vérifie déjà que la version appartient au morceau ;
-- un trigger remplace le "on delete set null" perdu.

alter table comments drop constraint if exists comments_resolved_in_fkey;

create or replace function files_after_delete_clear_resolved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update comments set resolved_in = null where resolved_in = old.id;
  return old;
end $$;

create trigger files_after_delete_clear_resolved after delete on files
  for each row execute function files_after_delete_clear_resolved();
