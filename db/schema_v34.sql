-- Esquema EnseñAI v34 — correr en el SQL Editor de Supabase (después de v1-v33)
--
-- Generación en segundo plano (sep-2026).
--
-- Hasta ahora, generar un tema era UNA petición HTTP que se quedaba abierta
-- 40-90 segundos mientras el modelo trabajaba. En celular eso se rompe solo:
-- si la persona bloquea la pantalla o se cambia de app, iOS/Android suspende
-- la pestaña, mata la conexión, y el material —que del otro lado sí se
-- generó y sí se guardó— nunca llega. La persona ve un error y cree que
-- perdió su tema del mes.
--
-- Con esta tabla la generación deja de vivir en la conexión: el POST solo
-- ENCOLA el trabajo y contesta al instante, el servidor genera por su
-- cuenta, y el celular pregunta cada pocos segundos "¿ya?" (ver
-- GET /api/temas/trabajos/:id). Bloquear la pantalla ya no cancela nada:
-- al volver, el frontend retoma el mismo trabajo y muestra el resultado.

create table if not exists trabajos_generacion (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Idempotencia: el frontend manda un id propio por cada intento. Si la
  -- petición se reintenta (red intermitente, doble tap), el segundo POST
  -- encuentra el trabajo ya creado en vez de encolar una generación —y un
  -- cobro— duplicada. Es el mismo problema que fetchConReintento intenta
  -- evitar a ciegas del lado del cliente; aquí queda resuelto de verdad.
  clave_cliente text,

  modo text not null default 'individual',      -- 'individual' | 'grupo'
  estado text not null default 'pendiente',     -- 'pendiente' | 'generando' | 'listo' | 'fallido'
  titulo text not null,                         -- el tema pedido, para poder avisar "X ya está listo"

  -- nivel, perfilId, etiquetas, detalles, enfoque. NO guarda las fotos:
  -- viajan en base64 y pesan megas; se quedan en memoria del proceso que
  -- atiende el trabajo (ver utils/trabajos.js). Si el servidor se reinicia
  -- a media generación, el barrido de zombis marca el trabajo como fallido
  -- en vez de dejar al celular preguntando para siempre.
  parametros jsonb not null default '{}'::jsonb,

  -- Respuesta completa que antes devolvía POST /api/temas/generar
  -- (contenido, tema_id, gamificacion, calidad…), tal cual, para que el
  -- frontend no tenga que armar nada distinto al recogerla.
  resultado jsonb,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Buscar "¿este usuario tiene algo corriendo?" y retomar el último trabajo
-- al volver a abrir la app.
create index if not exists trabajos_generacion_user_estado_idx
  on trabajos_generacion (user_id, estado, created_at desc);

-- Un mismo intento del cliente = un solo trabajo, siempre.
create unique index if not exists trabajos_generacion_clave_unica_idx
  on trabajos_generacion (user_id, clave_cliente)
  where clave_cliente is not null;

-- Igual que mis_temas, grupo_temas y las demás tablas de datos de usuario:
-- la toca solo el backend con la service role key. Actívale Row Level
-- Security desde el dashboard sin agregar policies (deny-all para el anon
-- key) para mantener el mismo patrón.
