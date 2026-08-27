const Stripe = require("stripe");
const supabase = require("../db/supabase");

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

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const tipo = session.metadata.type; // "credit_pack" | "bundle" | "suscripcion"

      if (tipo === "bundle") {
        await procesarCompraDePaquete(session);
      } else if (tipo === "suscripcion") {
        await procesarInicioSuscripcion(session);
      } else if (tipo === "tema_grupo") {
        await procesarPagoTemaGrupo(session);
      } else {
        await procesarCompraDeCreditos(session);
      }
    } else if (event.type === "customer.subscription.updated") {
      await procesarActualizacionSuscripcion(event.data.object);
    } else if (event.type === "customer.subscription.deleted") {
      await procesarCancelacionSuscripcion(event.data.object);
    }
  } catch (err) {
    console.error("Error procesando evento de Stripe:", err.message);
  }

  res.json({ received: true });
}

/**
 * Fecha de fin del periodo actual de una suscripción, en ISO.
 *
 * OJO — esto causó un bug de pago real: a partir de la versión de API
 * 2025-08-27 (la que usa el SDK de Stripe v18), `current_period_end` YA NO
 * existe al nivel de la suscripción; se movió a cada item
 * (`subscription.items.data[0].current_period_end`).
 *
 * Con el código anterior, `subscription.current_period_end` llegaba como
 * undefined, `new Date(undefined * 1000).toISOString()` lanzaba
 * "RangeError: Invalid time value", el catch del webhook se lo tragaba y
 * respondía 200 a Stripe — o sea: el cobro se hacía, Stripe daba el evento
 * por entregado, y la suscripción NUNCA se guardaba. El usuario pagaba y
 * seguía viendo "Plan Gratis".
 *
 * Esta función lee de los dos lugares y, si no encuentra ninguno, regresa
 * null en vez de tronar: es preferible guardar la suscripción sin la fecha
 * de renovación que perderla entera.
 */
function finDePeriodoISO(subscription) {
  const epoch =
    subscription?.current_period_end ??
    subscription?.items?.data?.[0]?.current_period_end ??
    null;

  if (!epoch || !Number.isFinite(epoch)) return null;
  const fecha = new Date(epoch * 1000);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

/**
 * checkout.session.completed con metadata.type = "suscripcion" — primer
 * pago de una suscripción nueva (individual mensual/anual, o de grupo).
 * IMPORTANTE: en el dashboard de Stripe, el webhook debe estar suscrito
 * también a "customer.subscription.updated" y "customer.subscription.deleted"
 * (por default solo suele venir marcado checkout.session.completed).
 */
async function procesarInicioSuscripcion(session) {
  const { user_id, tipo, nivel, precio_mxn } = session.metadata;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  const { error } = await supabase.from("suscripciones").upsert(
    {
      user_id,
      tipo,
      nivel,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      status: "activa",
      current_period_end: finDePeriodoISO(subscription),
      precio_mxn: precio_mxn ? Number(precio_mxn) : null,
    },
    { onConflict: "stripe_subscription_id" }
  );

  // Si esto falla, alguien pagó y no tiene su plan: hay que poder verlo en
  // los logs de Render sin tener que reproducir el pago.
  if (error) {
    throw new Error(`No se pudo guardar la suscripción de ${user_id} (${tipo}/${nivel}): ${error.message}`);
  }
}

/** Renovación (o cambio de estado, ej. pago fallido) de una suscripción existente. */
async function procesarActualizacionSuscripcion(subscription) {
  const status = subscription.status === "active" ? "activa" : subscription.status === "past_due" ? "pago_fallido" : "activa";

  const cambios = { status };
  const fin = finDePeriodoISO(subscription);
  if (fin) cambios.current_period_end = fin; // no pisar la fecha buena con null

  await supabase.from("suscripciones").update(cambios).eq("stripe_subscription_id", subscription.id);
}

/** Cancelación (por el usuario o por fallos de pago repetidos). */
async function procesarCancelacionSuscripcion(subscription) {
  await supabase.from("suscripciones").update({ status: "cancelada" }).eq("stripe_subscription_id", subscription.id);
}

/**
 * checkout.session.completed con metadata.type = "tema_grupo" — pago único
 * de un tema de grupo que estaba "pendiente" (no era el primero gratis ni
 * estaba cubierto por una suscripción de grupo activa). Marca el tema como
 * "pagado" para que aparezca en la página pública del grupo (GET
 * /api/grupos/publico/:slug ya filtra por pago_status != 'pendiente').
 */
async function procesarPagoTemaGrupo(session) {
  const { grupo_tema_id } = session.metadata;

  await supabase
    .from("grupo_temas")
    .update({ pago_status: "pagado", stripe_session_id: session.id })
    .eq("id", grupo_tema_id);
}

async function procesarCompraDeCreditos(session) {
  const { user_id, credit_pack_id, credits_total, price_paid_mxn } = session.metadata;

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
}

async function procesarCompraDePaquete(session) {
  const { user_id, bundle_id, price_paid_mxn } = session.metadata;
  const pricePaid = Number(price_paid_mxn);

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("platform_commission_pct")
    .eq("id", 1)
    .single();
  const commissionPct = settings?.platform_commission_pct ?? 30;

  const platformCommissionTotal = Math.round(pricePaid * (commissionPct / 100) * 100) / 100;
  const creatorEarningsTotal = Math.round((pricePaid - platformCommissionTotal) * 100) / 100;

  const { data: bundlePurchase, error: bpError } = await supabase
    .from("bundle_purchases")
    .insert({
      user_id,
      bundle_id,
      price_paid_mxn: pricePaid,
      platform_commission_mxn: platformCommissionTotal,
      creator_earnings_mxn: creatorEarningsTotal,
      stripe_checkout_session_id: session.id,
      stripe_payment_status: "pagado",
    })
    .select()
    .single();

  if (bpError) {
    if (bpError.code === "23505") return; // ya tenía este paquete — no duplicamos accesos
    throw new Error(bpError.message);
  }

  const { data: bundleCourses, error: bcError } = await supabase
    .from("bundle_courses")
    .select("course_id")
    .eq("bundle_id", bundle_id);
  if (bcError) throw new Error(bcError.message);

  const numCourses = bundleCourses.length || 1;
  const platformCommissionPorCurso = Math.round((platformCommissionTotal / numCourses) * 100) / 100;
  const creatorEarningsPorCurso = Math.round((creatorEarningsTotal / numCourses) * 100) / 100;

  for (const bc of bundleCourses) {
    await supabase.from("course_purchases").insert({
      user_id,
      course_id: bc.course_id,
      bundle_purchase_id: bundlePurchase.id,
      platform_commission_mxn: platformCommissionPorCurso,
      creator_earnings_mxn: creatorEarningsPorCurso,
    });
  }
}

module.exports = { stripeWebhookHandler };
