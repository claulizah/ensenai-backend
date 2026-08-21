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
