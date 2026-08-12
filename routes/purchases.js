const express = require("express");
const Stripe = require("stripe");
const supabase = require("../db/supabase");
const { requireBuyer } = require("../middleware/auth");

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Falta STRIPE_SECRET_KEY en tu .env.");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * POST /api/purchases/checkout
 * body: { creditPackId }
 * Requiere sesión de comprador (Authorization: Bearer <token>).
 *
 * Crea una sesión de Stripe Checkout para comprar un paquete de créditos.
 * Regresa la URL a la que hay que redirigir al comprador.
 */
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
            unit_amount: Math.round(pack.price_mxn * 100), // Stripe usa centavos
          },
          quantity: 1,
        },
      ],
      metadata: {
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
 * POST /api/purchases/redeem
 * body: { courseId }
 * Requiere sesión de comprador.
 *
 * Canjea 1 crédito (del lote más antiguo con crédito disponible) por
 * acceso a un curso. Calcula la comisión sobre el precio real de ESE
 * crédito, no sobre el precio de lista del curso.
 */
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
    if (yaComprado) {
      return res.status(400).json({ error: "Ya tienes acceso a este curso." });
    }

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

/**
 * GET /api/purchases/mis-creditos
 * Requiere sesión de comprador. Regresa el total de créditos disponibles.
 */
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

/**
 * GET /api/purchases/mis-cursos
 * Requiere sesión de comprador. Regresa los cursos ya comprados.
 */
router.get("/mis-cursos", requireBuyer, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("course_purchases")
      .select("*, courses(*)")
      .eq("user_id", req.user.id)
      .order("purchased_at", { ascending: false });
    if (error) throw new Error(error.message);

    res.json({ cursos: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
