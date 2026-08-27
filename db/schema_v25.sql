-- Esquema EnseñAI v25 — correr en el SQL Editor de Supabase (después de v1-v24)
--
-- Plan Gratis: de 1 a 3 perfiles de aprendizaje.
--
-- Motivo (review externo del 27 de agosto): con un solo perfil, un papá con
-- dos o tres hijos se topa con el límite en el PRIMER uso, antes de haber
-- visto funcionar el producto. Y como el diferenciador de EnseñAI es
-- justamente que el material cambia según cómo aprende cada quien, el plan
-- gratis impedía experimentar precisamente eso.
--
-- Los temas al mes NO cambian (siguen en 2): esa es la palanca de conversión.
-- Los perfiles no cuestan nada de generación — el quiz no llama a la IA —
-- así que subirlos no tiene costo marginal.

update platform_settings set plan_gratis_limite_perfiles = 3;

-- El default también sube, por si algún día se crea una fila nueva.
alter table platform_settings
  alter column plan_gratis_limite_perfiles set default 3;

-- Verificación rápida (debe regresar 3):
-- select plan_gratis_limite_perfiles from platform_settings;
