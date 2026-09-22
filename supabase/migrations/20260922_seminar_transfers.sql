-- Seminaire : envois facon WeTransfer
--
-- Un envoi = une selection de fichiers de l'espace + zero ou plusieurs
-- destinataires email. Les destinataires n'ont ni compte ni code : chacun
-- recoit un lien personnel (token) qui ouvre une page publique servie par
-- l'Edge Function transfer-open. Sans destinataire, l'envoi sert juste a
-- obtenir un lien a coller dans WhatsApp.
--
-- Tout passe par create_transfer() : les tables ne sont qu'en lecture pour
-- les clients, ce qui garantit qu'un envoi ne contient que des fichiers de
-- l'espace et que les quotas anti-spam sont respectes.

-- ------------------------------------------------------------- tables
create table transfers (
  id             uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces(id) on delete cascade,
  sender_id      uuid references participants(id) on delete set null,
  title          text not null check (char_length(trim(title)) between 1 and 80),
  message        text check (char_length(message) <= 2000),
  reply_to       text check (reply_to is null
                   or (reply_to ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(reply_to) <= 254)),
  -- lien "public" de l'envoi (a partager hors email)
  token          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at     timestamptz not null,
  notify_sender  boolean not null default true,
  download_count int not null default 0,
  created_at     timestamptz not null default now()
);
create index transfers_space on transfers (space_id, created_at desc);

create table transfer_files (
  transfer_id uuid not null references transfers(id) on delete cascade,
  file_id     uuid not null references files(id) on delete cascade,
  space_id    uuid not null references spaces(id) on delete cascade,
  position    int  not null default 0,
  primary key (transfer_id, file_id)
);
create index transfer_files_file on transfer_files (file_id);

create table transfer_recipients (
  id                uuid primary key default gen_random_uuid(),
  transfer_id       uuid not null references transfers(id) on delete cascade,
  space_id          uuid not null references spaces(id) on delete cascade,
  email             text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                         and char_length(email) <= 254),
  -- lien personnel : permet de savoir QUI a ouvert / telecharge
  token             text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status            text not null default 'pending'
                      check (status in ('pending', 'sent', 'failed')),
  error             text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  first_opened_at   timestamptz,
  first_download_at timestamptz
);
create unique index transfer_recipients_uniq on transfer_recipients (transfer_id, lower(email));
create index transfer_recipients_quota on transfer_recipients (space_id, created_at);

-- ---------------------------------------------------------- privileges
revoke all on table transfers, transfer_files, transfer_recipients from anon;

grant select, delete        on table transfers           to authenticated;
grant update (expires_at)   on table transfers           to authenticated;
grant select                on table transfer_files      to authenticated;
grant select                on table transfer_recipients to authenticated;

alter table transfers           enable row level security;
alter table transfer_files      enable row level security;
alter table transfer_recipients enable row level security;

create policy tr_read   on transfers for select using (is_member(space_id));
-- revoquer un lien = ramener expires_at a maintenant
create policy tr_update on transfers for update
  using (sender_id = me(space_id) or is_host(space_id))
  with check (sender_id = me(space_id) or is_host(space_id));
create policy tr_delete on transfers for delete
  using (sender_id = me(space_id) or is_host(space_id));

create policy trf_read on transfer_files      for select using (is_member(space_id));
create policy trr_read on transfer_recipients for select using (is_member(space_id));

-- ------------------------------------------- expiration bornee a l'espace
-- Un lien ne peut pas survivre a la purge de l'espace : les fichiers
-- n'existeraient plus.
create or replace function transfers_clamp_expiry() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_purge timestamptz;
begin
  select purge_at into v_purge from spaces where id = new.space_id;
  if new.expires_at > v_purge then
    new.expires_at := v_purge;
  end if;
  return new;
end $$;

create trigger transfers_clamp_expiry before insert or update of expires_at on transfers
for each row execute function transfers_clamp_expiry();

-- --------------------------------------------------- creation d'un envoi
create or replace function create_transfer(
  p_space     uuid,
  p_title     text,
  p_file_ids  uuid[],
  p_emails    text[]  default '{}',
  p_message   text    default null,
  p_reply_to  text    default null,
  p_days      int     default 7,
  p_notify    boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me       uuid := me(p_space);
  v_space    spaces;
  v_transfer transfers;
  v_emails   text[];
  v_email    text;
  v_wanted   int;
  v_found    int;
  v_recent   int;
begin
  if v_me is null then raise exception 'NON_MEMBRE'; end if;

  select * into v_space from spaces where id = p_space;
  if v_space.purge_at < now() then raise exception 'ESPACE_EXPIRE'; end if;

  if char_length(trim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'TITRE_INVALIDE';
  end if;

  -- fichiers : au moins un, tous dans CET espace, tous complets
  select count(distinct x) into v_wanted from unnest(coalesce(p_file_ids, '{}')) x;
  if v_wanted = 0   then raise exception 'AUCUN_FICHIER';     end if;
  if v_wanted > 100 then raise exception 'TROP_DE_FICHIERS';  end if;

  select count(*) into v_found from files f
  where f.id = any(p_file_ids) and f.space_id = p_space and f.status = 'ready';
  if v_found <> v_wanted then raise exception 'FICHIER_INVALIDE'; end if;

  -- destinataires : normalises, dedoublonnes, valides un par un pour
  -- pouvoir dire lequel est faux
  select coalesce(array_agg(distinct e), '{}') into v_emails
  from (select lower(trim(x)) as e from unnest(coalesce(p_emails, '{}')) x) s
  where e <> '';

  foreach v_email in array v_emails loop
    if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
      raise exception 'EMAIL_INVALIDE:%', v_email;
    end if;
  end loop;

  if coalesce(array_length(v_emails, 1), 0) > 20 then
    raise exception 'TROP_DE_DESTINATAIRES';
  end if;

  -- garde-fou : l'espace ne doit pas pouvoir servir de relais de spam
  select count(*) into v_recent from transfer_recipients r
  where r.space_id = p_space and r.created_at > now() - interval '24 hours';
  if v_recent + coalesce(array_length(v_emails, 1), 0) > 200 then
    raise exception 'QUOTA_EMAILS';
  end if;

  if p_reply_to is not null and trim(p_reply_to) <> ''
     and lower(trim(p_reply_to)) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALIDE:%', p_reply_to;
  end if;

  insert into transfers (space_id, sender_id, title, message, reply_to,
                         expires_at, notify_sender)
  values (p_space, v_me, trim(p_title),
          nullif(trim(coalesce(p_message, '')), ''),
          nullif(lower(trim(coalesce(p_reply_to, ''))), ''),
          now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30))),
          coalesce(p_notify, true))
  returning * into v_transfer;

  insert into transfer_files (transfer_id, file_id, space_id, position)
  select v_transfer.id, x.id, p_space, min(x.ord)::int
  from unnest(p_file_ids) with ordinality as x(id, ord)
  group by x.id;

  insert into transfer_recipients (transfer_id, space_id, email)
  select v_transfer.id, p_space, e from unnest(v_emails) e;

  return jsonb_build_object(
    'id',         v_transfer.id,
    'token',      v_transfer.token,
    'expires_at', v_transfer.expires_at,
    'recipients', coalesce(array_length(v_emails, 1), 0)
  );
end $$;

revoke all    on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean) from public, anon;
grant execute on function create_transfer(uuid, text, uuid[], text[], text, text, int, boolean) to authenticated;

-- ------------------------------------ comptage des telechargements publics
-- Appelee uniquement par transfer-open (service_role). Renvoie de quoi
-- decider s'il faut prevenir l'expediteur (premier telechargement).
create or replace function register_transfer_download(p_transfer uuid, p_recipient uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_first boolean := false;
begin
  update transfers set download_count = download_count + 1
  where id = p_transfer
  returning download_count into v_count;

  if p_recipient is not null then
    update transfer_recipients set first_download_at = now()
    where id = p_recipient and transfer_id = p_transfer and first_download_at is null;
    v_first := found;
  else
    v_first := v_count = 1;
  end if;

  return jsonb_build_object('count', v_count, 'first', v_first);
end $$;

revoke all    on function register_transfer_download(uuid, uuid) from public, anon, authenticated;
grant execute on function register_transfer_download(uuid, uuid) to service_role;

-- ----------------------------------------------------------- realtime
alter publication supabase_realtime add table transfers, transfer_recipients;
alter table transfers           replica identity full;
alter table transfer_recipients replica identity full;
