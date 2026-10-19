-- Verdict sans pochette : un visuel d'attente parmi 11 (0 = le vinyle
-- d'origine, 1 à 10 = les autres), tiré au hasard à la création du
-- Verdict pour que tous ne se ressemblent pas. Les Verdicts déjà créés
-- gardent le vinyle (art null).

alter table space_covers add column if not exists art smallint
  check (art is null or art between 0 and 10);

create or replace function public.spaces_pick_cover_art() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mode = 'revue' then
    insert into space_covers (space_id, art) values (new.id, 1 + floor(random() * 10)::int)
    on conflict (space_id) do update set art = coalesce(space_covers.art, excluded.art);
  end if;
  return new;
end $$;

drop trigger if exists spaces_pick_cover_art on spaces;
create trigger spaces_pick_cover_art after insert on spaces
for each row execute function spaces_pick_cover_art();
