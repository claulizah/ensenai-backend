-- Esquema EnseñAI v45 — correr en el SQL Editor de Supabase (después de v1-v44)
--
-- Filtrar los imprimibles por edad (5-sep-2026).
--
-- Pedido de Claudia: "podríamos hacer filtros para identificar cada
-- plantilla para qué rango de edad y tema".
--
-- El tema ya se podía filtrar (`categoria`, con chips en la biblioteca).
-- La edad no: existía `nivel`, pero nunca se usó para filtrar y además NO
-- ALCANZA. Sus propios cuadernillos dicen cosas como "4 a 10 años" en la
-- portada, y eso cruza tres niveles distintos. Un solo `nivel` obliga a
-- escoger uno y mentir en los otros dos.
--
-- Por eso se guarda un RANGO de verdad. Una plantilla aparece cuando el
-- rango que pide la persona se cruza con el suyo, no cuando coincide
-- exacto: si busco material para un niño de 5 y la hoja dice "4 a 10",
-- me sirve.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table plantillas
  add column if not exists edad_min smallint,
  add column if not exists edad_max smallint;

-- Backfill de las 266 que ya están subidas, a partir del nivel que ya
-- traen. Es aproximado pero deja todo filtrable desde el primer día; las
-- que quieras afinar se editan después una por una en el admin.
-- Solo toca las que están vacías: si alguna ya tiene edad puesta a mano,
-- no se pisa.
update plantillas set edad_min = 3, edad_max = 5
  where nivel = 'preescolar' and edad_min is null;
update plantillas set edad_min = 6, edad_max = 8
  where nivel = 'primaria_baja' and edad_min is null;
update plantillas set edad_min = 9, edad_max = 12
  where nivel = 'primaria_alta' and edad_min is null;
update plantillas set edad_min = 12, edad_max = 15
  where nivel = 'secundaria' and edad_min is null;
update plantillas set edad_min = 15, edad_max = 18
  where nivel = 'preparatoria' and edad_min is null;
update plantillas set edad_min = 18, edad_max = 99
  where nivel = 'universidad' and edad_min is null;

-- Las que no tienen nivel se quedan sin edad a propósito: significan
-- "sirve para cualquiera" y así salen en todos los filtros (ver la
-- consulta de routes/recursos.js, que trata null como comodín).

create index if not exists idx_plantillas_edad on plantillas(edad_min, edad_max);

select
  count(*) as plantillas,
  count(edad_min) as con_edad,
  count(*) filter (where edad_min is null) as sirven_para_cualquier_edad
from plantillas;
