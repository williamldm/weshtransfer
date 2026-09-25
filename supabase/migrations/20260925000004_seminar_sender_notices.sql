-- Avis à l'expéditeur : confirmation d'envoi (avec le lien) et première
-- ouverture du lien partagé. Une seule fois chacun : ces dates servent de
-- verrou (mise à jour conditionnelle "where ... is null").
alter table transfers add column if not exists sender_notified_at timestamptz;
alter table transfers add column if not exists link_opened_at timestamptz;
