-- Retours de mix : possibilité de ne jamais supprimer l'espace.
--
-- purge_at vide = pas de suppression automatique : la purge nocturne ne
-- prend que les espaces dont purge_at est passé, et toutes les
-- comparaisons SQL avec une date vide sont fausses (rien ne "expire").
--
-- Garde-fous : réservé aux espaces de retours (l'hôte seul peut modifier
-- l'espace), 3 espaces sans suppression par créateur, 500 pour tout le
-- site. Les quotas d'upload (50 Go par espace, plafonds par jour) restent.
-- En remettant une date sur un vieil espace, elle repart de 37 jours à
-- partir d'aujourd'hui (sinon il serait purgé la nuit même).

alter table spaces alter column purge_at drop not null;

create or replace function spaces_before_update() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := old.created_at;

  if new.purge_at is null then
    if old.purge_at is not null then
      if old.mode <> 'revue' then
        raise exception 'CONSERVATION_RETOURS';
      end if;
      if (select count(*) from spaces where purge_at is null and created_by = old.created_by) >= 3
         or (select count(*) from spaces where purge_at is null) >= 500 then
        raise exception 'QUOTA_CONSERVATION';
      end if;
    end if;
    return new;
  end if;

  -- 60 jours au total depuis la création, prolongations comprises ; en
  -- sortant d'une conservation illimitée, 37 jours à partir d'aujourd'hui
  if new.purge_at > greatest(
       old.created_at + interval '60 days',
       case when old.purge_at is null then now() + interval '37 days' else old.created_at end) then
    raise exception 'DUREE_MAX';
  end if;
  if new.expires_at > new.purge_at then new.expires_at := new.purge_at; end if;
  return new;
end $$;
