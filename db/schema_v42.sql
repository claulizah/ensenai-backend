-- Esquema EnseñAI v42 — correr en el SQL Editor de Supabase (después de v1-v41)
--
-- Lo mismo que v41 hizo con las plantillas, ahora para las ilustraciones
-- (5-sep-2026): huella del archivo para que no se suba dos veces la misma
-- imagen.
--
-- Aquí importa más que en plantillas. Una plantilla repetida se ve feo en
-- la biblioteca; una ilustración repetida se engancha DOS VECES al mismo
-- tema (utils/iconMatcher.js no sabe que son la misma) y el material sale
-- con el dibujo duplicado.
--
-- La huella se saca del archivo tal como llegó. Las ilustraciones no
-- llevan marca de agua — se pintan dentro del material, que ya lleva la
-- marca de EnseñAI — así que aquí no hay el problema de "el sello cambia
-- los bytes" que sí había en v41.
--
-- Idempotente: se puede correr dos veces sin romper nada.

alter table icon_library
  -- sha256 del archivo, en hexadecimal
  add column if not exists hash_archivo text;

create index if not exists idx_icon_library_hash on icon_library(hash_archivo);

-- Sin unique, por la misma razón que en v41: el chequeo vive en
-- routes/admin.js, que contesta 409 diciendo con qué nombre ya está, y las
-- ilustraciones subidas antes de esta migración no tienen huella.

select
  count(*) as ilustraciones,
  count(hash_archivo) as con_huella
from icon_library;
