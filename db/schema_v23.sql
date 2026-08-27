-- Esquema EnseñAI v23 — correr en el SQL Editor de Supabase (después de v1-v22)
-- Etiquetas libres en "mis temas" (historial individual) para poder
-- buscarlos/filtrarlos más fácil — ej. "Matemáticas", "Parcial 1". Ver
-- plan-pivote-lanzamiento.md, sección de optimización de flujo (26 de agosto).

alter table mis_temas add column if not exists etiquetas text[] not null default '{}'::text[];

-- Índice GIN para que filtrar por etiqueta (contiene alguna de estas) sea
-- rápido incluso con muchos temas guardados.
create index if not exists mis_temas_etiquetas_idx on mis_temas using gin (etiquetas);
