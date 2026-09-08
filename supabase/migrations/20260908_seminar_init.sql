-- Seminaire : schema de base (types, tables, index)
-- Un "espace" = un seminaire. Tout est rattache a un espace et purge avec lui.

create type file_kind   as enum ('instru','voix','freestyle','mix','stems','autre');
create type file_status as enum ('uploading','ready','failed');

-- ---------------------------------------------------------------- espaces
create table spaces (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9]{5,8}$'),
  name           text not null check (char_length(name) between 1 and 60),
  is_locked      boolean not null default false,
  expires_at     timestamptz not null,
  purge_at       timestamptz not null,
  max_file_bytes bigint not null default 3221225472,
  created_at     timestamptz not null default now(),
  check (purge_at >= expires_at)
);

-- ----------------------------------------------------------- participants
create table participants (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references spaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  pseudo       text not null check (char_length(trim(pseudo)) between 2 and 24),
  is_host      boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (space_id, user_id)
);
create unique index participants_pseudo_uniq on participants (space_id, lower(pseudo));
create index participants_user on participants (user_id);

-- ---------------------------------------------------- projets (morceaux)
create table projects (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references spaces(id) on delete cascade,
  title            text not null check (char_length(trim(title)) between 1 and 80),
  notes            text check (char_length(notes) <= 2000),
  bpm              int  check (bpm between 40 and 300),
  musical_key      text check (char_length(musical_key) <= 8),
  created_by       uuid references participants(id) on delete set null,
  archived         boolean not null default false,
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index projects_space_activity on projects (space_id, archived, last_activity_at desc);

-- ------------------------------------------ fichiers = versions d'un projet
create table files (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(id) on delete cascade,
  project_id    uuid not null references projects(id) on delete cascade,
  uploaded_by   uuid references participants(id) on delete set null,
  version_no    int  not null,
  label         text check (char_length(label) <= 40),
  kind          file_kind   not null default 'autre',
  status        file_status not null default 'uploading',
  storage_path  text not null unique,
  original_name text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0),
  duration_sec  numeric(10,2),
  bpm           int check (bpm between 40 and 300),
  musical_key   text check (char_length(musical_key) <= 8),
  peaks         jsonb,
  created_at    timestamptz not null default now(),
  unique (project_id, version_no)
);
create index files_project_version on files (project_id, version_no desc);
create index files_space_recent    on files (space_id, created_at desc);

-- ------------------------------------------------------- commentaires
-- at_ms null = commentaire general ; sinon ancre sur la waveform
-- Suppression franche (pas de soft-delete) : le realtime propage le DELETE.
create table comments (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references spaces(id) on delete cascade,
  file_id    uuid not null references files(id) on delete cascade,
  author_id  uuid references participants(id) on delete set null,
  body       text not null check (char_length(trim(body)) between 1 and 1000),
  at_ms      int check (at_ms >= 0),
  created_at timestamptz not null default now()
);
create index comments_file on comments (file_id, at_ms nulls first, created_at);
