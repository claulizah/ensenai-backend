-- Esquema EnseñAI v13 — correr en el SQL Editor de Supabase (después de v1-v12)

alter table courses add column if not exists icono_portada_url text;
