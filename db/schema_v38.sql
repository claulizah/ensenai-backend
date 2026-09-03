-- Esquema EnseñAI v38 — correr en el SQL Editor de Supabase (después de v1-v37)
--
-- "¿Podría tener un admin donde pueda ir subiendo plantillas que haga, svg
-- y demás recursos?" (pedido de la usuaria, 2-sep-2026)
--
-- Dos cosas distintas se guardan aquí, y conviene no confundirlas:
--
--   1. ILUSTRACIONES (icon_library) — se enganchan SOLAS a un tema por
--      palabras clave (ver utils/iconMatcher.js). El maestro nunca las pide:
--      aparecen dentro del material cuando el tema las amerita. Sistema
--      solar, fases de la Luna, caras de emociones, célula, etc.
--
--   2. PLANTILLAS (tabla nueva) — el maestro las busca y las descarga tal
--      cual, sin que dependan de ningún tema generado. Formatos, fichas,
--      planeaciones, hojas de trabajo.
--
-- La tabla icon_library ya existía desde v5, pero de la época del
-- marketplace de videos: su `categoria` solo aceptaba seis valores
-- ('numeros','formas','colores','animales','naturaleza','otros') que no
-- cubren ni emociones ni cuerpo humano ni México. Aquí se amplía y se le
-- agregan las columnas que hacían falta para poder respetar licencias
-- (Wikimedia pide atribución archivo por archivo) y para poder BORRAR el
-- archivo del Storage, no solo la fila.
--
-- Es idempotente: se puede correr dos veces sin romper nada.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Bucket público donde viven los archivos
-- ─────────────────────────────────────────────────────────────────────────
-- Público a propósito: son ilustraciones y plantillas que se muestran en la
-- liga del alumno (g.html), que NO tiene sesión. Nada privado vive aquí.
insert into storage.buckets (id, name, public)
values ('biblioteca', 'biblioteca', true)
on conflict (id) do update set public = true;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. icon_library: ampliar categorías y agregar columnas de licencia
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists icon_library (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  nombre text not null,
  palabras_clave text[] not null,
  image_url text not null,
  created_at timestamptz default now()
);

-- El check viejo de v5 se cambia por la lista nueva. Se borra primero por
-- si la tabla ya existe con la restricción anterior.
alter table icon_library drop constraint if exists icon_library_categoria_check;

-- OJO: si ya hay filas de la época del marketplace, sus categorías viejas
-- ('animales', 'numeros'...) no existen en la lista nueva y el check de
-- abajo fallaría. Se traducen primero, y cualquier valor que no reconozcamos
-- cae en 'otros' en vez de tumbar la migración.
update icon_library set categoria = case categoria
  when 'numeros'    then 'matematicas'
  when 'formas'     then 'matematicas'
  when 'colores'    then 'otros'
  when 'animales'   then 'cuerpo_vida'
  when 'naturaleza' then 'tierra_espacio'
  else categoria
end
where categoria in ('numeros', 'formas', 'colores', 'animales', 'naturaleza');

update icon_library set categoria = 'otros'
where categoria not in (
  'emociones','cuerpo_vida','tierra_espacio','matematicas','mexico','lenguaje','convivencia','otros'
);
alter table icon_library
  add constraint icon_library_categoria_check
  check (categoria in (
    'emociones',        -- caras, termómetro, semáforo de conducta
    'cuerpo_vida',      -- célula, aparatos, ciclos de vida, plantas
    'tierra_espacio',   -- sistema solar, Luna, ciclo del agua, materia
    'matematicas',      -- figuras, fracciones, recta numérica, reloj
    'mexico',           -- mapas, líneas del tiempo, geografía
    'lenguaje',         -- cuento, abecedario, gramática
    'convivencia',      -- reglas, turnos, acuerdos
    'otros'
  ));

-- storage_path hace falta para poder borrar el archivo junto con la fila:
-- con solo la URL pública habría que reconstruir la ruta a mano.
alter table icon_library add column if not exists storage_path text;
alter table icon_library add column if not exists tipo_mime text;
alter table icon_library add column if not exists tamano_bytes integer;
alter table icon_library add column if not exists descripcion text;

-- Atribución: Wikimedia Commons licencia archivo por archivo y muchos de
-- sus archivos PIDEN crédito. Guardarlo aquí, junto a la imagen, es la
-- única forma de no perderlo cuando la biblioteca crezca.
alter table icon_library add column if not exists licencia text;
alter table icon_library add column if not exists autor text;
alter table icon_library add column if not exists fuente_url text;

alter table icon_library add column if not exists activa boolean not null default true;
alter table icon_library add column if not exists actualizada_en timestamptz default now();

create index if not exists idx_icon_library_categoria on icon_library(categoria);
create index if not exists idx_icon_library_activa on icon_library(activa);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. plantillas: los recursos que el maestro descarga directo
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  descripcion text,
  categoria text not null default 'otros',
  -- Para qué nivel sirve. null = sirve para cualquiera.
  nivel text,
  -- 'escolar' | 'psicoeducativo' | null (sirve para los dos). Mismo eje que
  -- el enfoque con el que se genera un tema (ver routes/temas.js).
  enfoque text,
  archivo_url text not null,
  storage_path text not null,
  tipo_mime text not null,
  tamano_bytes integer,
  -- Mientras esté en false solo la ve el admin: se puede subir un borrador
  -- sin que aparezca en el panel de los maestros.
  publicada boolean not null default false,
  descargas integer not null default 0,
  created_at timestamptz default now(),
  actualizada_en timestamptz default now()
);

create index if not exists idx_plantillas_publicada on plantillas(publicada);
create index if not exists idx_plantillas_categoria on plantillas(categoria);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. ilustraciones_faltantes: la lista de la siguiente tanda, sola
-- ─────────────────────────────────────────────────────────────────────────
-- Cada vez que se genera un tema y el matcher no encuentra ninguna
-- ilustración, se anota el tema aquí. En dos o tres semanas esto deja de
-- ser adivinanza: es una lista real, ordenada por cuánto se pide.
create table if not exists ilustraciones_faltantes (
  id uuid primary key default gen_random_uuid(),
  tema_normalizado text not null unique,
  tema_ejemplo text not null,
  nivel text,
  veces integer not null default 1,
  ultima_vez timestamptz default now(),
  -- Se marca cuando ya se subió una ilustración que lo cubre, para que la
  -- lista de pendientes no crezca para siempre.
  resuelta boolean not null default false
);

create index if not exists idx_faltantes_veces on ilustraciones_faltantes(resuelta, veces desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Todo lo de arriba lo escribe SOLO el backend con la service_role key
-- (que se salta RLS), y quien decide si alguien es admin es
-- middleware/admin.js contra ADMIN_EMAILS — no una columna que alguien
-- pueda prenderse solo. Así que aquí se prende RLS y se deja únicamente
-- lectura pública de lo que sí es público:
--   * ilustraciones activas y plantillas publicadas: las ve cualquiera,
--     incluida la liga del alumno que no tiene sesión.
--   * ilustraciones_faltantes: nadie desde el cliente.

alter table icon_library enable row level security;
alter table plantillas enable row level security;
alter table ilustraciones_faltantes enable row level security;

drop policy if exists "ilustraciones activas visibles" on icon_library;
create policy "ilustraciones activas visibles"
  on icon_library for select
  using (activa = true);

drop policy if exists "plantillas publicadas visibles" on plantillas;
create policy "plantillas publicadas visibles"
  on plantillas for select
  using (publicada = true);

-- ilustraciones_faltantes se queda sin ninguna policy: con RLS prendido y
-- cero policies, la anon key no lee ni escribe nada. Solo el backend.
