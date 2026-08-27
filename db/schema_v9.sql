-- Esquema EnseñAI v9 — correr en el SQL Editor de Supabase (después de v1-v8)

alter table creators add column if not exists curp text;
