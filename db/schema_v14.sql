-- Esquema EnseñAI v14 — correr en el SQL Editor de Supabase (después de v1-v13)
-- Quiz de inteligencias múltiples v2: ahora guarda porcentaje por categoría,
-- no solo el/los tipo(s) dominante(s).

alter table perfiles_aprendizaje add column if not exists porcentajes jsonb;
