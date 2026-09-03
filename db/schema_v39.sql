-- Esquema EnseñAI v39 — correr en el SQL Editor de Supabase (después de v1-v38)
--
-- Precio de lanzamiento + plan anual (3-sep-2026).
--
-- Decisión de Claudia: bajar el precio de entrada para conseguir volumen
-- ("prefiero tener muchos clientes a pocos que paguen mucho") y sacar el
-- plan anual, que es como compra el mercado docente en México: un pago al
-- arrancar el ciclo escolar.
--
--   Mensual              antes    ahora
--   Esencial individual   $79      $59
--   Esencial grupo       $109      $89
--   Ilimitado individual $129      $99
--   Ilimitado grupo      $159     $129
--
--   Anual = 10 meses por el precio de 12 (dos meses de regalo):
--   $590 / $890 / $990 / $1290
--
-- Quien ya está suscrito NO se ve afectado: Stripe cobra las renovaciones
-- con el monto con el que se creó la suscripción, así que los precios
-- viejos se respetan solos. Y quien entre ahora se queda con el precio de
-- lanzamiento aunque después suba — por eso conviene decirlo así en la
-- página ("precio de fundador").
--
-- Es idempotente en el sentido que importa: los UPDATE solo tocan la fila
-- si todavía trae el precio anterior, así que correrlo dos veces no hace
-- nada, y si Claudia ajusta un precio a mano después, un rerun accidental
-- NO se lo pisa.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Precios anuales (columnas nuevas)
-- ─────────────────────────────────────────────────────────────────────────
alter table platform_settings
  add column if not exists plan_individual_aprendemos_precio_anual_mxn numeric not null default 590,
  add column if not exists plan_individual_ilimitado_precio_anual_mxn  numeric not null default 990,
  add column if not exists plan_grupo_aprendemos_precio_anual_mxn      numeric not null default 890,
  add column if not exists plan_grupo_ilimitado_precio_anual_mxn       numeric not null default 1290;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Precios mensuales nuevos (solo si siguen en el precio viejo)
-- ─────────────────────────────────────────────────────────────────────────
update platform_settings set plan_individual_aprendemos_precio_mxn = 59
  where id = 1 and plan_individual_aprendemos_precio_mxn = 79;

update platform_settings set plan_individual_ilimitado_precio_mxn = 99
  where id = 1 and plan_individual_ilimitado_precio_mxn = 129;

update platform_settings set plan_grupo_aprendemos_precio_mxn = 89
  where id = 1 and plan_grupo_aprendemos_precio_mxn = 109;

update platform_settings set plan_grupo_ilimitado_precio_mxn = 129
  where id = 1 and plan_grupo_ilimitado_precio_mxn = 159;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Comprobación (opcional: para verlo en pantalla al correrlo)
-- ─────────────────────────────────────────────────────────────────────────
select
  plan_individual_aprendemos_precio_mxn as esencial_ind,
  plan_individual_aprendemos_precio_anual_mxn as esencial_ind_anual,
  plan_individual_ilimitado_precio_mxn as ilimitado_ind,
  plan_individual_ilimitado_precio_anual_mxn as ilimitado_ind_anual,
  plan_grupo_aprendemos_precio_mxn as esencial_grupo,
  plan_grupo_aprendemos_precio_anual_mxn as esencial_grupo_anual,
  plan_grupo_ilimitado_precio_mxn as ilimitado_grupo,
  plan_grupo_ilimitado_precio_anual_mxn as ilimitado_grupo_anual
from platform_settings where id = 1;
