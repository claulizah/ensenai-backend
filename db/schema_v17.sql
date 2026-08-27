-- Esquema EnseñAI v17 — correr en el SQL Editor de Supabase (después de v1-v16)
-- Precio del tema-grupo suelto (pago único, para el profesional que no
-- quiere suscribirse) — ver checkout en routes/grupos.js
-- (POST /api/grupos/temas/:temaId/checkout).

alter table platform_settings
  add column if not exists precio_tema_grupo_mxn numeric default 129;
