-- Pochette d'un espace de retours. Image recadrée et compressée côté
-- navigateur (JPEG 640 px, quelques dizaines de Ko) : stockée telle
-- quelle en data URL, une ligne par espace, lisible par ses seuls membres.

create table space_covers (
  space_id   uuid primary key references spaces(id) on delete cascade,
  image      text not null check (image ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
                                  and octet_length(image) <= 300000),
  updated_at timestamptz not null default now()
);

alter table space_covers enable row level security;
revoke all on space_covers from anon, authenticated;
grant select, insert, update, delete on space_covers to authenticated;

create policy cover_read on space_covers for select using (is_member(space_id));
create policy cover_insert on space_covers for insert
  with check (is_member(space_id) and exists (select 1 from spaces s where s.id = space_id and s.mode = 'revue'));
create policy cover_update on space_covers for update
  using (is_member(space_id)) with check (is_member(space_id));
create policy cover_delete on space_covers for delete using (is_member(space_id));
