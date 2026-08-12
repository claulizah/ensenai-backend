const Stripe = require("stripe");
const supabase = require("../db/supabase");

/**
 * Handler del webhook de Stripe. Se monta directo en server.js,
 * ANTES del middleware express.json() global, porque necesita el
 * cuerpo crudo (sin parsear) para verificar la firma de Stripe.
 */
async function stripeWebhookHandler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature inválida:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { user_id, credit_pack_id, credits_total, price_paid_mxn } = session.metadata;

    try {
      await supabase.from("credit_batches").insert({
        user_id,
        credit_pack_id,
        credits_total: Number(credits_total),
        credits_remaining: Number(credits_total),
        price_paid_mxn: Number(price_paid_mxn),
        price_per_credit_mxn: Number(price_paid_mxn) / Number(credits_total),
        stripe_checkout_session_id: session.id,
        stripe_payment_status: "pagado",
      });
    } catch (err) {
      console.error("Error creando credit_batch tras pago confirmado:", err.message);
      // Respondemos 200 igual — Stripe reintenta si respondemos error;
      // esto se puede reconciliar manualmente revisando session.id en Stripe.
    }
  }

  res.json({ received: true });
}

module.exports = { stripeWebhookHandler };
