const express = require("express");
const Stripe = require("stripe");
const { slugify } = require("../utils/slugify");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Falta STRIPE_SECRET_KEY en tu .env.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({
      error: "Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu .env.",
    });
    return false;
  }
  return true;
}

/**
 * Cualquier cuenta autenticada (la misma auth de comprador, vía Supabase
 * Auth) puede ser "profesional" y crear un grupo — no existe un rol/flujo
 * de registro aparte, a propósito, para no repetir la complejidad del
 * marketplace de creadores (CURP, quiz de reglas, etc.).
 */

/**
 * POST /api/grupos
 * body: { nombre, mostrarNombres?, limiteAlumnos? }
 * Crea un grupo nuevo para el profesional autenticado. Un profesional
 * puede tener varios grupos (ej. varios salones).
 */
router.post("/", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, mostrarNombres, limiteAlumnos } = req.body;
    if (!nombre) return res.status(400).json({ error: "Falta nombre del grupo." });

    const { data, error } = await supabase
      .from("grupos")
      .insert({
        profesional_id: req.user.id,
        nombre,
        slug: slugify(nombre),
        mostrar_nombres: mostrarNombres !== false,
        limite_alumnos: limiteAlumnos || 40,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "grupo_creado", grupo: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/grupos/mios
 * Lista los grupos del profesional autenticado, con conteo de temas
 * activos y de accesos (para que vea flujo real de su piloto).
 */
router.get("/mios", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupos, error } = await supabase
      .from("grupos")
      .select("*")
      .eq("profesional_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const grupoIds = (grupos || []).map((g) => g.id);
    let temasPorGrupo = {};
    let accesosPorGrupo = {};

    if (grupoIds.length > 0) {
      const { data: temas } = await supabase
        .from("grupo_temas")
        .select("id, grupo_id, pago_status")
        .in("grupo_id", grupoIds);
      (temas || []).forEach((t) => {
        temasPorGrupo[t.grupo_id] = temasPorGrupo[t.grupo_id] || { total: 0, activos: 0 };
        temasPorGrupo[t.grupo_id].total++;
        if (t.pago_status !== "pendiente") temasPorGrupo[t.grupo_id].activos++;
      });

      const { data: accesos } = await supabase
        .from("accesos_alumno")
        .select("id, grupo_id")
        .in("grupo_id", grupoIds);
      (accesos || []).forEach((a) => {
        accesosPorGrupo[a.grupo_id] = (accesosPorGrupo[a.grupo_id] || 0) + 1;
      });
    }

    const resultado = (grupos || []).map((g) => ({
      ...g,
      temas_totales: temasPorGrupo[g.id]?.total || 0,
      temas_activos: temasPorGrupo[g.id]?.activos || 0,
      accesos_registrados: accesosPorGrupo[g.id] || 0,
    }));

    res.json({ grupos: resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/grupos/:id/temas
 * body: { titulo, contenido, esPrimerTemaGratis? }
 * Agrega un tema ya generado (ver prompt de generación, pieza aparte) a la
 * liga del grupo. El primer tema de un grupo puede marcarse como
 * "gratis_prueba" (piloto); los siguientes quedan "pendiente" hasta que se
 * conecte el cobro (Stripe checkout — pieza pendiente, ver plan-pivote).
 */
router.post("/:id/temas", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { titulo, contenido, esPrimerTemaGratis } = req.body;
    if (!titulo || !contenido) return res.status(400).json({ error: "Faltan titulo y/o contenido." });

    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, profesional_id")
      .eq("id", req.params.id)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });
    if (grupo.profesional_id !== req.user.id) {
      return res.status(403).json({ error: "Este grupo no te pertenece." });
    }

    const { count } = await supabase
      .from("grupo_temas")
      .select("id", { count: "exact", head: true })
      .eq("grupo_id", grupo.id);

    let pagoStatus;
    if (esPrimerTemaGratis || count === 0) {
      pagoStatus = "gratis_prueba";
    } else {
      // ¿el profesional tiene una suscripción de grupo activa? si sí, el
      // tema queda cubierto automáticamente, sin pasar por checkout.
      const { data: suscripcion } = await supabase
        .from("suscripciones")
        .select("id")
        .eq("user_id", req.user.id)
        .eq("tipo", "grupo")
        .eq("status", "activa")
        .maybeSingle();
      pagoStatus = suscripcion ? "cubierto_suscripcion" : "pendiente";
    }

    const { data, error } = await supabase
      .from("grupo_temas")
      .insert({ grupo_id: grupo.id, titulo, contenido, pago_status: pagoStatus })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "tema_agregado", tema: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/grupos/temas/:temaId/checkout
 * Crea una sesión de Stripe Checkout (pago único) para activar un tema de
 * grupo que quedó en pago_status "pendiente" — es decir, un tema que no es
 * el primero gratis y que el profesional no tiene cubierto por una
 * suscripción de grupo activa. Precio en platform_settings.precio_tema_grupo_mxn
 * (por defecto $129 MXN, dentro del rango $99-149 definido en el plan).
 */
router.post("/temas/:temaId/checkout", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: tema, error: temaError } = await supabase
      .from("grupo_temas")
      .select("id, titulo, pago_status, grupo_id, grupos(profesional_id)")
      .eq("id", req.params.temaId)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });
    if (tema.grupos.profesional_id !== req.user.id) {
      return res.status(403).json({ error: "Este tema no te pertenece." });
    }
    if (tema.pago_status !== "pendiente") {
      return res.status(400).json({ error: `Este tema ya está en estado "${tema.pago_status}", no necesita pago.` });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("platform_settings")
      .select("precio_tema_grupo_mxn")
      .eq("id", 1)
      .single();
    if (settingsError) throw new Error(settingsError.message);
    const precioMxn = settings.precio_tema_grupo_mxn || 129;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "mxn",
            product_data: { name: `EnseñAI — Tema de grupo: ${tema.titulo}` },
            unit_amount: Math.round(precioMxn * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { type: "tema_grupo", grupo_tema_id: tema.id, user_id: req.user.id },
      success_url: `${process.env.FRONTEND_URL}/comprador.html?tema_grupo=activado`,
      cancel_url: `${process.env.FRONTEND_URL}/comprador.html?tema_grupo=cancelado`,
    });

    res.json({ checkout_url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/grupos/publico/:slug
 * Ruta pública — regresa el grupo y sus temas ACTIVOS (pago_status !=
 * 'pendiente'). Es la página que el alumno/paciente ve al entrar a la liga.
 */
router.get("/publico/:slug", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, nombre, slug, mostrar_nombres")
      .eq("slug", req.params.slug)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });

    const { data: temas, error: temasError } = await supabase
      .from("grupo_temas")
      .select("id, titulo, contenido, created_at")
      .eq("grupo_id", grupo.id)
      .neq("pago_status", "pendiente")
      .order("created_at", { ascending: false });
    if (temasError) throw new Error(temasError.message);

    res.json({ grupo, temas: temas || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/grupos/publico/:slug/acceso
 * body: { nombre? }
 * Público — registra que alguien entró a la liga (solo si el grupo pide
 * nombre; si mostrar_nombres es false, se guarda sin nombre). Esto es la
 * métrica de flujo real del piloto: cuánta gente entró de verdad.
 */
router.post("/publico/:slug/acceso", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, mostrar_nombres")
      .eq("slug", req.params.slug)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });

    const { nombre } = req.body;
    const { error } = await supabase.from("accesos_alumno").insert({
      grupo_id: grupo.id,
      nombre: grupo.mostrar_nombres ? nombre || null : null,
    });
    if (error) throw new Error(error.message);

    res.json({ status: "acceso_registrado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
