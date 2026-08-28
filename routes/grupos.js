const express = require("express");
const Stripe = require("stripe");
const { slugify } = require("../utils/slugify");
const { requireBuyer } = require("../middleware/auth");
const { obtenerPlanGrupo, inicioDeMes } = require("../utils/planes");
const { primerNombre } = require("../utils/nombre");
const supabase = require("../db/supabase");

const router = express.Router();

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Falta STRIPE_SECRET_KEY en tu .env.");
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// Misma normalización que usa g.html en el navegador (normalizarTexto) —
// tiene que coincidir para que una respuesta correcta no se marque como
// incorrecta solo por mayúsculas o espacios de más.
function normalizarTexto(s) {
  return (s || "").toString().trim().toLowerCase();
}

/**
 * Recalcula "acerto" pregunta por pregunta usando el contenido REAL del
 * tema guardado en la base de datos (contenido.trivia), no lo que haya
 * mandado el cliente — así una respuesta manipulada desde las herramientas
 * de desarrollador no puede aparecer como "correcta" en el reporte del
 * profesor. Server siempre gana: pregunta, respuesta_correcta y acerto que
 * salen de aquí sustituyen lo que mandó el cliente; solo "respuesta" (lo
 * que la persona realmente contestó) es del cliente, porque eso no hay
 * forma de conocerlo del lado del servidor.
 */
function verificarRespuestas(contenido, respuestasCliente) {
  const triviaOriginal = Array.isArray(contenido?.trivia) ? contenido.trivia : [];

  return respuestasCliente.map((r) => {
    const original = Number.isInteger(r.indice) ? triviaOriginal[r.indice] : undefined;

    // No pudimos ubicar la pregunta original (tema editado, índice raro,
    // etc.) — guardamos lo que llegó pero sin confiar en su calificación.
    if (!original) {
      return {
        pregunta: typeof r.pregunta === "string" ? r.pregunta : "",
        respuesta: typeof r.respuesta === "string" ? r.respuesta : null,
        respuesta_correcta: typeof r.respuesta_correcta === "string" ? r.respuesta_correcta : "",
        acerto: null,
      };
    }

    const esCerrada = Array.isArray(original.opciones) && original.opciones.length > 0;
    const respuesta = typeof r.respuesta === "string" ? r.respuesta : null;
    const acerto = esCerrada
      ? !!respuesta && normalizarTexto(respuesta) === normalizarTexto(original.respuesta_correcta)
      : null; // abierta: nunca se autocalifica, ni aquí ni en g.html

    return {
      pregunta: original.pregunta || "",
      respuesta,
      respuesta_correcta: original.respuesta_correcta || "",
      acerto,
    };
  });
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
 * puede tener varios grupos (ej. varios salones), hasta el límite de su
 * plan (Gratis 1, Aprendemos 3, Ilimitado 6 — ver utils/planes.js).
 */
router.post("/", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, mostrarNombres, limiteAlumnos } = req.body;
    if (!nombre) return res.status(400).json({ error: "Falta nombre del grupo." });

    const plan = await obtenerPlanGrupo(req.user.id);
    const { count: gruposActuales, error: countError } = await supabase
      .from("grupos")
      .select("id", { count: "exact", head: true })
      .eq("profesional_id", req.user.id);
    if (countError) throw new Error(countError.message);

    if ((gruposActuales || 0) >= plan.limite_grupos) {
      return res.status(402).json({
        error: `Tu plan actual (${plan.nivel}) permite hasta ${plan.limite_grupos} grupo(s). Mejora tu plan para crear más.`,
      });
    }

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
 * GET /api/grupos/mi-plan
 * Regresa el plan de grupo activo del profesional (Gratis/Aprendemos/
 * Ilimitado — ver utils/planes.js), cuántos grupos tiene creados y cuántos
 * temas-grupo ha cubierto su plan este mes, para mostrar el estado en
 * grupo.html y ofrecer subir de plan si aplica.
 */
router.get("/mi-plan", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const plan = await obtenerPlanGrupo(req.user.id);

    const { count: gruposActuales, error: gruposError } = await supabase
      .from("grupos")
      .select("id", { count: "exact", head: true })
      .eq("profesional_id", req.user.id);
    if (gruposError) throw new Error(gruposError.message);

    let usadosEsteMes = 0;
    if (plan.nivel !== "gratis") {
      const { data: misGrupos } = await supabase.from("grupos").select("id").eq("profesional_id", req.user.id);
      const idsMisGrupos = (misGrupos || []).map((g) => g.id);
      const { count, error: usadosError } = await supabase
        .from("grupo_temas")
        .select("id", { count: "exact", head: true })
        .in("grupo_id", idsMisGrupos)
        .eq("pago_status", "cubierto_suscripcion")
        .gte("created_at", inicioDeMes().toISOString());
      if (usadosError) throw new Error(usadosError.message);
      usadosEsteMes = count || 0;
    }

    res.json({ ...plan, grupos_actuales: gruposActuales || 0, temas_usados_este_mes: usadosEsteMes });
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
    let listaTemasPorGrupo = {};
    let accesosPorGrupo = {};

    if (grupoIds.length > 0) {
      const { data: temas } = await supabase
        .from("grupo_temas")
        .select("id, grupo_id, titulo, pago_status, created_at")
        .in("grupo_id", grupoIds)
        .order("created_at", { ascending: false });
      (temas || []).forEach((t) => {
        temasPorGrupo[t.grupo_id] = temasPorGrupo[t.grupo_id] || { total: 0, activos: 0 };
        temasPorGrupo[t.grupo_id].total++;
        if (t.pago_status !== "pendiente") temasPorGrupo[t.grupo_id].activos++;
        listaTemasPorGrupo[t.grupo_id] = listaTemasPorGrupo[t.grupo_id] || [];
        // no se manda "contenido" completo aquí (puede pesar mucho) — solo
        // lo necesario para que el profesional vea estado y pueda pagar los
        // temas que quedaron "pendiente".
        listaTemasPorGrupo[t.grupo_id].push({ id: t.id, titulo: t.titulo, pago_status: t.pago_status, created_at: t.created_at });
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
      temas: listaTemasPorGrupo[g.id] || [],
    }));

    res.json({ grupos: resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/grupos/:id/temas
 * body: { titulo, contenido, esPrimerTemaGratis?, pdfUrl? }
 * Agrega un tema ya generado (ver prompt de generación, pieza aparte) a la
 * liga del grupo. El primer tema de un grupo puede marcarse como
 * "gratis_prueba" (piloto). Los siguientes se cubren automáticamente
 * ("cubierto_suscripcion") si el profesional tiene un plan de grupo activo
 * y no ha llegado a su tope mensual (Aprendemos: 20 temas-grupo/mes,
 * Ilimitado: sin tope); si no, quedan "pendiente" hasta pagarse suelto vía
 * Stripe checkout (ver POST /temas/:temaId/checkout).
 * pdfUrl (opcional) se guarda junto con el tema para que la página pública
 * (g.html, sin cuenta) pueda ofrecer el imprimible sin necesitar sesión —
 * POST /api/temas/pdf sí requiere sesión, así que el profesional lo genera
 * una vez al agregar el tema, no cada alumno por su cuenta.
 */
router.post("/:id/temas", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { titulo, contenido, esPrimerTemaGratis, pdfUrl } = req.body;
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
      // ¿el profesional tiene un plan de grupo activo? si es Ilimitado, el
      // tema queda cubierto sin más. Si es Aprendemos, cubierto solo si no
      // ha llegado a su tope mensual de temas-grupo. Si no tiene plan (o ya
      // llegó al tope), el tema queda "pendiente" — se paga suelto o se
      // sube de plan.
      const plan = await obtenerPlanGrupo(req.user.id);
      if (plan.nivel === "ilimitado") {
        pagoStatus = "cubierto_suscripcion";
      } else if (plan.nivel === "aprendemos") {
        const { data: misGrupos } = await supabase
          .from("grupos")
          .select("id")
          .eq("profesional_id", req.user.id);
        const idsMisGrupos = (misGrupos || []).map((g) => g.id);
        const { count: usadosEsteMes, error: usadosError } = await supabase
          .from("grupo_temas")
          .select("id", { count: "exact", head: true })
          .in("grupo_id", idsMisGrupos)
          .eq("pago_status", "cubierto_suscripcion")
          .gte("created_at", inicioDeMes().toISOString());
        if (usadosError) throw new Error(usadosError.message);
        pagoStatus = (usadosEsteMes || 0) < plan.limite_temas_mes ? "cubierto_suscripcion" : "pendiente";
      } else {
        pagoStatus = "pendiente";
      }
    }

    const { data, error } = await supabase
      .from("grupo_temas")
      .insert({ grupo_id: grupo.id, titulo, contenido, pago_status: pagoStatus, pdf_url: pdfUrl || null })
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
      .select("id, titulo, contenido, pdf_url, created_at")
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

/**
 * POST /api/grupos/publico/:slug/temas/:temaId/respuestas
 * body: { nombre?, respuestas: [{ indice, pregunta, respuesta, respuesta_correcta, acerto }] }
 * Público — guarda el detalle de cómo un alumno/paciente contestó la trivia
 * de un tema, para que el profesional pueda ver no solo el acceso sino qué
 * está fallando el grupo. Se llama al terminar "Revisar mis respuestas" en
 * g.html; si falla (sin internet, etc.) no bloquea al alumno — ya vio su
 * calificación en pantalla de todos modos, esto es solo para el profesor.
 *
 * "acerto" NUNCA se toma tal cual del cliente: verificarRespuestas() lo
 * recalcula leyendo la pregunta real desde grupo_temas.contenido (por
 * "indice"), para que alguien no pueda mandar respuestas falsas marcadas
 * como correctas desde las herramientas de desarrollador del navegador.
 *
 * Privacidad: nombre nunca guarda más que el primer nombre o apodo (ver
 * utils/nombre.js), sin importar el modo del grupo. En grupos con
 * mostrar_nombres = false (pensado para psicólogos con pacientes) dar el
 * nombre es opcional en g.html — si la persona lo dio, aquí se guarda
 * igual que en cualquier otro grupo (recortado al primer nombre); si lo
 * omitió, req.body.nombre llega vacío y queda null. A diferencia de esta
 * ruta, el registro de accesos (POST /publico/:slug/acceso) sí sigue
 * forzando null en grupos anónimos — ese conteo no necesita identificar a
 * nadie.
 */
router.post("/publico/:slug/temas/:temaId/respuestas", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, mostrar_nombres")
      .eq("slug", req.params.slug)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });

    const { data: tema, error: temaError } = await supabase
      .from("grupo_temas")
      .select("id, grupo_id, contenido")
      .eq("id", req.params.temaId)
      .single();
    if (temaError || !tema || tema.grupo_id !== grupo.id) {
      return res.status(404).json({ error: "Tema no encontrado en este grupo." });
    }

    const { nombre, respuestas } = req.body;
    if (!Array.isArray(respuestas) || respuestas.length === 0) {
      return res.status(400).json({ error: "Faltan respuestas." });
    }

    const respuestasVerificadas = verificarRespuestas(tema.contenido, respuestas);
    const cerradas = respuestasVerificadas.filter((r) => r.acerto === true || r.acerto === false);
    const aciertos = cerradas.filter((r) => r.acerto === true).length;

    const { error } = await supabase.from("respuestas_alumno").insert({
      grupo_tema_id: tema.id,
      nombre: primerNombre(nombre),
      respuestas: respuestasVerificadas,
      aciertos,
      total_cerradas: cerradas.length,
    });
    if (error) throw new Error(error.message);

    res.json({ status: "respuestas_guardadas" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/grupos/:id/temas/:temaId/respuestas
 * Para el profesional dueño del grupo — regresa cada envío de respuestas de
 * trivia de ese tema, con el detalle pregunta por pregunta, para ver qué
 * está fallando el grupo (no solo un promedio).
 */
router.get("/:id/temas/:temaId/respuestas", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, profesional_id")
      .eq("id", req.params.id)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });
    if (grupo.profesional_id !== req.user.id) {
      return res.status(403).json({ error: "Este grupo no te pertenece." });
    }

    const { data: tema, error: temaError } = await supabase
      .from("grupo_temas")
      .select("id, grupo_id")
      .eq("id", req.params.temaId)
      .single();
    if (temaError || !tema || tema.grupo_id !== grupo.id) {
      return res.status(404).json({ error: "Tema no encontrado en este grupo." });
    }

    const { data, error } = await supabase
      .from("respuestas_alumno")
      .select("id, nombre, respuestas, aciertos, total_cerradas, created_at")
      .eq("grupo_tema_id", tema.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    res.json({ respuestas: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
