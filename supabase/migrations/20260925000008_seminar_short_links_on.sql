-- Bascule vers les liens courts (une fois le site déployé : la page et les
-- règles Apache doivent connaître /t/...). Les anciens liens restent valables.
alter table transfers alter column token set default short_token(12);
alter table transfer_recipients alter column token set default short_token(12);
