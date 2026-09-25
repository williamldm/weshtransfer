-- Audit de sécurité du 25/09/2026.

-- 1. Comptes : les comptes WeshTransfer passent par un code envoyé par
--    email (fonction account). Sans garde-fou, n'importe qui pouvait créer
--    via l'API d'auth un compte non confirmé avec mot de passe sur
--    l'adresse d'un autre, qui devenait le compte de la victime à sa
--    première connexion (pré-détournement).
-- Chaque écriture : pas de changement d'email à l'initiative de l'utilisateur.
create or replace function public.auth_users_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.email_change, '') <> '' then
    raise exception 'CHANGEMENT_EMAIL_INTERDIT';
  end if;
  return new;
end $$;
revoke all on function public.auth_users_guard() from public, anon, authenticated;
drop trigger if exists auth_users_guard on auth.users;
create trigger auth_users_guard before insert or update on auth.users
  for each row execute function public.auth_users_guard();

-- Fin de transaction : un compte à email doit être confirmé. Une
-- inscription directe à l'API (mot de passe, lien) laisse un compte non
-- confirmé : refusée. Les comptes créés par le serveur (fonction account)
-- sont confirmés dans la même transaction. Contrainte différée : GoTrue
-- crée la ligne puis la confirme en plusieurs requêtes.
create or replace function public.auth_users_confirmed_only() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if exists (select 1 from auth.users u
             where u.id = new.id and u.email is not null and not u.is_anonymous
               and u.email_confirmed_at is null) then
    raise exception 'COMPTE_NON_CONFIRME_INTERDIT';
  end if;
  return null;
end $$;
revoke all on function public.auth_users_confirmed_only() from public, anon, authenticated;
drop trigger if exists auth_users_confirmed_only on auth.users;
create constraint trigger auth_users_confirmed_only after insert or update on auth.users
  deferrable initially deferred
  for each row execute function public.auth_users_confirmed_only();

-- Le compte d'une adresse : uniquement un compte confirmé.
create or replace function public.account_for_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email)) and email_confirmed_at is not null
  order by created_at
  limit 1
$$;

-- Comptes non confirmés posés sur une adresse (inscription directe à
-- l'API d'auth) : effacés avant que le vrai propriétaire ne s'y connecte.
create or replace function public.drop_email_squatters(p_email text) returns integer
language plpgsql security definer set search_path = public, auth as $$
declare n integer;
begin
  delete from auth.users u
   where lower(u.email) = lower(trim(p_email))
     and u.email_confirmed_at is null
     and not exists (select 1 from public.participants p where p.user_id = u.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.drop_email_squatters(text) from public, anon, authenticated;
grant execute on function public.drop_email_squatters(text) to service_role;

-- 2. Temps réel : canaux privés. Seuls les membres d'un espace écoutent
--    et parlent sur "space:<id>" (présence, jam). Avant, n'importe qui
--    connaissant l'identifiant (visible dans les liens de fichiers d'un
--    transfert) pouvait s'y connecter.
create or replace function public.can_use_topic(p_topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_topic ~ '^space:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then is_member(substring(p_topic from 7)::uuid) else false end
$$;
revoke all on function public.can_use_topic(text) from public, anon;
grant execute on function public.can_use_topic(text) to authenticated;

drop policy if exists space_channel_read on realtime.messages;
drop policy if exists space_channel_write on realtime.messages;
create policy space_channel_read on realtime.messages for select to authenticated
  using (public.can_use_topic(realtime.topic()));
create policy space_channel_write on realtime.messages for insert to authenticated
  with check (public.can_use_topic(realtime.topic()));

-- 3. Espace d'envoi = boîte personnelle (transferts, adresses des
--    destinataires) : son code ne fait plus entrer personne d'autre que
--    ceux qui y sont déjà (autres appareils : connexion par email).
create or replace function public.join_space(p_code text, p_pseudo text) returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  s      spaces;
  v_pid  uuid;
  v_host boolean;
  v_rate record;
  v_in   boolean;
begin
  if auth.uid() is null then
    raise exception 'NON_AUTHENTIFIE';
  end if;
  select * into v_rate from rate_counts('join_fail', interval '1 hour');
  if v_rate.by_user >= 10 or v_rate.by_ip >= 30 then
    raise exception 'TROP_D_ESSAIS_CODE';
  end if;
  select * into s from spaces where code = upper(trim(p_code));
  if not found then
    perform rate_log('join_fail');
    return jsonb_build_object('error', 'CODE_INVALIDE');
  end if;
  if s.purge_at < now() then raise exception 'ESPACE_EXPIRE'; end if;
  v_in := exists (select 1 from participants p where p.space_id = s.id and p.user_id = auth.uid());
  -- sur invitation, ou boîte d'envoi personnelle : le code ne fait entrer
  -- que ceux qui sont déjà dedans
  if (s.access = 'invite' or s.mode = 'envoi') and not v_in then
    perform rate_log('join_fail');
    raise exception 'INVITATION_REQUISE';
  end if;
  if s.is_locked and not v_in then
    raise exception 'ESPACE_VERROUILLE';
  end if;
  if not v_in and (select count(*) from participants p where p.space_id = s.id) >= 200 then
    raise exception 'ESPACE_PLEIN';
  end if;
  v_host := not exists (select 1 from participants p where p.space_id = s.id);
  begin
    insert into participants (space_id, user_id, pseudo, is_host)
    values (s.id, auth.uid(), trim(p_pseudo), v_host)
    on conflict on constraint participants_space_id_user_id_key do update
      set pseudo = excluded.pseudo, last_seen_at = now()
    returning participants.id, participants.is_host into v_pid, v_host;
  exception
    when unique_violation then
      raise exception 'PSEUDO_PRIS';
  end;
  return jsonb_build_object(
    'space_id', s.id, 'participant_id', v_pid, 'name', s.name, 'code', s.code,
    'mode', s.mode, 'access', s.access, 'expires_at', s.expires_at,
    'is_locked', s.is_locked, 'max_file_bytes', s.max_file_bytes, 'is_host', v_host
  );
end $function$;

-- 4. Invitations : plafonds par appareil, par IP et pour tout le site
--    (avant : seulement par espace, et un espace se crée en un clic).
alter table space_invites add column if not exists invited_user uuid;
alter table space_invites add column if not exists ip_hash text;
create index if not exists space_invites_created_idx on space_invites (created_at);
