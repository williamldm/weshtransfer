-- Retours de mix, deuxième version : la boucle complète entre l'artiste
-- (le client) et l'ingé son.
--
--   l'artiste demande  ->  l'ingé corrige (dans la vN, avec une note)
--                      ->  l'artiste confirme "c'est bon", ou rouvre
--                      ->  l'artiste valide le mix
--
-- Rôles, vérifiés ici et non dans le navigateur :
--   ingé    = host de l'espace, ou quiconque a déposé une version du morceau
--   artiste = tous les autres membres
-- Seul l'ingé coche "corrigé" ; seul l'artiste (ou l'auteur du retour)
-- confirme ou rouvre ; personne ne valide un mix qu'il a déposé lui-même.

alter table comments add column parent_id uuid references comments(id) on delete cascade;
alter table comments add column tag text
  check (tag in ('voix', 'instru', 'basse', 'batterie', 'effets', 'niveau', 'structure', 'autre'));
alter table comments add column resolved_in uuid references files(id) on delete set null;
alter table comments add column resolution_note text check (char_length(resolution_note) <= 500);
alter table comments add column verified_at timestamptz;
alter table comments add column verified_by text;
create index comments_parent_idx on comments (parent_id);
create index comments_resolved_in_idx on comments (resolved_in);

-- "Ce qui change dans cette version", écrit par l'ingé pour l'artiste
alter table files add column changelog text check (char_length(changelog) <= 2000);

grant insert (parent_id, tag) on comments to authenticated;
grant update (changelog) on files to authenticated;

-- ------------------------------------------------------------ rôles

create or replace function is_engineer(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = p_project
      and (is_host(p.space_id)
           or exists (select 1 from files f where f.project_id = p.id and f.uploaded_by = me(p.space_id))))
$$;
revoke all on function is_engineer(uuid) from public, anon;
grant execute on function is_engineer(uuid) to authenticated;

-- ------------------------------------ réponses et champs imposés

create or replace function comments_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_space  uuid;
  v_parent comments;
begin
  -- une réponse suit son retour : même fichier, pas d'horodatage propre,
  -- et on ne répond pas à une réponse
  if new.parent_id is not null then
    select * into v_parent from comments where id = new.parent_id;
    if not found or v_parent.parent_id is not null then
      raise exception 'RETOUR_INCONNU';
    end if;
    new.file_id := v_parent.file_id;
    new.at_ms   := null;
    new.tag     := null;
  end if;

  select space_id into v_space from files where id = new.file_id;
  if v_space is null then
    raise exception 'FICHIER_INCONNU';
  end if;
  new.space_id        := v_space;
  new.author_id       := coalesce(new.author_id, me(v_space));
  new.created_at      := now();
  new.resolved_at     := null;
  new.resolved_by     := null;
  new.resolved_in     := null;
  new.resolution_note := null;
  new.verified_at     := null;
  new.verified_by     := null;

  if (select count(*) from comments
      where author_id = new.author_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'TROP_RAPIDE';
  end if;
  if (select count(*) from comments where space_id = v_space) >= 5000 then
    raise exception 'ESPACE_PLEIN';
  end if;
  return new;
end $$;

-- ------------------------------------------- l'ingé coche "corrigé"
-- p_file : la version qui contient la correction (par défaut celle du
-- retour) ; p_note : ce qui a été fait, pour l'artiste.

drop function if exists set_comment_resolved(uuid, boolean);
create function set_comment_resolved(p_comment uuid, p_resolved boolean, p_file uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c         comments;
  v_project uuid;
  v_me      uuid;
begin
  select * into c from comments where id = p_comment and parent_id is null;
  if not found then raise exception 'RETOUR_INCONNU'; end if;
  v_me := me(c.space_id);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  select project_id into v_project from files where id = c.file_id;
  if not is_engineer(v_project) then raise exception 'RESERVE_INGE'; end if;
  if p_file is not null and not exists (select 1 from files where id = p_file and project_id = v_project) then
    raise exception 'FICHIER_INVALIDE';
  end if;

  update comments set
    resolved_at     = case when p_resolved then now() end,
    resolved_by     = case when p_resolved then (select pseudo from participants where id = v_me) end,
    resolved_in     = case when p_resolved then coalesce(p_file, c.file_id) end,
    resolution_note = case when p_resolved then nullif(trim(left(coalesce(p_note, ''), 500)), '') end,
    verified_at     = null,
    verified_by     = null
  where id = p_comment;
end $$;
revoke all on function set_comment_resolved(uuid, boolean, uuid, text) from public, anon;
grant execute on function set_comment_resolved(uuid, boolean, uuid, text) to authenticated;

-- --------------------------- l'artiste confirme, ou rouvre en expliquant

create or replace function set_comment_verified(p_comment uuid, p_ok boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c         comments;
  v_project uuid;
  v_me      uuid;
  v_reason  text := nullif(trim(left(coalesce(p_reason, ''), 1000)), '');
begin
  select * into c from comments where id = p_comment and parent_id is null;
  if not found then raise exception 'RETOUR_INCONNU'; end if;
  v_me := me(c.space_id);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  if c.resolved_at is null then raise exception 'PAS_CORRIGE'; end if;
  select project_id into v_project from files where id = c.file_id;
  if is_engineer(v_project) and c.author_id is distinct from v_me then
    raise exception 'RESERVE_ARTISTE';
  end if;

  if p_ok then
    update comments set verified_at = now(), verified_by = (select pseudo from participants where id = v_me)
    where id = p_comment;
  else
    update comments set resolved_at = null, resolved_by = null, resolved_in = null,
      resolution_note = null, verified_at = null, verified_by = null
    where id = p_comment;
    if v_reason is not null then
      insert into comments (file_id, body, parent_id) values (c.file_id, v_reason, c.id);
    end if;
  end if;
end $$;
revoke all on function set_comment_verified(uuid, boolean, text) from public, anon;
grant execute on function set_comment_verified(uuid, boolean, text) to authenticated;

-- ------------------------------ la validation revient à l'artiste

create or replace function set_file_approved(p_file uuid, p_approved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_space    uuid;
  v_uploader uuid;
  v_me       uuid;
begin
  select space_id, uploaded_by into v_space, v_uploader from files where id = p_file;
  v_me := me(v_space);
  if v_me is null then raise exception 'NON_MEMBRE'; end if;
  if v_uploader = v_me then raise exception 'VALIDATION_ARTISTE'; end if;
  update files
     set approved_at = case when p_approved then now() end,
         approved_by = case when p_approved then (select pseudo from participants where id = v_me) end
   where id = p_file;
end $$;
