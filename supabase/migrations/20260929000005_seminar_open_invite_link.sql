-- Lien de partage (WhatsApp...) pour un Verdict ou un séminaire : une
-- invitation "ouverte", sans adresse (email vide). Qui l'ouvre donne SON
-- email et le vérifie par code avant d'entrer : tout reste rattaché à un
-- compte. Un seul lien ouvert par espace ; l'hôte le recopie (jeton gardé
-- en clair, lisible par l'hôte seul, RLS), le renouvelle ou le coupe.
-- Plafond d'entrées par lien (max_uses) contre un lien qui fuite.

alter table space_invites alter column email drop not null;
alter table space_invites add column open_token text;
alter table space_invites add column max_uses int;
alter table space_invites add column uses int not null default 0;
create unique index space_invites_one_open on space_invites (space_id) where email is null;

-- une entrée de plus par le lien ouvert, dans la limite (atomique)
create or replace function use_open_invite(p_invite uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update space_invites set uses = uses + 1
   where id = p_invite and email is null and expires_at > now()
     and (max_uses is null or uses < max_uses);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function use_open_invite(uuid) from public, anon, authenticated;
grant execute on function use_open_invite(uuid) to service_role;
