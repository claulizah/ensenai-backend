-- Esquema EnseñAI v19 — correr en el SQL Editor de Supabase (después de v1-v18)
-- Historial de temas generados en modo individual (papás/adolescentes/
-- adultos generando para sí mismos) — ver plan-pivote-lanzamiento.md,
-- paso 6 del flujo ("Historial 'mis temas generados' — para volver a ver/
-- reimprimir sin gastar de nuevo"). Los temas de grupo YA tienen su propio
-- historial vía grupo_temas (schema_v15) — esta tabla es solo para el uso
-- individual, que no pasa por ningún grupo.

create table if not exists mis_temas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  tema text not null,
  nivel text not null,
  perfil_usado jsonb,
  contenido jsonb not null,
  pdf_url text,
  created_at timestamptz default now()
);

create index if not exists mis_temas_user_id_idx on mis_temas(user_id);
