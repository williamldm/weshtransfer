# Séminaire

Partage de sons pour un groupe en résidence : un espace, un code, des blazes,
des morceaux avec leurs versions, des commentaires horodatés sur la waveform,
et l'envoi par email façon WeTransfer à n'importe qui hors du groupe.

Front HTML/JS vanilla sans build, back Supabase (auth anonyme, Postgres,
Storage, Realtime, Edge Functions). Projet autonome : son propre dépôt, son
propre projet Supabase, aucune dépendance à un autre projet.

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

       supabase functions deploy send-transfer transfer-open purge-spaces --no-verify-jwt --use-api

5. **Emails** (facultatif, sinon mode lien) : compte Resend + domaine vérifié.

       supabase secrets set RESEND_API_KEY=re_... MAIL_FROM="Séminaire <envoi@domaine.fr>" SITE_URL=https://adresse-du-site

6. **Purge quotidienne** : `supabase secrets set CRON_SECRET=...`, puis une tâche
   pg_cron qui appelle `purge-spaces` avec l'en-tête `x-cron-secret`.
7. **Créer un espace** (SQL editor) :

       select code, expires_at, purge_at from create_space('Villa septembre', 14);

8. **Stockage** : en plan Free, 1 Go au total et **50 Mo par fichier**. Pour des
   WAV et des stems, passer le projet en Pro et relever la limite par fichier
   (Storage > Settings).

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

À déployer : `index.html`, `app.html`, `t.html`, `css/`, `js/`. Pas `dev/`,
`tools/` ni `supabase/`.

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
