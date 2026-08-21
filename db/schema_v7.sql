-- Esquema EnseñAI v7 — correr en el SQL Editor de Supabase (después de v1-v6)
-- Perfil público del creador

alter table creators add column if not exists bio text;
