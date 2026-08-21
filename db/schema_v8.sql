-- Esquema EnseñAI v8 — correr en el SQL Editor de Supabase (después de v1-v7)
-- Compra directa de paquetes temáticos (no usa el sistema de créditos,
-- el creador puso su propio precio para el paquete completo).

create table if not exists bundle_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  bundle_id uuid references bundles(id) not null,
  price_paid_mxn numeric not null,
  platform_commission_mxn numeric,
  creator_earnings_mxn numeric,
  stripe_checkout_session_id text,
  stripe_payment_status text default 'pendiente' check (stripe_payment_status in ('pendiente', 'pagado', 'fallido')),
  purchased_at timestamptz default now(),
  unique (user_id, bundle_id)
);

-- course_purchases ahora puede venir de un crédito individual O de un
-- paquete comprado — por eso credit_batch_id se vuelve opcional, y
-- agregamos la referencia al paquete cuando aplique. Así "mis-cursos"
-- y la revisión de acceso en curso.html funcionan igual sin importar
-- de dónde vino el acceso.
alter table course_purchases alter column credit_batch_id drop not null;
alter table course_purchases alter column price_per_credit_mxn drop not null;
alter table course_purchases add column if not exists bundle_purchase_id uuid references bundle_purchases(id);

alter table course_purchases drop constraint if exists origen_valido;
alter table course_purchases add constraint origen_valido
  check (credit_batch_id is not null or bundle_purchase_id is not null);
