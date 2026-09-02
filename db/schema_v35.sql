-- Esquema EnseñAI v35 — correr en el SQL Editor de Supabase (después de v1-v34)
--
-- Botón de comentarios para el piloto (1-sep-2026): dos botones flotantes,
-- uno para "esto me gustó" y otro para "esto falló", en tema.html,
-- grupo.html y comprador.html. Lo que se escriba llega por correo a
-- Claudia (ver routes/feedback.js) y además queda aquí, porque el correo
-- se pierde entre la bandeja y esta tabla sí se puede ordenar y filtrar.
--
-- user_id es "on delete set null" a propósito: al cerrar el piloto se
-- borran cuentas (ver el SQL de limpieza), y sería absurdo perder los
-- comentarios junto con ellas. Por eso el correo se guarda también como
-- texto suelto: aunque la cuenta desaparezca, se sigue sabiendo quién lo
-- dijo y a quién contestarle.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  correo text,                                    -- copia; sobrevive al borrado de la cuenta
  tipo text not null check (tipo in ('bien', 'bug')),
  mensaje text not null,
  pagina text,                                    -- tema.html, grupo.html, comprador.html
  contexto jsonb not null default '{}',           -- navegador, tamaño de pantalla, url
  atendido boolean not null default false,        -- para irlos palomeando
  created_at timestamptz default now()
);

create index if not exists feedback_created_idx on feedback(created_at desc);
create index if not exists feedback_pendientes_idx on feedback(tipo, atendido) where atendido = false;

-- Igual que el resto de tablas de datos de esta app: la escribe solo el
-- backend con la service role key. Actívale Row Level Security desde el
-- dashboard sin agregar policies (deny-all para el anon key), para que
-- nadie pueda leer los comentarios de los demás con la llave pública.
