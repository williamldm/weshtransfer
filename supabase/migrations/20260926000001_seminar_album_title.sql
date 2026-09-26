-- Verdict : un titre d'album, à côté de la pochette (l'artiste le choisit
-- en arrivant). La ligne peut n'avoir qu'un titre, ou qu'une pochette.
alter table space_covers alter column image drop not null;
alter table space_covers add column if not exists title text
  check (title is null or char_length(trim(title)) between 1 and 80);
