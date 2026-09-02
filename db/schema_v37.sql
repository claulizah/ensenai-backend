-- Esquema EnseñAI v37 — correr en el SQL Editor de Supabase (después de v1-v36)
--
-- "¿Podríamos implementar racha para los alumnos? Que los maestros puedan
-- dejarles un tema, trivia, ejercicios y que los alumnos la sigan; el
-- maestro puede revisarla." (pedido de la usuaria, 2-sep-2026)
--
-- El problema de fondo: los alumnos entran por la liga SIN CUENTA — solo
-- escriben su nombre. No hay user_id con el cual llevarles una racha, y el
-- nombre no sirve como identidad (dos "Ana", o alguien que se escribe
-- distinto cada vez). Así que la identidad la pone el NAVEGADOR del alumno:
-- g.html genera un id aleatorio la primera vez y lo guarda en localStorage
-- junto al nombre que ya guardaba.
--
-- Lo que eso implica, y hay que tenerlo claro antes de prometer nada:
--   * Un alumno que entra desde otro aparato (o borra datos del navegador)
--     empieza una racha nueva. Es un gancho de constancia, no un registro
--     de asistencia — y así se le habla en pantalla.
--   * El id NO identifica a una persona por sí solo: no trae correo, ni
--     dispositivo, ni nada del alumno. Solo sirve para juntar sus visitas
--     dentro de UN grupo.
--   * En grupos anónimos (mostrar_nombres = false, pensados para consulta
--     psicológica) el nombre se queda en null igual que en accesos_alumno;
--     el maestro ve "Anónimo 1", "Anónimo 2".
--
-- Cuenta como día activo del alumno: contestar la trivia de un tema o
-- marcar ejercicios como resueltos. Entrar a mirar NO cuenta — si contara,
-- la racha no significaría nada.
--
-- Idempotente: se puede correr dos veces sin romper nada.

create table if not exists rachas_alumno (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references grupos(id) on delete cascade not null,
  -- Id que vive en el localStorage del alumno (ver g.html). Texto y no uuid
  -- a propósito: lo genera el navegador y no queremos que un valor raro
  -- tumbe la petición del alumno con un error de tipo.
  alumno_id text not null,
  nombre text,
  racha_actual integer not null default 0,
  racha_record integer not null default 0,
  dias_activos integer not null default 0,
  ultimo_dia date,
  created_at timestamptz default now(),
  unique (grupo_id, alumno_id)
);

create index if not exists rachas_alumno_grupo_idx on rachas_alumno(grupo_id);

-- Igual que el resto de tablas de datos de esta app: la toca solo el backend
-- con la service role key. Actívale Row Level Security desde el dashboard sin
-- agregar policies (deny-all para el anon key), como mis_temas, grupo_temas,
-- respuestas_alumno, etc.
