-- Un mix validé qui reçoit une nouvelle demande de modification n'est plus
-- validé : le nouveau retour (ou une correction jugée "pas encore réglée")
-- lève la validation de la version concernée, pour que l'ingé voie qu'il
-- reste quelque chose à faire. Les notes de l'ingé lui-même (celui qui a
-- déposé le fichier) ne comptent pas : ce ne sont pas des demandes.

create or replace function public.comments_reopen_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then return new; end if;
    update files set approved_at = null, approved_by = null, approved_on_behalf = false
     where id = new.file_id and approved_at is not null
       and uploaded_by is distinct from new.author_id;
  elsif new.reopened_at is distinct from old.reopened_at and new.reopened_at is not null then
    update files set approved_at = null, approved_by = null, approved_on_behalf = false
     where id = new.file_id and approved_at is not null;
  end if;
  return new;
end $$;

drop trigger if exists comments_reopen_approval_ins on comments;
create trigger comments_reopen_approval_ins after insert on comments
for each row execute function comments_reopen_approval();

drop trigger if exists comments_reopen_approval_upd on comments;
create trigger comments_reopen_approval_upd after update of reopened_at on comments
for each row execute function comments_reopen_approval();
