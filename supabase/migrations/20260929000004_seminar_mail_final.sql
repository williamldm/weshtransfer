-- mail_log.final : false pour une tentative o2switch refusée puis
-- retentée par Brevo (l'email est parti quand même). Seuls les échecs
-- définitifs (final = true, ok = false) déclenchent l'alerte admin.
alter table mail_log add column final boolean not null default true;
