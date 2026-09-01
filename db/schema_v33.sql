-- Esquema EnseñAI v33 — correr en el SQL Editor de Supabase (después de v1-v32)
--
-- Checkbox ligero "ya la resolví" para la pestaña Practicar en modo
-- individual (31-ago-2026): la persona pensó que este checkbox (el mismo
-- que ya existe en el link público de grupo, g.html) también viviría en su
-- cuenta personal — tiene sentido: aunque aquí no haya un profe revisando,
-- sirve para que ella misma (o el papá/mamá) vea qué ejercicios ya se
-- resolvieron la próxima vez que abra el tema.
--
-- A diferencia de ejercicios_marcados_alumno (schema_v31, modo grupo, que
-- guarda un registro nuevo por cada "Guardar" porque el profe necesita ver
-- el historial de varios alumnos), aquí solo hay una persona por tema, así
-- que basta con UNA fila por tema que se sobrescribe (upsert) — por eso
-- mis_tema_id es unique.

create table if not exists ejercicios_resueltos_individual (
  id uuid primary key default gen_random_uuid(),
  mis_tema_id uuid references mis_temas(id) on delete cascade not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  indices_resueltos jsonb not null default '[]',
  total_ejercicios integer not null default 0,
  updated_at timestamptz default now()
);

create index if not exists ejercicios_resueltos_individual_user_idx
  on ejercicios_resueltos_individual(user_id);

-- Igual que el resto de tablas de datos de usuario de esta app: la toca
-- solo el backend con la service role key. Actívale Row Level Security
-- desde el dashboard sin agregar policies (deny-all para el anon key) si
-- quieres mantener el mismo patrón que mis_temas, respuestas_trivia_individual, etc.
