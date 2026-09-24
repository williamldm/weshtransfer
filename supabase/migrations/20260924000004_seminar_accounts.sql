-- Comptes par email, sans mot de passe.
--
-- Un compte = un utilisateur Supabase qui porte une adresse email. On s'y
-- connecte avec un code à 6 chiffres reçu à cette adresse (nos codes,
-- _shared/codes.ts), puis l'Edge Function account ouvre la session du
-- compte sur l'appareil (lien magique généré côté serveur, jamais envoyé
-- par email). Espaces, envois, carnet, blazes, droits d'hôte : tout est
-- rattaché à l'utilisateur, donc tout suit le compte d'un appareil à
-- l'autre.
--
-- Un appareil qui avait déjà des espaces sans compte (utilisateur anonyme)
-- les apporte au compte : merge_users déplace tout, sans rien perdre.

create or replace function account_for_email(p_email text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email))
  order by created_at
  limit 1
$$;
revoke all on function account_for_email(text) from public, anon, authenticated;
grant execute on function account_for_email(text) to service_role;

-- Déplace tout ce qui appartient à p_from (appareil anonyme) vers p_to (le
-- compte). Même espace des deux côtés : ce que l'appareil y a fait
-- (commentaires, fichiers, morceaux, envois) passe sur la place du compte.
create or replace function merge_users(p_from uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  p          record;
  v_existing uuid;
  v_moved    int := 0;
  v_merged   int := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return jsonb_build_object('moved', 0, 'merged', 0);
  end if;

  for p in select * from participants where user_id = p_from loop
    select id into v_existing from participants where space_id = p.space_id and user_id = p_to;
    if v_existing is null then
      update participants set user_id = p_to where id = p.id;
      v_moved := v_moved + 1;
    else
      update comments      set author_id = v_existing            where author_id = p.id;
      update files         set uploaded_by = v_existing          where uploaded_by = p.id;
      update projects      set created_by = v_existing           where created_by = p.id;
      update transfers     set sender_id = v_existing            where sender_id = p.id;
      update space_invites set invited_by = v_existing           where invited_by = p.id;
      update space_invites set accepted_participant = v_existing where accepted_participant = p.id;
      delete from review_subscriptions where participant_id = p.id
        and exists (select 1 from review_subscriptions where participant_id = v_existing);
      update review_subscriptions set participant_id = v_existing where participant_id = p.id;
      if p.is_host then update participants set is_host = true where id = v_existing; end if;
      delete from participants where id = p.id;
      v_merged := v_merged + 1;
    end if;
  end loop;

  update spaces set created_by = p_to where created_by = p_from;
  insert into sender_emails (user_id, email, verified_at)
    select p_to, email, verified_at from sender_emails where user_id = p_from
    on conflict (user_id, email) do nothing;
  delete from sender_emails where user_id = p_from;
  update upload_sessions set user_id = p_to where user_id = p_from;
  delete from email_codes where user_id = p_from;

  return jsonb_build_object('moved', v_moved, 'merged', v_merged);
end $$;
revoke all on function merge_users(uuid, uuid) from public, anon, authenticated;
grant execute on function merge_users(uuid, uuid) to service_role;
