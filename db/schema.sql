-- Esquema EnseñAI v2 — correr en el SQL Editor de Supabase
-- Seguro de re-ejecutar: usa "if not exists" en tablas y columnas nuevas.

create table if not exists creators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  credential_verified boolean default false,
  created_at timestamptz default now()
);

-- liga propia del creador (parte del MVP: "liga (link) propia para cada creador")
alter table creators add column if not exists slug text unique;

create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators(id) not null,
  title text not null,
  audience text not null check (audience in ('ninos', 'padres', 'profesionales')),
  price_mxn numeric not null,
  video_url text,
  transcript text,
  status text default 'borrador' check (status in ('borrador', 'publicado')),
  created_at timestamptz default now()
);

-- liga pública del curso (ej. ensenai.com/c/mi-curso-de-fracciones)
alter table courses add column if not exists slug text unique;
-- fecha real de publicación, distinta de created_at (que es cuando se subió el video)
alter table courses add column if not exists published_at timestamptz;

create table if not exists course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references courses(id) not null,
  generation_mode text check (generation_mode in ('automatico', 'con_ayuda_tutor')),
  -- versión generada por la IA — nunca se sobreescribe, sirve de respaldo/auditoría
  resumen text,
  trivia jsonb,       -- solo para audiencia 'ninos'
  memorama jsonb,      -- solo para audiencia 'ninos'
  tips jsonb,          -- solo para audiencia 'padres' / 'profesionales'
  created_at timestamptz default now()
);

-- versión editada por el creador — si existe, esta es la que se publica;
-- si es null, se usa la versión generada de arriba tal cual.
alter table course_materials add column if not exists resumen_editado text;
alter table course_materials add column if not exists trivia_editado jsonb;
alter table course_materials add column if not exists memorama_editado jsonb;
alter table course_materials add column if not exists tips_editado jsonb;
alter table course_materials add column if not exists updated_at timestamptz default now();
