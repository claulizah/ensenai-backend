-- Esquema EnseñAI v12 — correr en el SQL Editor de Supabase (después de v1-v11)
-- Quiz de inteligencias múltiples — 1 resultado por cuenta de comprador
-- por ahora (no soporta varios hijos por cuenta todavía).

create table if not exists perfiles_aprendizaje (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null unique,
  inteligencia_dominante text[] not null, -- puede haber empate entre 2+ tipos
  respuestas jsonb not null,
  fecha timestamptz default now()
);
