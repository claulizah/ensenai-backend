-- Esquema EnseñAI v15 — correr en el SQL Editor de Supabase (después de v1-v14)
-- Modelo de "liga de grupo" para maestros/psicólogos (ver modelo-liga-grupo.md
-- en el proyecto). Un profesional (cualquier cuenta de auth.users, no hace
-- falta el flujo de "creators") crea un grupo, comparte UNA liga persistente,
-- y ahí se acumulan los temas que comparte. Los alumnos/pacientes entran sin
-- cuenta ni pago individual.

create table if not exists grupos (
  id uuid primary key default gen_random_uuid(),
  profesional_id uuid references auth.users(id) not null,
  nombre text not null,
  slug text unique not null,
  -- si es false, accesos_alumno no debe pedir/guardar nombre (pensado para
  -- psicólogos con pacientes que prefieren anonimato)
  mostrar_nombres boolean default true,
  -- informativo, sin bloqueo duro en el MVP
  limite_alumnos integer default 40,
  created_at timestamptz default now()
);

create table if not exists grupo_temas (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references grupos(id) not null,
  titulo text not null,
  -- contenido generado: { explicacion, trivia, refuerzo, perfil_dominante }
  contenido jsonb not null,
  pago_status text not null default 'pendiente'
    check (pago_status in ('pendiente', 'pagado', 'cubierto_suscripcion', 'gratis_prueba')),
  stripe_session_id text,
  created_at timestamptz default now()
);

-- Solo se cuentan/muestran a los alumnos los temas con pago_status en
-- ('pagado','cubierto_suscripcion','gratis_prueba') — 'pendiente' significa
-- que el profesional generó el tema pero no lo ha pagado/activado todavía.

create table if not exists accesos_alumno (
  id uuid primary key default gen_random_uuid(),
  grupo_id uuid references grupos(id) not null,
  -- null si el grupo tiene mostrar_nombres = false (modo anónimo)
  nombre text,
  primer_acceso timestamptz default now()
);
