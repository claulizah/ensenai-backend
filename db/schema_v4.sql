-- Esquema EnseñAI v4 — correr en el SQL Editor de Supabase (después de v1, v2, v3)
-- Los compradores usan Supabase Auth (correo + contraseña) — no se crea
-- una tabla de "usuarios" aparte, se usa auth.users que Supabase ya trae.

-- ============================================================
-- Cada compra de un paquete de créditos genera un "lote". Se
-- consumen créditos de los lotes más viejos primero (FIFO), y
-- cada lote recuerda cuánto costó CADA crédito individualmente
-- — de ahí sale la comisión real del creador al canjear.
-- ============================================================
create table if not exists credit_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  credit_pack_id uuid references credit_packs(id) not null,
  credits_total int not null,
  credits_remaining int not null,
  price_paid_mxn numeric not null,
  price_per_credit_mxn numeric not null,
  stripe_checkout_session_id text,
  stripe_payment_status text default 'pendiente' check (stripe_payment_status in ('pendiente', 'pagado', 'fallido')),
  purchased_at timestamptz default now()
);

-- ============================================================
-- Cada vez que se canjea 1 crédito por un curso, queda un registro
-- aquí — con la comisión ya calculada y "congelada" (30% plataforma
-- / 70% creador, sobre el precio real de ESE crédito, no sobre el
-- precio de lista del curso).
-- ============================================================
create table if not exists course_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  course_id uuid references courses(id) not null,
  credit_batch_id uuid references credit_batches(id) not null,
  price_per_credit_mxn numeric not null,
  platform_commission_mxn numeric not null,
  creator_earnings_mxn numeric not null,
  purchased_at timestamptz default now(),
  unique (user_id, course_id) -- evita comprar el mismo curso dos veces
);

-- porcentaje de comisión, editable desde Supabase sin tocar código
alter table platform_settings add column if not exists platform_commission_pct numeric not null default 30;

update platform_settings set platform_commission_pct = 30 where id = 1;
