-- Esquema EnseñAI v16 — correr en el SQL Editor de Supabase (después de v1-v15)
-- Suscripciones recurrentes (Stripe) — antes solo existían pagos únicos.

create table if not exists suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  tipo text not null check (tipo in ('individual', 'grupo')),
  plan text not null check (plan in ('mensual', 'anual')),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null default 'activa' check (status in ('activa', 'cancelada', 'pago_fallido')),
  current_period_end timestamptz,
  created_at timestamptz default now()
);

-- Precios de suscripción, editables sin tocar código (igual que
-- individual_course_price_mxn ya existente en esta misma tabla).
alter table platform_settings add column if not exists suscripcion_individual_mensual_mxn numeric default 149;
-- cobro ANUAL total (una sola exhibición al año) — equivale a $120 MXN/mes
alter table platform_settings add column if not exists suscripcion_individual_anual_mxn numeric default 1440;
-- suscripción del profesional para su grupo (temas ilimitados mientras esté activa)
alter table platform_settings add column if not exists suscripcion_grupo_mensual_mxn numeric default 299;
