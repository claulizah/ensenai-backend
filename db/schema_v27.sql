-- Esquema EnseñAI v27 — correr en el SQL Editor de Supabase (después de v1-v26)
-- Guarda el detalle de las respuestas de trivia que los alumnos/pacientes dan
-- en la liga pública de grupo (g.html), para que el profesional pueda ver no
-- solo que alguien entró (eso ya lo cubre accesos_alumno), sino QUÉ contestó
-- cada quien — pensado para que el maestro/psicólogo detecte en qué está
-- fallando el grupo, no solo un puntaje global.
--
-- Privacidad: "nombre" aquí siempre es como máximo el PRIMER nombre o un
-- apodo (nunca apellido ni otro dato) — ver utils/nombre.js. Esto aplica
-- igual en grupos con mostrar_nombres = false (modo anónimo para
-- psicólogos con pacientes): ahí dar el nombre es OPCIONAL en g.html, así
-- que puede venir null (lo omitió) o un primer nombre/apodo (lo dio,
-- voluntariamente, sabiendo que solo sirve para distinguir sus respuestas).

create table if not exists respuestas_alumno (
  id uuid primary key default gen_random_uuid(),
  grupo_tema_id uuid references grupo_temas(id) not null,
  -- máximo el primer nombre/apodo; null si no se dio (opcional en grupos anónimos)
  nombre text,
  -- [{ pregunta, respuesta, respuesta_correcta, acerto (true/false/null —
  --   null para preguntas de respuesta abierta, que no se autocalifican) }]
  respuestas jsonb not null,
  aciertos integer not null default 0,
  total_cerradas integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists respuestas_alumno_tema_idx
  on respuestas_alumno(grupo_tema_id);
