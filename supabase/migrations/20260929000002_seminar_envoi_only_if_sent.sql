-- Espace "Envois" : il n'existe que si la personne a vraiment envoyé.
-- spaces.sent_at = premier envoi (transfert) créé dans l'espace. Un espace
-- d'envoi qui n'a jamais rien envoyé est effacé par la purge horaire :
--   - vide (aucun fichier, aucun dépôt en cours) : au bout d'une heure ;
--   - avec des fichiers déposés mais jamais envoyés : au bout de 24 h.
-- Supprimer ses envois plus tard ne fait pas disparaître l'espace.

alter table spaces add column sent_at timestamptz;
update spaces s set sent_at = (select min(t.created_at) from transfers t where t.space_id = s.id)
 where exists (select 1 from transfers t where t.space_id = s.id);

create or replace function transfers_mark_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update spaces set sent_at = now() where id = new.space_id and sent_at is null;
  return new;
end $$;
create trigger transfers_mark_sent after insert on transfers
for each row execute function transfers_mark_sent();

create or replace function abandoned_envoi_spaces(p_limit int default 100)
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select s.id, s.name from spaces s
   where s.mode = 'envoi' and s.sent_at is null
     and (
       s.created_at < now() - interval '24 hours'
       or (s.created_at < now() - interval '1 hour'
           and not exists (select 1 from files f where f.space_id = s.id)
           and not exists (select 1 from upload_sessions u where u.space_id = s.id and u.used_at is null
                                                           and u.created_at > now() - interval '2 hours'))
     )
   order by s.created_at
   limit p_limit
$$;
revoke all on function abandoned_envoi_spaces(int) from public, anon, authenticated;
grant execute on function abandoned_envoi_spaces(int) to service_role;
