-- Liens courts : weshtransfer.fr/t/k7Fq2Xa9Lm3P au lieu de
-- t.html?k=<32 caractères>. 12 caractères parmi 57 (sans 0/O, 1/l/I) :
-- 57^12 ~ 2^70 possibilités, impossible à deviner. Tirage sans biais
-- (rejet des octets >= 228 = 57 x 4).
create or replace function public.short_token(n int default 12) returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  b   bytea := gen_random_bytes(n * 2);
  i   int := 0;
  v   int;
  out text := '';
begin
  while length(out) < n loop
    if i >= length(b) then b := gen_random_bytes(n * 2); i := 0; end if;
    v := get_byte(b, i);
    i := i + 1;
    if v < 228 then out := out || substr(alphabet, 1 + (v % 57), 1); end if;
  end loop;
  return out;
end $$;
