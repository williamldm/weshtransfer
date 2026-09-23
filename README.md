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

Mise en place (interface web B2) :

1. **Bucket** : Create a Bucket, fichiers **privés**, Object Lock désactivé.
2. **CORS** (Bucket Settings > CORS Rules) : partager avec une seule
   origine HTTPS, `https://weshtransfer.fr`, pour l'API **compatible S3**. Ça autorise le navigateur à envoyer
   et lire via URL signée ; les fichiers restent privés.
3. **Lifecycle** : garder uniquement la dernière version (filet de
   sécurité : l'appli supprime déjà toutes les versions elle-même).
4. **Clé d'application** restreinte à ce bucket, accès lecture + écriture.
5. Secrets :

       supabase secrets set B2_KEY_ID=... B2_APP_KEY=... B2_BUCKET=... B2_ENDPOINT=https://s3.<region>.backblazeb2.com

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

       supabase functions deploy storage send-transfer transfer-open purge-spaces --no-verify-jwt --use-api

5. **Emails** (facultatif, sinon mode lien) : compte Brevo, domaine
   `weshtransfer.fr` authentifié (Brevo > Expéditeurs, domaines et IP
   dédiées > Domaines : enregistrements DKIM, DMARC et code Brevo à ajouter
   dans la zone DNS chez o2switch), expéditeur `envoi@weshtransfer.fr`.

       supabase secrets set BREVO_API_KEY=xkeysib-... MAIL_FROM="WeshTransfer <envoi@weshtransfer.fr>" SITE_URL=https://weshtransfer.fr

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
