-- Esquema EnseñAI v20 — correr en el SQL Editor de Supabase (después de v1-v19)
-- Lógica de freemium para la generación de temas individual (papás/
-- adolescentes/adultos) — ver plan-pivote-lanzamiento.md, sección
-- "Precios y freemium definidos para el lanzamiento":
--   - Quien se registró ANTES de fecha_cierre_promo_lanzamiento: 3 temas
--     gratis al mes, de forma PERMANENTE (se compara contra su fecha de
--     registro real en auth.users, no hace falta guardar una bandera).
--   - Quien se registra DESPUÉS: 1 tema gratis al mes.
--   - Agotado el gratis del mes, se cobra 1 crédito (credit_batches, el
--     mismo sistema de créditos que ya existía) o queda cubierto si tiene
--     una suscripción individual activa (temas ilimitados).

alter table platform_settings
  add column if not exists fecha_cierre_promo_lanzamiento date default '2026-09-30',
  add column if not exists temas_gratis_ventana_lanzamiento int not null default 3,
  add column if not exists temas_gratis_normal int not null default 1,
  add column if not exists precio_tema_suelto_mxn numeric not null default 22;

-- Ajusta fecha_cierre_promo_lanzamiento directamente en Supabase si la
-- ventana de "regreso a clases" termina en otra fecha.

-- Registra cómo se cubrió cada tema individual generado — útil para ver
-- en el historial del usuario y para reportes de conversión freemium→pago.
alter table mis_temas
  add column if not exists origen text not null default 'gratis'
    check (origen in ('gratis', 'credito', 'suscripcion'));

-- credit_packs traía precios/etiquetas del modelo viejo (créditos para
-- "cursos" de video, $29.90/$199.90/$349.90 por 1/10/20). Ahora 1 crédito
-- = 1 tema individual suelto (una vez agotado el freemium del mes) — se
-- actualizan etiqueta y precio, con descuento por volumen, dentro del
-- rango $19-25 MXN definido en plan-pivote-lanzamiento.md.
update credit_packs set label = '1 tema', price_mxn = 22 where credits = 1;
update credit_packs set label = '10 temas', price_mxn = 180 where credits = 10;
update credit_packs set label = '20 temas', price_mxn = 320 where credits = 20;
