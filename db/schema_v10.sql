-- Esquema EnseñAI v10 — correr en el SQL Editor de Supabase (después de v1-v9)

alter table creators add column if not exists quiz_reglas_aprobado boolean default false;
alter table creators add column if not exists quiz_reglas_puntaje int;
alter table creators add column if not exists quiz_reglas_fecha timestamptz;
