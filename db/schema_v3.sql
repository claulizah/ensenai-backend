-- Esquema EnseñAI v3 — correr en el SQL Editor de Supabase (después de v1 y v2)
-- Seguro de re-ejecutar.

-- ============================================================
-- Configuración de precios de la plataforma (editable directo
-- desde la tabla en Supabase, sin tocar código).
-- ============================================================
create table if not exists platform_settings (
  id int primary key default 1,
  individual_course_price_mxn numeric not null default 29.90,
  constraint solo_una_fila check (id = 1)
);

insert into platform_settings (id, individual_course_price_mxn)
values (1, 29.90)
on conflict (id) do nothing;

-- ============================================================
-- Paquetes de créditos que un usuario final puede comprar
-- (canjeables contra cualquier curso individual).
-- ============================================================
create table if not exists credit_packs (
  id uuid primary key default gen_random_uuid(),
  credits int not null,
  price_mxn numeric not null,
  label text not null,
  active boolean default true,
  created_at timestamptz default now()
);

insert into credit_packs (credits, price_mxn, label)
select * from (values
  (1, 29.90, '1 curso'),
  (10, 199.90, '10 cursos'),
  (20, 349.90, '20 cursos')
) as v(credits, price_mxn, label)
where not exists (select 1 from credit_packs);

-- ============================================================
-- Paquetes temáticos armados por el creador (ej. "Matemáticas
-- básicas 1er grado"), con precio libre definido por el creador.
-- ============================================================
create table if not exists bundles (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references creators(id) not null,
  title text not null,
  price_mxn numeric not null,
  slug text unique,
  status text default 'borrador' check (status in ('borrador', 'publicado')),
  created_at timestamptz default now(),
  published_at timestamptz
);

create table if not exists bundle_courses (
  bundle_id uuid references bundles(id) not null,
  course_id uuid references courses(id) not null,
  primary key (bundle_id, course_id)
);
