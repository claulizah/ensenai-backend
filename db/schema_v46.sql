-- schema_v46 — 7-sep-2026
--
-- Evita que un reenvío de webhook de Stripe otorgue créditos DOBLES.
--
-- Stripe reenvía el mismo evento más de una vez de forma normal (y ahora
-- que routes/stripeWebhook.js contesta 500 cuando algo falla, lo reenvía
-- MÁS seguido a propósito). El handler ya usa upsert con
-- onConflict:"stripe_checkout_session_id", pero un onConflict sin una
-- constraint UNIQUE detrás no hace nada: Postgres no tiene contra qué
-- comparar. Esta migración crea esa constraint.
--
-- Es idempotente: se puede correr dos veces sin romper nada.

-- 1) Por si ya hubiera duplicados de antes, se conserva el más viejo de
--    cada sesión de checkout y se borran los repetidos. Sin esto, crear la
--    constraint fallaría y la migración entera se caería (mismo tropiezo
--    que v38 con las categorías viejas de icon_library).
DELETE FROM credit_batches a
USING credit_batches b
WHERE a.stripe_checkout_session_id IS NOT NULL
  AND a.stripe_checkout_session_id = b.stripe_checkout_session_id
  AND a.ctid > b.ctid;

-- 2) La constraint. UNIQUE en Postgres permite varios NULL, así que las
--    filas sin sesión de checkout (cortesías, ajustes manuales) no
--    estorban.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_batches_stripe_checkout_session_id_key'
  ) THEN
    ALTER TABLE credit_batches
      ADD CONSTRAINT credit_batches_stripe_checkout_session_id_key
      UNIQUE (stripe_checkout_session_id);
  END IF;
END $$;
