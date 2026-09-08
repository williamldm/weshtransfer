# Seminaire

Partage de sons pour un groupe en residence : un espace, un code, des pseudos,
des morceaux avec leurs versions, des commentaires horodates sur la waveform.

Front HTML/JS vanilla sans build, back Supabase (auth anonyme, Postgres, Storage,
Realtime). Le front est purement statique : n importe quel hebergeur de fichiers
fait l affaire.

Projet autonome : aucune dependance, aucun code et aucune infrastructure
partages avec un autre projet. Son propre depot git, son propre projet
Supabase, son propre serveur de developpement (port 5599).

## Developpement local

Le projet vit hors du dossier personnel (`/Users/Shared/seminaire`) pour deux
raisons : rester en dehors de tout autre depot git, et echapper a la protection
macOS qui empeche un serveur local de lire `~/Documents` et `~/Desktop`.

    cd /Users/Shared/seminaire
    python3 -m http.server 5599

## Mise en route

1. Creer un **projet Supabase dedie** a cette application.
2. Lier et pousser les migrations :

       supabase link --project-ref <ref>
       supabase db push

3. Copier `js/config.example.js` en `js/config.js` et y mettre l'URL + l'anon key.
4. Dans le dashboard : **Authentication > Providers > Anonymous sign-ins : ON**.
   Sans ca, aucun participant ne peut entrer.
5. Creer un espace (SQL editor, en service_role) :

       select * from create_space('Villa septembre', 14);

   La colonne `code` est le code court a partager. `expires_at` = fin du
   seminaire, `purge_at` = suppression reelle des fichiers (7 jours apres).

## Modele de donnees

    spaces ──< participants        (user_id = auth.uid() anonyme, pseudo)
       └───< projects ──< files ──< comments

- Un espace regroupe tout et sert d'unite de purge.
- Une **version** est un `files`, pas une table a part : `version_no` est
  attribue par trigger, sous verrou par projet.
- `files.space_id` et `comments.space_id` sont denormalises : sans eux, chaque
  policy ferait une jointure par ligne.
- `files.peaks` (jsonb, ~2 Ko) est calcule une seule fois a l'upload. C'est ce
  qui rend la waveform instantanee : on ne retelecharge jamais l'audio pour la
  dessiner.

## Securite

Auth anonyme => chaque appareil a un `auth.uid()` stable, mais aucun acces tant
qu'il n'est pas passe par `join_space(code, pseudo)`. Toutes les policies se
resument a `is_member(space_id)`, et on ne modifie/supprime que ce qu'on a
poste. Le role `anon` (avant login) n'a aucun droit.

Un lien qui fuite hors du groupe ne donne rien sans le code.

## Storage

Bucket prive `seminar`, chemin `spaces/<space_id>/<project_id>/<file_id>.<ext>`.
Lecture par URL signee. Upload en TUS resumable (reprise quand la 4G lache au
milieu d'un WAV de 400 Mo).

## Purge

`purge_at` depasse => l'Edge Function `purge-spaces` (cron quotidien) supprime
d'abord les objets Storage, puis la ligne `spaces` qui fait tomber le reste en
cascade. Le `on delete cascade` SQL ne touche pas les fichiers : l'ordre compte.
