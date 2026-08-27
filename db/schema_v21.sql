-- Esquema EnseñAI v21 — correr en el SQL Editor de Supabase (después de v1-v20)
-- Precios finales de suscripción + "precio de fundador" para quien se
-- suscriba durante la ventana de lanzamiento — reutiliza la MISMA fecha
-- de corte que ya existe para el freemium (fecha_cierre_promo_lanzamiento,
-- schema_v20.sql), así "3 temas gratis" y "precio de fundador" son una
-- sola ventana de lanzamiento, no dos fechas distintas que mantener.
--
-- Precio de fundador (permanente para quien se suscriba antes del cierre):
--   individual: $79 MXN/mes
--   grupo (maestro/psicólogo): $99 MXN/mes
-- Precio regular (para quien se suscriba después):
--   individual: $129.90 MXN/mes
--   grupo: $199 MXN/mes (antes estaba en $299 — se ajustó según el nuevo
--   precio de fundador y la recomendación de mantener el escalón de grupo
--   claramente por encima del individual, dado que un maestro/psicólogo
--   reparte el material gratis a todo su grupo).

update platform_settings set suscripcion_individual_mensual_mxn = 129.90 where id = 1;
update platform_settings set suscripcion_individual_anual_mxn = 1249 where id = 1; -- ~20% de descuento vs. 12 pagos mensuales
update platform_settings set suscripcion_grupo_mensual_mxn = 199 where id = 1;

alter table platform_settings
  add column if not exists suscripcion_individual_mensual_founder_mxn numeric not null default 79,
  add column if not exists suscripcion_grupo_mensual_founder_mxn numeric not null default 99;

-- Registra con qué precio quedó cada suscripción (fundador o regular) —
-- útil para reportes y para que el precio de fundador quede "congelado"
-- de forma auditable, no solo implícito en el monto cobrado por Stripe.
alter table suscripciones
  add column if not exists es_founder boolean not null default false,
  add column if not exists precio_mxn numeric;
