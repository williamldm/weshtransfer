-- L'ingé peut noter qu'un mix est validé (l'artiste l'a dit ailleurs : au
-- téléphone, en studio...). La validation est alors marquée "notée par
-- l'ingé" (approved_on_behalf) : affichée comme telle, et jamais envoyée
-- à l'ingé comme une nouvelle dans l'email récapitulatif. L'artiste peut
-- toujours l'annuler ; l'ingé ne peut annuler que ce qu'il a noté lui-même.
alter table files add column if not exists approved_on_behalf boolean not null default false;

create or replace function public.set_file_approved(p_file uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $function$
declare
  v_space    uuid;
  v_uploader uuid;
  v_behalf   boolean;
  v_me       uuid;
  v_by_me    boolean;
begin
  select space_id, uploaded_by, approved_on_behalf into v_space, v_uploader, v_behalf from files where id = p_file;
  v_me := me(v_space);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  v_by_me := (v_uploader = v_me);
  -- l'ingé n'annule pas une validation donnée par l'artiste
  if v_by_me and not p_approved and not coalesce(v_behalf, false) then
    raise exception 'VALIDATION_ARTISTE';
  end if;
  update files
     set approved_at = case when p_approved then now() end,
         approved_by = case when p_approved then (select pseudo from participants where id = v_me) end,
         approved_on_behalf = p_approved and v_by_me
   where id = p_file;
end $function$;

-- un nouveau fichier n'arrive jamais validé
create or replace function public.files_reset_approval() returns trigger
language plpgsql as $$ begin new.approved_on_behalf := false; return new; end $$;
drop trigger if exists files_reset_approval on files;
create trigger files_reset_approval before insert on files for each row execute function files_reset_approval();
