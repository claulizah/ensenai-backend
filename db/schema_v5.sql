-- Esquema EnseñAI v5 — correr en el SQL Editor de Supabase (después de v1-v4)
-- Biblioteca de íconos para contenido de niños 2-6 años (aún no leen,
-- necesitan material visual en vez de texto).

create table if not exists icon_library (
  id uuid primary key default gen_random_uuid(),
  categoria text not null check (categoria in ('numeros', 'formas', 'colores', 'animales', 'naturaleza', 'otros')),
  nombre text not null,                -- ej. "Gato", "Círculo azul"
  palabras_clave text[] not null,      -- ej. ARRAY['gato','felino','mascota'] — para relacionar con el tema del video
  image_url text not null,             -- URL pública del bucket icon-library
  created_at timestamptz default now()
);

-- índice para buscar rápido por categoría al armar el material de un curso
create index if not exists idx_icon_library_categoria on icon_library(categoria);
