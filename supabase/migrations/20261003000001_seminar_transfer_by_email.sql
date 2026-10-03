-- Option "envoyer aussi par email" (03/10/2026). L'envoi reste un lien ;
-- l'expéditeur peut ensuite l'adresser par email à des destinataires. Son
-- adresse doit être vérifiée par code : c'est send-transfer qui le contrôle
-- avant de faire partir quoi que ce soit, avec ses plafonds par jour.
create or replace function add_transfer_recipients(p_transfer uuid, p_emails text[], p_reply_to text)
returns int language plpgsql security definer set search_path = public as $$
declare
  t        transfers;
  v_emails text[];
  v_email  text;
  v_reply  text := lower(trim(coalesce(p_reply_to, '')));
  v_have   int;
  v_recent int;
  v_added  int;
begin
  select * into t from transfers where id = p_transfer;
  if not found or t.sender_id is distinct from me(t.space_id) then raise exception 'PAS_TON_ENVOI'; end if;
  if t.expires_at < now() then raise exception 'ENVOI_EXPIRE'; end if;
  if v_reply !~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' or char_length(v_reply) > 254 then
    raise exception 'EMAIL_INVALIDE:%', coalesce(p_reply_to, '');
  end if;

  select coalesce(array_agg(distinct e), '{}') into v_emails
    from (select lower(trim(x)) e from unnest(coalesce(p_emails, '{}')) x) s where e <> '';
  if coalesce(array_length(v_emails, 1), 0) = 0 then raise exception 'EMAIL_INVALIDE:'; end if;
  foreach v_email in array v_emails loop
    if v_email !~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' or char_length(v_email) > 254 then
      raise exception 'EMAIL_INVALIDE:%', v_email;
    end if;
  end loop;

  select count(*) into v_have from transfer_recipients where transfer_id = t.id;
  if v_have + array_length(v_emails, 1) > 20 then raise exception 'TROP_DE_DESTINATAIRES'; end if;
  -- l'espace ne doit pas servir de relais de spam
  select count(*) into v_recent from transfer_recipients
   where space_id = t.space_id and created_at > now() - interval '24 hours';
  if v_recent + array_length(v_emails, 1) > 100 then raise exception 'QUOTA_EMAILS'; end if;

  update transfers set reply_to = v_reply where id = t.id;
  insert into transfer_recipients (transfer_id, space_id, email)
  select t.id, t.space_id, e from unnest(v_emails) e
  on conflict (transfer_id, lower(email)) do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end $$;
revoke all on function add_transfer_recipients(uuid, text[], text) from public, anon;
grant execute on function add_transfer_recipients(uuid, text[], text) to authenticated;
