-- Esquema EnseñAI v29 — correr en el SQL Editor de Supabase (después de v1-v28)
--
-- Gamificación (racha + medallas) y trivia diaria — el "gancho para volver"
-- del modo individual (papás/estudiantes/adultos generando para sí mismos).
-- No aplica al modo grupo/maestro: para un maestro el enganche real es ver
-- el avance de su grupo (ya existe, ver respuestas_alumno de schema_v27),
-- no una racha de generar contenido.
--
-- Una fila por usuario (no por perfil/hijo) porque mis_temas no guarda a
-- qué perfil pertenece cada tema, solo qué inteligencia se usó
-- (perfil_usado) — ver utils/gamificacion.js para el detalle de por qué.

create table if not exists gamificacion (
  user_id uuid primary key references auth.users(id) on delete cascade,
  racha_actual int not null default 0,
  racha_record int not null default 0,
  ultima_actividad date,
  medallas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Igual que las demás tablas de datos de usuario de esta app: la toca solo
-- el backend con la service role key (bypassa RLS), nunca el frontend
-- directo. Si quieres, actívale Row Level Security desde el dashboard de
-- Supabase sin agregar policies (deny-all para el anon key), como ya
-- confirmamos que está en mis_temas, grupo_temas, perfiles_aprendizaje,
-- suscripciones, grupos y platform_settings.

-- No hay tabla nueva para "trivia diaria": las preguntas se arman al vuelo
-- combinando la trivia que ya vive en mis_temas.contenido de cada usuario
-- (ver GET /api/temas/trivia-diaria) — no gasta cupo del plan porque no
-- llama a la IA, solo reutiliza lo que el usuario ya generó antes.
