# WeshTransfer

En ligne : https://weshtransfer.fr

Partage de sons pour un groupe en résidence : un espace, un code, des blazes,
des morceaux avec leurs versions, des commentaires horodatés sur la waveform,
et l'envoi par email façon WeTransfer à n'importe qui hors du groupe.

Front HTML/JS vanilla sans build, back Supabase (auth anonyme, Postgres,
Storage, Realtime, Edge Functions). Projet autonome : son propre dépôt, son
propre projet Supabase, aucune dépendance à un autre projet.

## Espaces

Deux modes, fixés à la création :

- **séminaire** : morceaux, versions, commentaires horodatés, envois.
- **envoi** : l'accueil est directement le composeur façon WeTransfer ; les
  sons déposés sont rangés en coulisse, sans question.

    select code from create_space('Salon', 30, 'seminaire');
    select code from create_space('Envois', 30, 'envoi');

Un même appareil peut rejoindre plusieurs espaces et passer de l'un à
l'autre (feuille Participants > Mes espaces). Le premier qui entre dans un
espace en devient host.

## Stockage : Backblaze B2

Les fichiers audio vont sur un bucket B2 privé (API compatible S3). Le
navigateur envoie les octets directement à B2, en parties de 16 Mo, via des
URLs signées par l'Edge Function `storage` : reprise après coupure, et plus
de limite de 50 Mo par fichier. Tant que B2 n'est pas configuré, l'appli
bascule d'elle-même sur le Storage Supabase ; chaque fichier retient où il
est stocké (`files.backend`).

En service depuis le 2026-09-23 : bucket `weshtransfer` (privé, région
`eu-central-003`), clé d'application restreinte à ce bucket.

Réglages du bucket (posés par l'API `b2_update_bucket`) :

1. **Privé**, Object Lock désactivé.
2. **CORS** (API compatible S3) : `s3_get`, `s3_head`, `s3_put`, en-têtes
   `content-type` et `range`, depuis `https://weshtransfer.fr`, la copie
   Netlify et `http://127.0.0.1:5599` / `http://localhost:5599` (dev).
   Toute autre origine est refusée.
3. **Cycle de vie** : anciennes versions effacées un jour après avoir été
   masquées, uploads multipart abandonnés annulés au bout de deux jours
   (filets de sécurité : l'appli supprime déjà toutes les versions et
   annule ses uploads elle-même).
4. Secrets :

       supabase secrets set B2_KEY_ID=... B2_APP_KEY=... B2_BUCKET=weshtransfer B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com

## Fonctionnement

- **Entrée** : code d'espace + blaze. Chaque appareil reçoit un utilisateur
  anonyme Supabase ; `join_space()` vérifie le code. Le premier arrivé est host.
- **Morceaux et versions** : chaque upload est une version (`v1`, `v2`...) d'un
  morceau, typée (instru, voix, freestyle, mix, stems) avec BPM / tonalité.
  Type, BPM et titre sont devinés depuis le nom du fichier.
- **Upload** : TUS résumable (reprend après une coupure réseau), 2 fichiers en
  parallèle, waveform calculée pendant l'envoi, écran maintenu allumé.
- **Écoute** : lecteur global qui survit à la navigation, contrôles écran
  verrouillé, commentaires ancrés dans le temps et marqués sur la waveform.
- **Envoi façon WeTransfer** : sélection de fichiers + adresses email +
  message. Chaque destinataire reçoit un lien personnel vers `t.html` : écoute,
  téléchargement fichier par fichier ou tout en zip, sans compte. L'expéditeur
  voit qui a ouvert et téléchargé, et reçoit un email au premier téléchargement.
  Sans email configuré, l'appli fournit le lien à partager (WhatsApp, SMS...).
- **Temps réel** : nouveaux sons, commentaires, statuts d'envoi, présence.
- **Purge** : à `purge_at`, fichiers puis données de l'espace sont supprimés.

## Mise en route

1. **Base de données** : appliquer `supabase/migrations/` dans l'ordre
   (CLI : `supabase link --project-ref <ref>` puis `supabase db push`, à lancer
   depuis ce dossier et nulle part ailleurs).
2. **Clé publique** : mettre la clé *publishable* (Project Settings > API Keys)
   dans `js/config.js`. Jamais la clé secrète : l'appli refuse de démarrer.
3. **Auth** : Authentication > Sign In / Providers > Anonymous sign-ins : ON.
4. **Edge Functions** (toutes en `--no-verify-jwt`, elles vérifient elles-mêmes) :

       supabase functions deploy storage send-transfer transfer-open verify-email contacts invite purge-spaces --no-verify-jwt --use-api

5. **Emails** (facultatif, sinon mode lien). Deux voies, essayées dans cet
   ordre, chaque message refusé par la première repartant par la seconde :

   - **SMTP o2switch** (gratuit, n'entame pas le quota Brevo) : créer la
     boîte `envoi@weshtransfer.fr` dans cPanel > Comptes de messagerie.
     Port 465 obligatoire (les Edge Functions bloquent 25 et 587).

         supabase secrets set SMTP_HOST=mail.weshtransfer.fr SMTP_USER=envoi@weshtransfer.fr SMTP_PASS=...

   - **Brevo** (300 emails par jour en gratuit) : domaine authentifié chez
     Brevo (enregistrements DNS dans la zone o2switch).

         supabase secrets set BREVO_API_KEY=xkeysib-...

   Communs : `MAIL_FROM="WeshTransfer <envoi@weshtransfer.fr>"` et
   `SITE_URL=https://weshtransfer.fr`. La zone DNS doit garder un SPF qui
   couvre les deux voies (serveur o2switch et `include:spf.brevo.com`).

   Gabarits : `supabase/functions/_shared/mail-templates.js`, en JS pur pour
   être partagés avec `dev/emails.html`, qui les affiche avec des données
   fictives. Images des emails : `img/mail/` (PNG et JPEG : le SVG ne passe
   pas dans Gmail).

   **Vérification de l'expéditeur** : avant qu'un email parte "de la part
   de" quelqu'un (Reply-To, avis de téléchargement), l'adresse est vérifiée
   par un code à 6 chiffres (Edge Function `verify-email`, tables
   `sender_emails` et `email_codes`, fermées au navigateur). Une fois par
   appareil et par adresse. Limites : 5 codes par heure et par appareil,
   8 par jour et par adresse, 5 essais par code, 15 minutes de validité.

   **Carnet des destinataires** : rattaché à l'email d'expédition vérifié
   (table `sender_contacts`, écrite par `send-transfer` après un envoi
   réussi, lue par l'Edge Function `contacts`). On le retrouve sur tout
   appareil où cette adresse a été vérifiée, jamais ailleurs. 40 adresses
   proposées au plus, effacées après 180 jours sans envoi.

6. **Purge quotidienne** : un même secret, jamais versionné, à deux endroits :

       supabase secrets set CRON_SECRET=<secret>
       select vault.create_secret('<secret>', 'seminaire_cron_secret');   -- SQL editor

   La migration `..._seminar_cron.sql` planifie l'appel chaque nuit à 04h17 UTC.
7. **Créer un espace** (SQL editor), voir la section Espaces.

8. **Stockage** : voir la section B2. Sans B2, le Storage Supabase du plan Free
   limite à 1 Go au total et **50 Mo par fichier**.

## Développement local

    cd /Users/Shared/seminaire
    python3 -m http.server 5599

- `dev/views.html` : tous les écrans avec des données fictives, sans Supabase.
- `dev/transfer.html` : la page destinataire avec un serveur simulé.
- `dev/waveform-test.html` : décodage audio et rendu de la waveform.
- `dev/emails.html` : les emails avec des données fictives, ordinateur et téléphone.
- `python3 tools/scenes.py` : régénère les fonds d'écran (`img/scenes/`), scènes de nuit
  dans la palette de la centrale (`img/scene.svg`). Liste et légendes : `js/wallpapers.js`.
- `python3 tools/check.py` : contrôles avant mise en ligne (versions `?v=`
  cohérentes, aucune clé secrète dans le front, pas de guillemets
  typographiques dans le code).
- `python3 tools/bump.py` : incrémente `?v=N` partout, à chaque mise en ligne.

## Mise en ligne

Hébergement : o2switch (Apache), domaine `weshtransfer.fr`, déployé depuis
GitHub : cPanel > Git Version Control > *Update from Remote* puis *Deploy HEAD
Commit*. `.cpanel.yml` ne copie que les fichiers publics : les trois pages,
`robots.txt`, `.htaccess`, `css/`, `js/`, `fonts/`, `img/`.

À la main, `python3 tools/build.py` prépare la même sélection dans `_deploy/`
(contrôles compris) ; c'est **le contenu** de ce dossier qui va à la racine du
site, `.htaccess` compris (fichier caché).

Le `.htaccess` force le HTTPS (l'appli en a besoin), renvoie `www` vers le
domaine nu, et ne sert que les fichiers publics : si le dépôt entier se
retrouve en ligne, `dev/`, `tools/`, `supabase/` et ce README répondent 404.
Il faut un certificat valide avant de le déposer (cPanel > SSL/TLS Status >
Run AutoSSL), sinon le site bascule sur une alerte de sécurité.

Netlify (`netlify.toml`) reste possible pour une copie de test : même
`_deploy`, mêmes en-têtes.

## Sécurité

### Entrée sur invitation (salons et retours)

Les salons et espaces de retours créés depuis l'accueil sont **sur
invitation** (`spaces.access = 'invite'`) : le code d'espace ne fait plus
entrer que ceux qui sont déjà dedans. L'hôte invite par email (fiche
Participants) ; chaque invité reçoit un lien personnel (`index.html?i=`,
jeton de 128 bits dont seul le sha256 est stocké), puis un code à 6
chiffres envoyé à l'adresse invitée : un lien transféré ne suffit pas.
Une fois vérifiée, l'adresse est retenue pour l'appareil (plus de code) ;
sur un nouvel appareil, la même personne revérifie et reprend sa place
(même blaze). L'hôte peut repasser en "entrée avec le code". Codes :
`_shared/codes.ts` (mêmes limites que la vérification de l'expéditeur).
Edge Function `invite`, table `space_invites`.

### Garde-fous contre les abus

Sans compte, n'importe qui peut revenir avec une nouvelle session
anonyme : chaque limite existe par appareil **et** par IP
(`cf-connecting-ip`, posé par Cloudflare, stocké haché), plus des
disjoncteurs globaux. Migration `..._seminar_abuse_limits.sql`.

| Quoi | Limite |
| --- | --- |
| Upload par appareil / par IP, sur 24 h | 20 Go / 40 Go (`UPLOAD_USER_DAY_GB`, `UPLOAD_IP_DAY_GB`) |
| Upload pour tout le site, sur 24 h | 200 Go (`UPLOAD_GLOBAL_DAY_GB`) |
| Taille d'un espace | 50 Go (`SPACE_MAX_GB`), 1 000 fichiers, 500 morceaux |
| Uploads ouverts en même temps | 12 par appareil |
| Durée de vie d'un espace | 60 jours au plus, prolongations comprises ; espaces de retours : option "ne jamais supprimer" (`purge_at` vide), 3 par créateur, 500 au total |
| Création d'espaces | 5 par jour et par appareil, 10 par IP |
| Codes d'espace faux | 10 par heure et par appareil, 30 par IP |
| Commentaires | 20 par minute et par personne, 5 000 par espace |
| Envois | 100 par jour et par espace |
| Emails d'envoi | 60 destinataires par jour et par expéditeur (`MAIL_SENDER_DAY`), plafond global (`MAIL_GLOBAL_DAY`) |
| Codes de vérification | 5/h par appareil, 10/h par IP, 8/jour par adresse, 100/h au total |

Uploads B2 : chaque upload est ouvert, suivi et clos par le serveur
(`upload_sessions`). La taille de chaque partie est **signée** dans son
URL (B2 refuse un octet de plus ou de moins), l'upload n'est validé que si
toutes les parties sont là et font exactement la taille annoncée, et la
taille enregistrée en base vient du serveur, jamais du client. Le type
servi par B2 est décidé par le serveur d'après l'extension (un `.html`
déposé est servi en `application/octet-stream`, pas comme une page).
L'upload direct vers le Storage Supabase est coupé.

En-têtes du site (`.htaccess`, `netlify.toml`) : CSP stricte (scripts du
site et de jsDelivr seulement, aucun script en ligne), `nosniff`,
`X-Frame-Options`, `Permissions-Policy`.

- Le rôle `anon` n'a accès à rien ; tout passe par une session anonyme membre
  de l'espace (`is_member()`), et on ne modifie que ce qu'on a posté.
- Les UPDATE sont limités colonne par colonne.
- Un fichier ne peut être déclaré qu'à son chemin imposé
  (`spaces/<espace>/<morceau>/<id>.<ext>`) : impossible de glisser le fichier
  d'un autre espace dans un envoi public.
- Les envois passent par `create_transfer()` : fichiers de l'espace uniquement,
  20 destinataires max, 200 emails par jour et par espace.
- Les liens publics sont des jetons aléatoires de 122 bits, expirent, et
  peuvent être désactivés par l'expéditeur ou le host.
