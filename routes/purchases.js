const express = require("express");
const Stripe = require("stripe");
const supabase = require("../db/supabase");
const { requireBuyer } = require("../middleware/auth");

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Falta STRIPE_SECRET_KEY en tu .env.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

router.post("/checkout", requireBuyer, async (req, res) => {
  try {
    const { creditPackId } = req.body;
    if (!creditPackId) return res.status(400).json({ error: "Falta creditPackId." });

    const { data: pack, error: packError } = await supabase
      .from("credit_packs")
      .select("*")
      .eq("id", creditPackId)
      .eq("active", true)
      .single();
    if (packError || !pack) throw new Error("Paquete de créditos no encontrado.");

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `EnseñAI — ${pack.label}` },
            unit_amount: Math.round(pack.price_mxn * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "credit_pack",
        user_id: req.user.id,
        credit_pack_id: pack.id,
        credits_total: pack.credits,
        price_paid_mxn: pack.price_mxn,
      },
      success_url: `${process.env.FRONTEND_URL}/comprador.html?compra=exitosa`,
      cancel_url: `${process.env.FRONTEND_URL}/comprador.html?compra=cancelada`,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/purchases/checkout-bundle
 * body: { bundleId }
 * Crea una sesión de Stripe Checkout para comprar un paquete temático
 * completo (pago directo, no usa el sistema de créditos).
 */
router.post("/checkout-bundle", requireBuyer, async (req, res) => {
  try {
    const { bundleId } = req.body;
    if (!bundleId) return res.status(400).json({ error: "Falta bundleId." });

    const { data: bundle, error: bundleError } = await supabase
      .from("bundles")
      .select("*")
      .eq("id", bundleId)
      .eq("status", "publicado")
      .single();
    if (bundleError || !bundle) throw new Error("Paquete no encontrado o no está publicado.");

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `EnseñAI — ${bundle.title}` },
            unit_amount: Math.round(bundle.price_mxn * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "bundle",
        user_id: req.user.id,
        bundle_id: bundle.id,
        price_paid_mxn: bundle.price_mxn,
      },
      success_url: `${process.env.FRONTEND_URL}/comprador.html?compra=exitosa`,
      cancel_url: `${process.env.FRONTEND_URL}/paquete.html?slug=${bundle.slug}&compra=cancelada`,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/purchases/checkout-suscripcion
 * body: { tipo: "individual"|"grupo", plan: "mensual"|"anual" }
 * Crea una sesión de Stripe Checkout en modo "subscription" (recurrente).
 * El plan "anual" cobra una sola exhibición al año; "grupo" por ahora solo
 * existe mensual.
 *
 * Precio de fundador: si el usuario se registró antes del cierre de la
 * promo de lanzamiento (platform_settings.fecha_cierre_promo_lanzamiento —
 * la MISMA fecha que ya define el freemium de 3 temas gratis, ver
 * schema_v20.sql), el plan mensual (individual o grupo) se le cobra al
 * precio de fundador — y como Stripe cobra las renovaciones al mismo monto
 * con el que se creó la suscripción, ese precio queda congelado para
 * siempre mientras no cancele. El plan anual no tiene precio de fundador
 * distinto por ahora.
 */
router.post("/checkout-suscripcion", requireBuyer, async (req, res) => {
  try {
    const { tipo, plan } = req.body;
    if (!["individual", "grupo"].includes(tipo)) {
      return res.status(400).json({ error: "tipo debe ser 'individual' o 'grupo'." });
    }
    if (!["mensual", "anual"].includes(plan)) {
      return res.status(400).json({ error: "plan debe ser 'mensual' o 'anual'." });
    }
    if (tipo === "grupo" && plan === "anual") {
      return res.status(400).json({ error: "El plan de grupo por ahora solo está disponible mensual." });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("platform_settings")
      .select(
        "suscripcion_individual_mensual_mxn, suscripcion_individual_anual_mxn, suscripcion_grupo_mensual_mxn, " +
          "suscripcion_individual_mensual_founder_mxn, suscripcion_grupo_mensual_founder_mxn, fecha_cierre_promo_lanzamiento"
      )
      .eq("id", 1)
      .single();
    if (settingsError) throw new Error(settingsError.message);

    const esFounder = plan === "mensual" && new Date(req.user.created_at) < new Date(settings.fecha_cierre_promo_lanzamiento);

    let amountMxn, interval, label;
    if (tipo === "individual" && plan === "mensual") {
      amountMxn = esFounder ? settings.suscripcion_individual_mensual_founder_mxn : settings.suscripcion_individual_mensual_mxn;
      interval = "month";
      label = `Suscripción individual — mensual${esFounder ? " (precio de fundador)" : ""}`;
    } else if (tipo === "individual" && plan === "anual") {
      amountMxn = settings.suscripcion_individual_anual_mxn;
      interval = "year";
      label = "Suscripción individual — anual";
    } else {
      amountMxn = esFounder ? settings.suscripcion_grupo_mensual_founder_mxn : settings.suscripcion_grupo_mensual_mxn;
      interval = "month";
      label = `Suscripción de grupo — mensual${esFounder ? " (precio de fundador)" : ""}`;
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `EnseñAI — ${label}` },
            unit_amount: Math.round(amountMxn * 100),
            recurring: { interval },
          },
          quantity: 1,
        },
      ],
      metadata: { type: "suscripcion", tipo, plan, user_id: req.user.id, es_founder: String(esFounder), precio_mxn: String(amountMxn) },
      success_url:
        tipo === "grupo"
          ? `${process.env.FRONTEND_URL}/grupo.html?suscripcion=exitosa`
          : `${process.env.FRONTEND_URL}/comprador.html?suscripcion=exitosa`,
      cancel_url:
        tipo === "grupo"
          ? `${process.env.FRONTEND_URL}/grupo.html?suscripcion=cancelada`
          : `${process.env.FRONTEND_URL}/comprador.html?suscripcion=cancelada`,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/purchases/mi-suscripcion
 * Regresa la suscripción activa del usuario, si tiene una.
 */
router.get("/mi-suscripcion", requireBuyer, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("suscripciones")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("status", "activa")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);

    res.json({ tiene_suscripcion_activa: !!data, suscripcion: data || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/redeem", requireBuyer, async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: "Falta courseId." });

    const { data: yaComprado } = await supabase
      .from("course_purchases")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("course_id", courseId)
      .maybeSingle();
    if (yaComprado) return res.status(400).json({ error: "Ya tienes acceso a este curso." });

    const { data: batches, error: batchError } = await supabase
      .from("credit_batches")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("stripe_payment_status", "pagado")
      .gt("credits_remaining", 0)
      .order("purchased_at", { ascending: true })
      .limit(1);
    if (batchError) throw new Error(batchError.message);
    if (!batches || batches.length === 0) {
      return res.status(400).json({ error: "No tienes créditos disponibles. Compra un paquete primero." });
    }
    const batch = batches[0];

    const { data: settings, error: settingsError } = await supabase
      .from("platform_settings")
      .select("platform_commission_pct")
      .eq("id", 1)
      .single();
    if (settingsError) throw new Error(settingsError.message);

    const pricePerCredit = batch.price_per_credit_mxn;
    const platformCommission = Math.round(pricePerCredit * (settings.platform_commission_pct / 100) * 100) / 100;
    const creatorEarnings = Math.round((pricePerCredit - platformCommission) * 100) / 100;

    const { error: updateError } = await supabase
      .from("credit_batches")
      .update({ credits_remaining: batch.credits_remaining - 1 })
      .eq("id", batch.id);
    if (updateError) throw new Error(updateError.message);

    const { data: purchase, error: purchaseError } = await supabase
      .from("course_purchases")
      .insert({
        user_id: req.user.id,
        course_id: courseId,
        credit_batch_id: batch.id,
        price_per_credit_mxn: pricePerCredit,
        platform_commission_mxn: platformCommission,
        creator_earnings_mxn: creatorEarnings,
      })
      .select()
      .single();
    if (purchaseError) throw new Error(purchaseError.message);

    res.json({ status: "canjeado", purchase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/mis-creditos", requireBuyer, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("credit_batches")
      .select("credits_remaining")
      .eq("user_id", req.user.id)
      .eq("stripe_payment_status", "pagado");
    if (error) throw new Error(error.message);

    const total = (data || []).reduce((sum, b) => sum + b.credits_remaining, 0);
    res.json({ creditos_disponibles: total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/mis-cursos", requireBuyer, async (req, res) => {
  try {
    // Acceso directo (créditos canjeados curso por curso)
    const { data: directos, error: directosError } = await supabase
      .from("course_purchases")
      .select("course_id, courses(*)")
      .eq("user_id", req.user.id);
    if (directosError) throw new Error(directosError.message);

    // Acceso vía paquetes comprados completos
    const { data: bundlesComprados, error: bundlesError } = await supabase
      .from("bundle_purchases")
      .select("bundle_id")
      .eq("user_id", req.user.id)
      .eq("stripe_payment_status", "pagado");
    if (bundlesError) throw new Error(bundlesError.message);

    let cursosDesdePaquetes = [];
    if (bundlesComprados && bundlesComprados.length > 0) {
      const bundleIds = bundlesComprados.map((b) => b.bundle_id);
      const { data: bc, error: bcError } = await supabase
        .from("bundle_courses")
        .select("course_id, courses(*)")
        .in("bundle_id", bundleIds);
      if (bcError) throw new Error(bcError.message);
      cursosDesdePaquetes = bc || [];
    }

    // combina ambas fuentes, sin duplicar el mismo curso
    const vistos = new Set();
    const cursos = [];
    [...(directos || []), ...cursosDesdePaquetes].forEach((item) => {
      if (item.course_id && !vistos.has(item.course_id)) {
        vistos.add(item.course_id);
        cursos.push(item);
      }
    });

    res.json({ cursos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
