-- Esquema EnseñAI v41 — correr en el SQL Editor de Supabase (después de v1-v40)
--
-- Que el admin no deje subir la misma hoja dos veces, y sepa cuáles ya
-- llevan marca de agua (4-sep-2026).
--
-- Viene de un problema real: de los 9 archivos que Claudia subió la primera
-- vez, solo 5 eran cuadernillos distintos — el mismo diseño exportado
-- varias veces. Con 230 hojas sueltas eso se vuelve imposible de cachar a
-- ojo, así que lo revisa el servidor: se guarda la huella (sha256) del
-- archivo tal como llegó, ANTES de ponerle la marca, para que dos subidas
-- del mismo archivo tengan la misma huella aunque el sello las haga
-- distintas byte a byte.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table plantillas
  -- sha256 del archivo original, en hexadecimal
  add column if not exists hash_archivo text,
  -- si el servidor le puso el sello de EnseñAI al subirla
  add column if not exists marcada boolean not null default false;

create index if not exists idx_plantillas_hash on plantillas(hash_archivo);

-- Nota: NO se pone unique. Un unique tumbaría la subida con un error feo de
-- base de datos; el chequeo vive en routes/admin.js, que contesta 409 con el
-- nombre de la plantilla que ya la tenía ("Ya está en la biblioteca como
-- Laberinto de la letra A"). Además, las plantillas que se subieron antes de
-- esta migración no tienen huella, y un unique sobre varios null en Postgres
-- sí se permite, pero un backfill a medias sería un campo minado.

select
  count(*) as plantillas,
  count(hash_archivo) as con_huella,
  count(*) filter (where marcada) as con_marca
from plantillas;
