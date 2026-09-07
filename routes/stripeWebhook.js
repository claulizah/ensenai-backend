const Stripe = require("stripe");
const supabase = require("../db/supabase");
const { avisarFalla } = require("../utils/avisoFalla");

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

      // Si metadata viene vacío o incompleto (una Checkout Session armada
      // a mano o mal configurada), antes esto tronaba con un TypeError que
      // caía en el catch de abajo y se perdía. Ahora es un error explícito.
      if (!session.metadata || !session.metadata.type) {
        throw new Error(`checkout.session.completed sin metadata.type (session ${session.id})`);
      }

      const tipo = session.metadata.type; // "credit_pack" | "bundle" | "suscripcion" | "tema_grupo"

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
    // ESTE ERA EL BUG: se hacía console.error y se contestaba 200 igual,
    // así que Stripe daba el evento por entregado y NUNCA lo reintentaba.
    // Resultado: alguien pagaba, algo fallaba al darle su plan (Supabase
    // con hipo, un bug, lo que sea), y se quedaba pagando sin plan sin que
    // nadie se enterara. Contestando 500, Stripe reintenta solo con
    // backoff durante varios días — que es justo lo que queremos cuando
    // la falla es nuestra y no del evento.
    avisarFalla({
      correo: event.data?.object?.customer_details?.email || event.data?.object?.customer_email,
      tema: event.data?.object?.id,
      error: err,
      donde: `stripe:${event.type}`,
    });
    console.error(`Error procesando evento de Stripe (${event.type}):`, err.message);
    return res.status(500).json({ received: false, error: err.message });
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
  // schema_v39: ya existe plan anual. Las sesiones creadas antes de ese
  // cambio (o por una página cacheada) no traen `periodo`: esas son
  // mensuales, como siempre.
  const periodo = session.metadata.periodo === "anual" ? "anual" : "mensual";
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  const { error } = await supabase.from("suscripciones").upsert(
    {
      user_id,
      tipo,
      nivel,
      // La tabla `suscripciones` tiene DOS columnas distintas: `plan`
      // (NOT NULL, check in 'mensual'/'anual' — la FRECUENCIA de cobro,
      // de schema_v16) y `nivel` (check in 'aprendemos'/'ilimitado' — el
      // NIVEL del plan, de schema_v22). El código de abajo ya guardaba
      // `nivel` bien; lo que nunca se guardó fue `plan`, y como es NOT
      // NULL, el insert fallaba silenciosamente detrás de un 200 a Stripe.
      // Desde schema_v39, purchases.js manda `periodo` en la metadata y
      // crea la suscripción con interval "month" o "year" según eso. (Un
      // intento anterior de arreglar esto puso `nivel` en `plan` por error,
      // lo cual violaba el check constraint porque "ilimitado"/"aprendemos"
      // no son valores válidos de `plan`.)
      plan: periodo,
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

// Mapeo explícito de los status de Stripe a los nuestros. ANTES: cualquier
// status no reconocido (canceled, unpaid, incomplete_expired, paused…)
// caía en un default de "activa" — o sea, una suscripción que Stripe ya
// dio por cancelada o impagada quedaba marcada como ACTIVA en nuestra
// base, y esa persona seguía usando la plataforma sin pagar.
const STATUS_STRIPE_A_INTERNO = {
  active: "activa",
  trialing: "activa",
  past_due: "pago_fallido",
  unpaid: "pago_fallido",
  incomplete: "pago_fallido",
  incomplete_expired: "cancelada",
  canceled: "cancelada",
  paused: "cancelada",
};

async function procesarActualizacionSuscripcion(subscription) {
  const status = STATUS_STRIPE_A_INTERNO[subscription.status];
  if (!status) {
    // Un status que no conocemos: mejor dejar el guardado como está que
    // arriesgarnos a marcarlo mal.
    console.error(`Status de suscripción de Stripe no reconocido: "${subscription.status}" (sub ${subscription.id})`);
  }

  const cambios = status ? { status } : {};
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

  const creditsTotalNum = Number(credits_total);
  const pricePaidNum = Number(price_paid_mxn);

  // Antes, metadata no numérica o credits_total en 0 se guardaba como
  // NaN/Infinity sin que nada lo detectara.
  if (!Number.isFinite(creditsTotalNum) || creditsTotalNum <= 0 || !Number.isFinite(pricePaidNum)) {
    throw new Error(
      `Metadata inválida en compra de créditos (session ${session.id}): credits_total="${credits_total}", price_paid_mxn="${price_paid_mxn}"`
    );
  }

  // Stripe puede reenviar el mismo evento más de una vez — es el
  // comportamiento esperado, no un caso raro. Sin protección, un reintento
  // le daba créditos DOBLES al usuario. Requiere la constraint UNIQUE de
  // db/schema_v46.sql; sin ella el onConflict no sirve de nada.
  const { error } = await supabase.from("credit_batches").upsert(
    {
      user_id,
      credit_pack_id,
      credits_total: creditsTotalNum,
      credits_remaining: creditsTotalNum,
      price_paid_mxn: pricePaidNum,
      price_per_credit_mxn: Math.round((pricePaidNum / creditsTotalNum) * 100) / 100,
      stripe_checkout_session_id: session.id,
      stripe_payment_status: "pagado",
    },
    { onConflict: "stripe_checkout_session_id", ignoreDuplicates: true }
  );

  if (error) {
    throw new Error(`No se pudo guardar la compra de créditos de ${user_id}: ${error.message}`);
  }
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
