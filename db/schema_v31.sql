-- Esquema EnseñAI v31 — correr en el SQL Editor de Supabase (después de v1-v30)
--
-- "Checkbox ligero" de ejercicios resueltos (31-ago-2026): antes de invertir
-- en guardar fotos de los ejercicios (que sí necesitaría un bucket de
-- Storage), probamos si a los maestros/psicólogos les basta con saber QUÉ
-- ejercicios marcó como resueltos cada alumno/paciente en la liga pública
-- (g.html) — sin fotos, sin Storage, mismo patrón que respuestas_alumno
-- (schema_v27) pero para la pestaña "Practicar" en vez de la trivia.
--
-- Privacidad: "nombre" aquí sigue la misma regla que respuestas_alumno —
-- como máximo el PRIMER nombre o un apodo (ver utils/nombre.js), y puede
-- venir null en grupos anónimos (mostrar_nombres = false).

create table if not exists ejercicios_marcados_alumno (
  id uuid primary key default gen_random_uuid(),
  grupo_tema_id uuid references grupo_temas(id) not null,
  nombre text,
  -- índices (dentro del arreglo "ejercicios" del tema) que la persona marcó
  -- como resueltos en ese envío — ej. [0, 1, 3]
  indices_resueltos jsonb not null default '[]'::jsonb,
  total_ejercicios integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists ejercicios_marcados_alumno_tema_idx
  on ejercicios_marcados_alumno(grupo_tema_id);

-- Igual que respuestas_alumno: cada "Guardar mi progreso" en g.html inserta
-- un registro nuevo (no hay cuenta de alumno con la que hacer upsert), así
-- que si alguien guarda dos veces, el profesional ve ambos envíos — se queda
-- con el más reciente por nombre al leer la lista (ver GET .../ejercicios-marcados).
