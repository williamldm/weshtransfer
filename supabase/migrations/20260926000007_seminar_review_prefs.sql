-- Verdict : emails activés d'office pour l'ingé, et préférences mémorisées
-- côté serveur (elles suivent la personne sur tous ses appareils).
--
-- participants.prefs : choix d'interface de la personne, modifiables par
-- elle seule (aide masquée, bandeaux fermés...). Rien de sensible.
-- participants.mail_optout : s'est désabonnée des emails de cet espace ;
-- on ne la réabonne jamais d'office. Écrit par le serveur uniquement.

alter table participants add column prefs jsonb not null default '{}'::jsonb
  check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) < 2048);
alter table participants add column mail_optout boolean not null default false;
grant update (prefs) on table participants to authenticated;

-- Premier mix déposé dans un Verdict : l'ingé (compte avec adresse
-- confirmée) reçoit d'office le récapitulatif des retours de l'artiste.
create or replace function files_auto_review_mail() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.uploaded_by is null then return new; end if;
  if (select mode from spaces where id = new.space_id) <> 'revue' then return new; end if;
  insert into review_subscriptions (participant_id, space_id, email, since)
  select p.id, new.space_id, lower(u.email), now()
    from participants p join auth.users u on u.id = p.user_id
   where p.id = new.uploaded_by and not p.mail_optout
     and u.email is not null and u.email_confirmed_at is not null
     and char_length(u.email) <= 254
  on conflict (participant_id) do nothing;
  return new;
end $$;

create trigger files_auto_review_mail after insert on files
for each row execute function files_auto_review_mail();
