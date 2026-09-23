-- Vérification de l'email de l'expéditeur, façon WeTransfer : avant qu'un
-- email parte "de la part de" quelqu'un (Reply-To, avis de téléchargement),
-- cette personne prouve qu'elle lit bien cette boîte avec un code à 6
-- chiffres. Sans ça, n'importe qui pourrait faire écrire WeshTransfer à
-- n'importe qui en se faisant passer pour n'importe qui.
--
-- Rattachée à l'utilisateur anonyme (un appareil) : on vérifie une fois
-- par appareil et par adresse. Les deux tables ne sont lues et écrites que
-- par l'Edge Function verify-email (service_role) : aucun accès navigateur.

create table sender_emails (
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) <= 254),
  verified_at timestamptz not null default now(),
  primary key (user_id, email)
);

create table email_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null,
  code_hash  text not null,
  attempts   int  not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index email_codes_user_idx  on email_codes (user_id, created_at);
create index email_codes_email_idx on email_codes (email, created_at);

alter table sender_emails enable row level security;
alter table email_codes   enable row level security;
-- pas de policy : RLS fermée pour anon et authenticated
revoke all on sender_emails, email_codes from public, anon, authenticated;
