-- Ordre des morceaux d'un Verdict, choisi à la main (glisser-déposer).
-- Vide : ordre d'arrivée. Tout membre peut réordonner et renommer.
alter table projects add column if not exists position integer;
grant update (position) on projects to authenticated;
