-- Esquema EnseñAI v24 — correr en el SQL Editor de Supabase (después de v1-v23)
--
-- Tipo de usuario, preguntado una sola vez después de registrarse
-- ("¿quién eres?": papá/mamá, estudiante, maestro o profesional de la
-- educación, adulto que quiere aprender, otro).
--
-- Sirve para tres cosas:
--   1. Mandar a cada quien a la pantalla que le toca (generar tema
--      individual vs. panel de grupo) en vez de dejarlo adivinar.
--   2. Pedir la versión correcta del quiz de inteligencias — antes
--      tema.html siempre pedía `version=ninos`, donde el papá describe a
--      su hijo, aunque quien contestara fuera un adolescente o un adulto
--      aprendiendo por su cuenta.
--   3. Saber de qué tipo es cada usuario del piloto.
--
-- Tabla aparte (y no una columna en auth.users) porque ese esquema es de
-- Supabase Auth y no conviene tocarlo.

create table if not exists usuarios_ajustes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tipo_usuario text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table usuarios_ajustes drop constraint if exists usuarios_ajustes_tipo_check;
alter table usuarios_ajustes add constraint usuarios_ajustes_tipo_check
  check (tipo_usuario is null or tipo_usuario in ('papa', 'estudiante', 'educador', 'adulto', 'otro'));

-- ── Arreglo aparte, mismo archivo ───────────────────────────────────────
-- Borrar un usuario desde Authentication → Users fallaba con
-- "violates foreign key constraint mis_temas_user_id_fkey" porque sus
-- temas guardados lo bloqueaban. Con ON DELETE CASCADE, borrar la cuenta
-- borra también sus temas, que es el comportamiento esperado.
alter table mis_temas drop constraint if exists mis_temas_user_id_fkey;
alter table mis_temas add constraint mis_temas_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
