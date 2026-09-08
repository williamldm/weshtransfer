-- Seminaire : triggers
-- Le client n'a a fournir que le strict minimum : les colonnes de coherence
-- (space_id, auteur, numero de version) sont remplies ici, ce qui evite
-- qu'un client bavard ou bugge ecrive n'importe quoi.
-- Les BEFORE triggers passent avant le WITH CHECK de la RLS : les policies
-- valident donc bien la ligne finale.

-- ------------------------------------------------- projets : createur
create or replace function projects_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.created_by := coalesce(new.created_by, me(new.space_id));
  return new;
end $$;

create trigger projects_before_insert before insert on projects
for each row execute function projects_before_insert();

-- ---------------------------------- fichiers : espace, auteur, version
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

  if new.version_no is null then
    -- verrou par projet : deux uploads simultanes ne peuvent pas
    -- reserver le meme numero de version.
    perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
    select coalesce(max(version_no), 0) + 1 into new.version_no
    from files where project_id = new.project_id;
  end if;

  return new;
end $$;

create trigger files_before_insert before insert on files
for each row execute function files_before_insert();

-- ------------------------------------- commentaires : espace, auteur
create or replace function comments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_space uuid;
begin
  select space_id into v_space from files where id = new.file_id;
  if v_space is null then
    raise exception 'FICHIER_INCONNU';
  end if;
  new.space_id  := v_space;
  new.author_id := coalesce(new.author_id, me(v_space));
  return new;
end $$;

create trigger comments_before_insert before insert on comments
for each row execute function comments_before_insert();

-- ------------------------------------ derniere activite d'un projet
-- Alimente le tri "projets les plus chauds en haut" de la liste.
create or replace function bump_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  if tg_table_name = 'files' then
    v_project := new.project_id;
  else
    select project_id into v_project from files where id = new.file_id;
  end if;

  update projects set last_activity_at = now() where id = v_project;
  return null;
end $$;

create trigger files_bump_activity after insert on files
for each row execute function bump_project_activity();

create trigger comments_bump_activity after insert on comments
for each row execute function bump_project_activity();
