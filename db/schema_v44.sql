-- Esquema EnseñAI v44 — correr en el SQL Editor de Supabase (después de v1-v43)
--
-- Ponerle techo al plan Ilimitado (5-sep-2026).
--
-- Viene de la revisión previa al lanzamiento. "Ilimitado" estaba
-- implementado literalmente: routes/temas.js devolvía permiso y ya, sin
-- ningún tope. La cuenta que lo vuelve un problema:
--
--   un tema cuesta ~$1 MXN de API   ·   Ilimitado cobra $99 al mes
--
-- Con eso, un solo usuario generando 3,000 temas en un mes deja $2,900 de
-- pérdida. Y no hace falta mala intención: basta una escuela compartiendo
-- una cuenta entre veinte maestros, o alguien probando un script.
--
-- Esto NO convierte Ilimitado en limitado. 300 temas al mes son diez
-- diarios, todos los días: nadie que lo use de verdad lo va a ver. Es un
-- seguro contra el caso raro, no una cuota comercial. Por eso vive en
-- platform_settings y no en el código — si algún día un cliente legítimo
-- lo toca, le subes el número sin desplegar nada.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table platform_settings
  -- Techo de uso justo para las suscripciones ilimitadas (individual).
  -- null = de verdad sin tope, por si algún día quieres quitarlo.
  add column if not exists tope_justo_temas_individual integer default 300,
  -- Lo mismo para los planes de grupo, que hoy tampoco tenían tope.
  add column if not exists tope_justo_temas_grupo integer default 500;

-- Si la fila ya existía sin estas columnas, se llenan con el valor por
-- omisión. Un null aquí significa "sin tope", así que no se puede dejar
-- el campo vacío por descuido.
update platform_settings
set tope_justo_temas_individual = 300
where id = 1 and tope_justo_temas_individual is null;

update platform_settings
set tope_justo_temas_grupo = 500
where id = 1 and tope_justo_temas_grupo is null;

select
  tope_justo_temas_individual as tope_individual,
  tope_justo_temas_grupo      as tope_grupo,
  plan_individual_aprendemos_precio_mxn as esencial,
  plan_individual_ilimitado_precio_mxn  as ilimitado
from platform_settings where id = 1;
