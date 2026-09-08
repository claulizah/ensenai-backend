-- Esquema EnseñAI v47 — correr en el SQL Editor de Supabase (después de v1-v46)
--
-- Caché de material de tema ya generado y verificado (8-sep-2026), para
-- que dos maestros que piden el mismo tema de GRUPO (sin nota ni fotos
-- propias) no tengan que esperar otros 40-90s por algo que ya se generó
-- y ya se revisó — ver utils/cacheMaterialTema.js y utils/revisorCalidad.js
-- (verificarYCorregir). Es idempotente: se puede correr dos veces sin
-- romper nada.

create table if not exists material_tema_cache (
  -- Ej. "material_tema:grupo:estudio:9:fracciones equivalentes" — ver
  -- cómo se arma en utils/revisorCalidad.js (incluye modo y enfoque para
  -- que un tema escolar y uno psicoeducativo del mismo nombre no se
  -- mezclen, y un individual nunca choque con uno de grupo).
  clave text primary key,

  -- El mismo objeto { material, calidad } que regresa verificarYCorregir
  -- cuando el material sale verificado — tal cual, sin transformar, para
  -- que a quien lo pide le llegue exactamente lo mismo que si se hubiera
  -- generado de nuevo.
  contenido jsonb not null,

  veces_usado integer not null default 1,
  created_at timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);

-- Nadie necesita listar ni filtrar por fecha en el uso normal (siempre se
-- busca por `clave`, que ya es primary key), así que no hace falta un
-- índice aparte.

-- Igual que trabajos_generacion y las demás tablas que solo toca el
-- backend: actívale Row Level Security desde el dashboard sin agregar
-- policies (deny-all para el anon key) para mantener el mismo patrón.
