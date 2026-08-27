-- Esquema EnseñAI v22 — correr en el SQL Editor de Supabase (después de v1-v21)
-- Reestructura de precios: reemplaza el freemium + créditos sueltos +
-- founder pricing (schema_v20, schema_v21) por 3 planes claros — decisión
-- final de Claudia (26 de agosto):
--
--   Gratis      — 2 temas/mes, 1 perfil (individual). Sin cambio para grupo
--                 (sigue el mecanismo ya existente de "primer tema gratis
--                 por grupo"), limitado a 1 grupo.
--   Aprendemos  — $79/mes individual (20 temas/mes, hasta 3 perfiles),
--                 $109/mes grupo (20 temas-grupo/mes, hasta 3 grupos).
--   Ilimitado   — $129/mes individual (temas ilimitados, hasta 6 perfiles),
--                 $159/mes grupo (temas-grupo ilimitados, hasta 6 grupos).
--
-- Nota: los precios de Aprendemos/Ilimitado se muestran de lanzamiento
-- (Claudia los definió pensando en ~40% menos que el precio "real" al que
-- podrían subir más adelante si el piloto valida demanda) — por ahora son
-- el precio que se cobra, sin una fecha de corte ni un precio "regular"
-- paralelo; se ajustan manualmente en esta misma tabla el día que se
-- decida subirlos.

-- ── Planes: precios y límites (editables sin tocar código) ──────────────
alter table platform_settings
  add column if not exists plan_gratis_limite_temas_individual int not null default 2,
  add column if not exists plan_gratis_limite_perfiles int not null default 1,
  add column if not exists plan_gratis_limite_grupos int not null default 1,

  add column if not exists plan_individual_aprendemos_precio_mxn numeric not null default 79,
  add column if not exists plan_individual_aprendemos_limite_temas int not null default 20,
  add column if not exists plan_individual_aprendemos_limite_perfiles int not null default 3,

  add column if not exists plan_individual_ilimitado_precio_mxn numeric not null default 129,
  add column if not exists plan_individual_ilimitado_limite_perfiles int not null default 6,

  add column if not exists plan_grupo_aprendemos_precio_mxn numeric not null default 109,
  add column if not exists plan_grupo_aprendemos_limite_temas int not null default 20,
  add column if not exists plan_grupo_aprendemos_limite_grupos int not null default 3,

  add column if not exists plan_grupo_ilimitado_precio_mxn numeric not null default 159,
  add column if not exists plan_grupo_ilimitado_limite_grupos int not null default 6;

-- ── Suscripciones: nuevo nivel (aprendemos/ilimitado) ───────────────────
alter table suscripciones
  add column if not exists nivel text check (nivel in ('aprendemos', 'ilimitado'));

-- ── Perfiles de aprendizaje: de "1 por cuenta" a "varios con nombre" ────
-- (ej. un papá con un perfil por cada hijo). Quita el límite de 1 perfil
-- por cuenta y le pone nombre a cada uno.
alter table perfiles_aprendizaje drop constraint if exists perfiles_aprendizaje_user_id_key;
alter table perfiles_aprendizaje add column if not exists nombre text not null default 'Yo';

-- ── mis_temas: origen ahora refleja el plan que cubrió la generación ────
alter table mis_temas drop constraint if exists mis_temas_origen_check;
alter table mis_temas add constraint mis_temas_origen_check check (origen in ('gratis', 'aprendemos', 'ilimitado'));

-- Nota: las columnas de schema_v20/v21 (fecha_cierre_promo_lanzamiento,
-- temas_gratis_ventana_lanzamiento, temas_gratis_normal, precio_tema_suelto_mxn,
-- suscripcion_individual_mensual_founder_mxn, suscripcion_grupo_mensual_founder_mxn,
-- suscripcion_individual_mensual_mxn, suscripcion_individual_anual_mxn,
-- suscripcion_grupo_mensual_mxn) quedan en la tabla sin usarse — no se
-- borran por seguridad, pero el código ya no las lee.
