-- Bande passante : un cumul par jour et par type de contenu.
--   audio / video / image / fichier : servi par le relais Cloudflare
--     (delivered = octets envoyés aux visiteurs, origin = octets tirés de
--     B2, c'est-à-dire ce que le cache n'a pas absorbé) ;
--   upload : octets reçus par B2 lors des envois (delivered).
-- Alimenté par la fonction "bandwidth" (relais) et par la fonction
-- "storage" (envois terminés). Fermé au navigateur : lu par l'admin.

create table bw_daily (
  day             date   not null,
  kind            text   not null check (kind in ('audio', 'video', 'image', 'fichier', 'upload')),
  delivered_bytes bigint not null default 0,
  origin_bytes    bigint not null default 0,
  requests        int    not null default 0,
  primary key (day, kind)
);
alter table bw_daily enable row level security;
revoke all on bw_daily from public, anon, authenticated;

create or replace function bw_add(p_kind text, p_delivered bigint, p_origin bigint, p_reqs int default 1)
returns void language sql security definer set search_path = public as $$
  insert into bw_daily (day, kind, delivered_bytes, origin_bytes, requests)
  values ((now() at time zone 'Europe/Paris')::date, p_kind,
          greatest(0, p_delivered), greatest(0, p_origin), greatest(0, p_reqs))
  on conflict (day, kind) do update set
    delivered_bytes = bw_daily.delivered_bytes + excluded.delivered_bytes,
    origin_bytes    = bw_daily.origin_bytes + excluded.origin_bytes,
    requests        = bw_daily.requests + excluded.requests;
$$;
revoke all on function bw_add(text, bigint, bigint, int) from public, anon, authenticated;
grant execute on function bw_add(text, bigint, bigint, int) to service_role;
