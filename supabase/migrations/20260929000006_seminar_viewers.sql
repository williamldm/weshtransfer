-- Membres "écoute seule" : entrés par un lien de partage (WhatsApp...),
-- sans vérifier d'email. Ils écoutent et téléchargent, mais ne modifient
-- rien : ni retours, ni validation, ni dépôt, ni titre, ordre ou pochette.
-- Tout passe par me() (retourne NULL pour eux) et is_editor().

alter table participants add column viewer boolean not null default false;

create or replace function me(p_space uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from participants
  where space_id = p_space and user_id = auth.uid() and not viewer;
$$;

create or replace function is_editor(p_space uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select me(p_space) is not null;
$$;

drop policy proj_update on projects;
create policy proj_update on projects for update using (is_editor(space_id)) with check (is_editor(space_id));
drop policy cover_insert on space_covers;
create policy cover_insert on space_covers for insert with check (is_editor(space_id)
  and exists (select 1 from spaces s where s.id = space_covers.space_id and s.mode = 'revue'));
drop policy cover_update on space_covers;
create policy cover_update on space_covers for update using (is_editor(space_id)) with check (is_editor(space_id));
drop policy cover_delete on space_covers;
create policy cover_delete on space_covers for delete using (is_editor(space_id));

-- lien ouvert : plus besoin de le rendre au compte, il fait des "auditeurs"
