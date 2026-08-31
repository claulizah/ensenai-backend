-- Esquema EnseñAI v30 — correr en el SQL Editor de Supabase (después de v1-v29)
--
-- Dos ganchos de crecimiento (ago-2026):
--  1) "Boost" de bienvenida: cuentas Gratis nuevas generan más temas, pero
--     SOLO durante el mes calendario en que se registraron (ver
--     resolverAccesoIndividual en routes/temas.js).
--  2) Programa de referidos: cada usuario tiene un código propio para
--     compartir; cada vez que alguien nuevo lo canjea, quien invitó gana
--     +1 tema de regalo que no caduca (ver utils/referidos.js). Quien se
--     une con el código no gana nada aparte del boost de arriba — no hay
--     recompensa doble.

alter table platform_settings
  add column if not exists plan_gratis_boost_limite_temas int not null default 3;

alter table usuarios_ajustes
  add column if not exists codigo_referido text unique,
  add column if not exists bono_temas_disponibles int not null default 0;

create table if not exists referidos_canjeados (
  id uuid primary key default gen_random_uuid(),
  codigo text not null,
  user_id_referidor uuid not null references auth.users(id) on delete cascade,
  user_id_referido uuid not null references auth.users(id) on delete cascade unique, -- una cuenta solo canjea un código, nunca
  created_at timestamptz not null default now()
);

-- Igual que las demás tablas de datos de usuario de esta app: la toca solo
-- el backend con la service role key. Actívale Row Level Security desde
-- el dashboard sin agregar policies (deny-all para el anon key) si quieres
-- mantener el mismo patrón que mis_temas, grupo_temas, etc.
