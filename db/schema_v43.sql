-- Esquema EnseñAI v43 — correr en el SQL Editor de Supabase (después de v1-v42)
--
-- Cuál ilustración mostrar cuando hay varias del mismo concepto
-- (5-sep-2026).
--
-- Pregunta de Claudia: "cuando hay más de una imagen ¿cómo podríamos elegir
-- cuál mostrar? sin necesidad de mostrar 3 o 4 en caso de que se vaya
-- mejorando".
--
-- El problema real no era el orden, era el EMPATE. utils/iconMatcher.js
-- puntúa por palabras clave, y tres versiones del sistema solar tienen las
-- mismas palabras clave: sacan el mismo puntaje. Pasaban dos cosas feas:
--
--   1. Se mostraban las tres juntas.
--   2. El desempate quedaba en manos del orden en que Postgres devolvía las
--      filas, así que el MISMO tema podía mostrar una lámina distinta cada
--      vez que se generaba. Nadie lo notó porque todavía no hay repetidas.
--
-- La solución vive casi toda en el código (agrupar por concepto y mostrar
-- una sola). Lo único que hace falta de la base es esta columna, para poder
-- decir a mano "entre estas dos, gana esta".
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table icon_library
  -- Más alto gana. 0 = sin opinión, que es lo normal: solo se toca cuando
  -- hay dos versiones de lo mismo y quieres mandar tú. Si todas están en 0,
  -- el desempate lo hace la fecha (gana la más reciente).
  add column if not exists prioridad integer not null default 0;

-- El matcher trae TODAS las filas y puntúa en memoria, así que este índice
-- no acelera la búsqueda; sirve para el panel de admin, que sí ordena por
-- prioridad para enseñarte primero las que marcaste.
create index if not exists idx_icon_library_prioridad
  on icon_library(prioridad desc, created_at desc);

select
  count(*) as ilustraciones,
  count(*) filter (where prioridad > 0) as con_prioridad,
  count(*) filter (where prioridad = 0) as sin_opinion
from icon_library;
