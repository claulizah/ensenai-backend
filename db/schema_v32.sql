-- Esquema EnseñAI v32 — correr en el SQL Editor de Supabase (después de v1-v31)
--
-- Seguimiento de progreso/dominio para modo individual (31-ago-2026): el
-- diferencial que se decidió construir después de comparar "qué puede dar
-- EnseñAI que no dé simplemente preguntarle a un chat suelto" — memoria de
-- sesiones anteriores. Hasta ahora la trivia de un tema (tema.html) se
-- calificaba solo en el navegador y no dejaba ningún rastro; esta tabla es
-- el equivalente de respuestas_alumno (schema_v27, modo grupo) pero para
-- el historial individual autenticado — sin "nombre": ya sabemos quién es
-- por el usuario dueño del tema.

create table if not exists respuestas_trivia_individual (
  id uuid primary key default gen_random_uuid(),
  mis_tema_id uuid references mis_temas(id) on delete cascade not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- [{ pregunta, respuesta, respuesta_correcta, acerto (true/false/null) }]
  respuestas jsonb not null,
  aciertos integer not null default 0,
  total_cerradas integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists respuestas_trivia_individual_tema_idx
  on respuestas_trivia_individual(mis_tema_id);
create index if not exists respuestas_trivia_individual_user_idx
  on respuestas_trivia_individual(user_id);

-- Igual que el resto de tablas de datos de usuario de esta app: la toca
-- solo el backend con la service role key. Actívale Row Level Security
-- desde el dashboard sin agregar policies (deny-all para el anon key) si
-- quieres mantener el mismo patrón que mis_temas, respuestas_alumno, etc.
--
-- Nota de alcance: por CUENTA, no por perfil/hijo — mis_temas no guarda
-- con qué perfil se generó cada tema (ver utils/gamificacion.js para la
-- misma limitación en la racha). En una cuenta con varios hijos, GET
-- /api/temas/mi-progreso junta el progreso de todos.
