-- Esquema EnseñAI v40 — correr en el SQL Editor de Supabase (después de v1-v39)
--
-- Candado por plan para las plantillas (3-sep-2026).
--
-- El problema que arregla: hasta v39, CUALQUIER cuenta con sesión (incluida
-- una Gratis) podía descargar toda la biblioteca, y como el bucket
-- `biblioteca` es público, una liga compartida por WhatsApp abría el PDF
-- hasta sin cuenta. O sea, el mejor argumento para vender el plan Ilimitado
-- estaba regalado.
--
-- Cómo queda:
--   * Las PLANTILLAS se mudan a un bucket PRIVADO. Ya no hay URL pública:
--     el backend firma una liga que dura unos minutos, después de revisar
--     el plan (ver GET /api/recursos/plantillas/:id/descargar).
--   * Las ILUSTRACIONES se quedan en el bucket público `biblioteca` a
--     propósito: esas se pintan dentro del material del alumno en g.html,
--     que NO tiene sesión, y además se incrustan en el PDF. No son el
--     producto que se vende, son parte del material.
--   * El catálogo se sigue viendo COMPLETO para todos, con su nombre y su
--     descripción: se ve lo que hay, se topa al descargar. Nadie compra lo
--     que no sabe que existe.
--
-- Idempotente: se puede correr dos veces sin romper nada.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Bucket privado de plantillas
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('plantillas', 'plantillas', false)
on conflict (id) do update set public = false;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Cuántas descargas trae cada plan
-- ─────────────────────────────────────────────────────────────────────────
-- Viven en platform_settings para poder aflojarlos o apretarlos sin volver
-- a desplegar. null en el de Ilimitado significa sin límite.
alter table platform_settings
  add column if not exists plantillas_limite_gratis int not null default 3,
  add column if not exists plantillas_limite_esencial int not null default 30;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Qué descargó cada quien este mes
-- ─────────────────────────────────────────────────────────────────────────
-- Se cuenta por (usuario, plantilla, mes) a propósito: volver a bajar la
-- MISMA hoja en el mismo mes no gasta cupo. Si alguien perdió el archivo o
-- se le fue la impresión, que la vuelva a bajar sin castigo — el límite es
-- para acotar cuánto se lleva del catálogo, no para cobrar por reimprimir.
create table if not exists descargas_plantillas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plantilla_id uuid not null references plantillas(id) on delete cascade,
  -- 'YYYY-MM' del momento de la descarga, para contar el mes en curso sin
  -- hacer cuentas de fechas en cada consulta.
  mes text not null,
  creado_en timestamptz default now(),
  unique (user_id, plantilla_id, mes)
);

create index if not exists idx_descargas_plantillas_mes on descargas_plantillas(user_id, mes);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Solo el backend (service_role) escribe aquí. Con RLS prendido y cero
-- policies, la anon key no lee ni escribe nada — que es justo lo que
-- queremos: si el cliente pudiera borrar sus filas, borraría su límite.
alter table descargas_plantillas enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Comprobación
-- ─────────────────────────────────────────────────────────────────────────
select
  plantillas_limite_gratis,
  plantillas_limite_esencial,
  (select count(*) from descargas_plantillas) as descargas_registradas
from platform_settings where id = 1;
