-- Plafond de stockage total (B2 gratuit jusqu'à 10 Go) : place occupée =
-- fichiers sur B2 + uploads en cours
-- (déclarés, pas encore devenus des fichiers, de moins de 24 h).
create or replace function storage_used() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(size_bytes) from files where backend = 'b2'), 0)
       + coalesce((select sum(coalesce(size_bytes, declared_bytes)) from upload_sessions
                    where used_at is null and created_at > now() - interval '24 hours'), 0)
$$;
revoke all on function storage_used() from public, anon, authenticated;
grant execute on function storage_used() to service_role;
