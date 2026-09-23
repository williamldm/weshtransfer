-- Carnet des destinataires, rattaché à l'EMAIL de l'expéditeur (et non à
-- l'appareil) : on le retrouve sur n'importe quel appareil où cette
-- adresse a été vérifiée par code (sender_emails).
--
-- Écrit uniquement par send-transfer après un envoi réel, lu uniquement
-- par l'Edge Function contacts, qui exige l'adresse vérifiée par
-- l'appelant : sans ça, taper l'email de quelqu'un suffirait à voir à qui
-- il écrit. Aucun accès navigateur. Les contacts inutilisés depuis 180
-- jours sont effacés.

create table sender_contacts (
  sender_email text not null check (sender_email = lower(sender_email)),
  email        text not null check (email = lower(email) and char_length(email) <= 254),
  sends        int  not null default 1,
  last_at      timestamptz not null default now(),
  primary key (sender_email, email)
);
create index sender_contacts_recent_idx on sender_contacts (sender_email, last_at desc);

alter table sender_contacts enable row level security;
revoke all on sender_contacts from public, anon, authenticated;

-- Enregistre (ou rafraîchit) les destinataires d'un envoi, en une requête.
create or replace function remember_contacts(p_sender text, p_emails text[])
returns void language sql security definer set search_path = public as $$
  insert into sender_contacts (sender_email, email)
  select lower(trim(p_sender)), e
  from (select distinct lower(trim(x)) as e from unnest(p_emails) x) s
  where e ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and e <> lower(trim(p_sender))
  on conflict (sender_email, email)
  do update set sends = sender_contacts.sends + 1, last_at = now();
$$;
revoke all on function remember_contacts(text, text[]) from public, anon, authenticated;
grant execute on function remember_contacts(text, text[]) to service_role;
