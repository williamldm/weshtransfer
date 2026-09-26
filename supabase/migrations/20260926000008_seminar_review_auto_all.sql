-- Verdict : tout participant (ingé comme artiste) qui a un compte avec une
-- adresse confirmée est abonné d'office aux emails de l'espace ; le
-- contenu dépend de son rôle (retours de l'artiste pour l'ingé, nouvelles
-- versions pour l'artiste). Jamais s'il s'est désabonné (mail_optout).

create or replace function review_auto_subscribe(p_participant uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  insert into review_subscriptions (participant_id, space_id, email, since)
  select p.id, p.space_id, lower(u.email), now()
    from participants p
    join spaces s on s.id = p.space_id and s.mode = 'revue'
    join auth.users u on u.id = p.user_id
   where p.id = p_participant and not p.mail_optout
     and u.email is not null and u.email_confirmed_at is not null
     and char_length(u.email) <= 254
  on conflict (participant_id) do nothing;
end $$;
revoke all on function review_auto_subscribe(uuid) from public, anon, authenticated;

-- dépôt d'un mix
create or replace function files_auto_review_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.uploaded_by is not null then perform review_auto_subscribe(new.uploaded_by); end if;
  return new;
end $$;

-- entrée dans l'espace, ou connexion à un compte (user_id qui change)
create or replace function participants_auto_review_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform review_auto_subscribe(new.id);
  return new;
end $$;
create trigger participants_auto_review_mail after insert or update of user_id on participants
for each row execute function participants_auto_review_mail();

-- ceux qui sont déjà dans un Verdict
select review_auto_subscribe(p.id) from participants p join spaces s on s.id = p.space_id where s.mode = 'revue';
