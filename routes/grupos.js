const express = require("express");
const Stripe = require("stripe");
const { slugify } = require("../utils/slugify");
const { requireBuyer } = require("../middleware/auth");
const { obtenerPlanGrupo, inicioDeMes } = require("../utils/planes");
const { primerNombre } = require("../utils/nombre");
const { registrarActividadAlumno, rachasDelGrupo } = require("../utils/rachaAlumno");
const { verificarRespuestas } = require("../utils/trivia");
const { generarActividadesPorInteligencia } = require("../agents/generateTema");
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
 * body: { titulo, contenido, pdfUrl? }
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
    const { titulo, contenido, pdfUrl } = req.body;
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
    // Antes bastaba con que el cliente mandara esPrimerTemaGratis:true para
    // que el tema quedara gratis, sin verificar nada: cualquiera podía
    // activar todos sus temas saltándose el plan y Stripe. Ahora lo decide
    // el servidor con el conteo real; la bandera del cliente solo puede
    // pedirlo, nunca imponerlo (31-ago-2026).
    if (count === 0) {
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
 * GET /api/grupos/:id/temas/:temaId
 * Para el profesional dueño del grupo — el contenido COMPLETO de un tema ya
 * compartido (explicación, diagrama, actividades, ejercicios, trivia y
 * material de repaso).
 *
 * GET /mios a propósito no manda `contenido` (pesa mucho y se piden todos los
 * grupos de un jalón), y eso dejaba al maestro viendo nada más los títulos de
 * sus temas — sin forma de revisar lo que ya le compartió a su grupo
 * (reporte 2-sep-2026). Aquí se pide UNO, cuando lo abre.
 */
router.get("/:id/temas/:temaId", requireBuyer, async (req, res) => {
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
      .select("id, grupo_id, titulo, contenido, pago_status, pdf_url, created_at")
      .eq("id", req.params.temaId)
      .single();
    if (temaError || !tema || tema.grupo_id !== grupo.id) {
      return res.status(404).json({ error: "Tema no encontrado en este grupo." });
    }

    res.json({ tema });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/grupos/:id/temas/:temaId
 * body: { titulo?, contenido? }
 *
 * El maestro puede corregir un tema que YA está en su liga (una redacción,
 * una respuesta mal, una actividad que no le sirvió) sin tener que generarlo
 * otra vez ni gastar cupo. Solo se tocan los campos que vengan en el body.
 *
 * No se valida la forma del contenido a propósito: es el mismo JSON que el
 * frontend acaba de leer de aquí, y g.html ya tolera campos faltantes (los
 * temas viejos traen formas distintas). Lo que sí se cuida es que el tema
 * sea de un grupo de quien llama.
 */
router.patch("/:id/temas/:temaId", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { titulo, contenido } = req.body || {};
    if (titulo === undefined && contenido === undefined) {
      return res.status(400).json({ error: "No mandaste nada que cambiar." });
    }
    if (contenido !== undefined && (typeof contenido !== "object" || contenido === null || Array.isArray(contenido))) {
      return res.status(400).json({ error: "El contenido debe ser un objeto." });
    }

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

    const cambios = {};
    if (titulo !== undefined) {
      const limpio = String(titulo).trim();
      if (!limpio) return res.status(400).json({ error: "El título no puede quedar vacío." });
      cambios.titulo = limpio.slice(0, 300);
    }
    if (contenido !== undefined) {
      cambios.contenido = contenido;
      // El PDF guardado se armó con el contenido ANTERIOR: dejarlo sería
      // compartirle al grupo un imprimible que ya no dice lo mismo que la
      // liga. Se borra la referencia; el maestro puede generar uno nuevo.
      cambios.pdf_url = null;
    }

    const { data, error } = await supabase
      .from("grupo_temas")
      .update(cambios)
      .eq("id", tema.id)
      .select("id, titulo, contenido, pago_status")
      .single();
    if (error) throw new Error(error.message);

    res.json({ tema: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/grupos/temas/:temaId/actividades
 * body: { nivel?, enfoque? }
 *
 * "Adaptar por inteligencia" (31-ago-2026): genera las 8 actividades de la
 * tabla de Gardner para un tema de grupo YA generado, y las guarda dentro de
 * su contenido. Antes esas 8 salían en cada generación de grupo — era la
 * parte más pesada del material y lo que hacía que el modo grupo se sintiera
 * lento (o se cayera por tardanza). Ahora el tema nace con UNA actividad
 * para todo el grupo y estas 8 se piden solo si el profesional las quiere.
 *
 * Es idempotente: si el tema ya tiene las 8, las regresa sin volver a
 * gastar una llamada al modelo.
 */
router.post("/temas/:temaId/actividades", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: tema, error: temaError } = await supabase
      .from("grupo_temas")
      .select("id, contenido, grupos!inner(profesional_id)")
      .eq("id", req.params.temaId)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });
    if (tema.grupos?.profesional_id !== req.user.id) {
      return res.status(403).json({ error: "Este tema no te pertenece." });
    }

    const contenido = tema.contenido || {};
    const actuales = Array.isArray(contenido.actividades) ? contenido.actividades : [];
    const porInteligencia = actuales.filter((a) => a && a.inteligencia && a.inteligencia !== "todas");
    if (porInteligencia.length >= 8) {
      return res.json({ status: "ya_estaban", actividades: actuales });
    }

    // El nivel/enfoque REAL del tema se guarda dentro del contenido al
    // crearlo (grupo_temas no tiene esas columnas). Se prefiere ese valor
    // sobre lo que mande el cliente: el <select> del formulario se
    // reinicia al re-renderizar la pantalla y mandaba "primaria_baja",
    // así que las 8 actividades salían escritas para 6-8 años sobre temas
    // de secundaria (31-ago-2026).
    const nivel =
      (typeof contenido.nivel === "string" && contenido.nivel) ||
      (typeof req.body.nivel === "string" && req.body.nivel) ||
      "primaria_alta";
    const enfoque =
      contenido.enfoque === "psicoeducativo" || req.body.enfoque === "psicoeducativo" ? "psicoeducativo" : "escolar";
    const ocho = await generarActividadesPorInteligencia(contenido, nivel, enfoque);

    // La genérica ("todas") se conserva al principio: sigue siendo la que
    // le sirve al grupo completo, las 8 son el detalle por si lo quiere.
    const generica = actuales.filter((a) => a && a.inteligencia === "todas");
    const actividades = [...generica, ...ocho];
    const contenidoNuevo = { ...contenido, actividades };

    const { error } = await supabase
      .from("grupo_temas")
      .update({ contenido: contenidoNuevo })
      .eq("id", tema.id);
    if (error) throw new Error(error.message);

    res.json({ status: "actividades_generadas", actividades });
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

    const { nombre, respuestas, alumnoId } = req.body;
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

    // Contestar la trivia cuenta como día activo del alumno (v37). Va
    // DESPUÉS de guardar y nunca lanza: la racha es un extra, no puede
    // costarle a nadie sus respuestas.
    const racha = await registrarActividadAlumno(grupo.id, alumnoId, {
      nombre,
      guardarNombre: grupo.mostrar_nombres,
    });

    res.json({ status: "respuestas_guardadas", racha });
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

/**
 * POST /api/grupos/publico/:slug/temas/:temaId/ejercicios-marcados
 * body: { nombre?, indices: number[] }
 * Público — "checkbox ligero" de progreso: el alumno/paciente marca en
 * g.html qué ejercicios de la pestaña "Practicar" ya resolvió (sin foto,
 * sin Storage) y le da "Guardar mi progreso". Pensado para validar si a
 * los profesionales les basta con esta señal antes de construir algo más
 * caro (ver ejercicios_marcados_alumno en db/schema_v31.sql).
 *
 * `indices` se limpia igual que en /respuestas: se descarta cualquier cosa
 * fuera del rango real de ejercicios del tema, para que no llegue basura
 * desde las herramientas de desarrollador del navegador.
 *
 * Privacidad: mismo tratamiento de "nombre" que /respuestas (primer
 * nombre/apodo, opcional en grupos anónimos) — ver utils/nombre.js.
 */
router.post("/publico/:slug/temas/:temaId/ejercicios-marcados", async (req, res) => {
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

    const { nombre, indices, alumnoId } = req.body;
    const totalEjercicios = Array.isArray(tema.contenido?.ejercicios) ? tema.contenido.ejercicios.length : 0;
    if (!totalEjercicios) return res.status(400).json({ error: "Este tema no tiene ejercicios." });

    const indicesValidos = Array.isArray(indices)
      ? [...new Set(indices.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < totalEjercicios))]
      : [];

    const { error } = await supabase.from("ejercicios_marcados_alumno").insert({
      grupo_tema_id: tema.id,
      nombre: primerNombre(nombre),
      indices_resueltos: indicesValidos,
      total_ejercicios: totalEjercicios,
    });
    if (error) throw new Error(error.message);

    // Marcar ejercicios también cuenta como día activo (ver utils/rachaAlumno.js).
    const racha = await registrarActividadAlumno(grupo.id, alumnoId, {
      nombre,
      guardarNombre: grupo.mostrar_nombres,
    });

    res.json({ status: "progreso_guardado", racha });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/grupos/:id/alumnos
 * Para el profesional dueño del grupo: cómo va cada alumno/paciente que ha
 * contestado algo — su racha de días, su récord y cuándo fue la última vez
 * (ver utils/rachaAlumno.js y db/schema_v37.sql).
 *
 * En grupos anónimos (mostrar_nombres = false) el nombre viene null y el
 * frontend los numera ("Anónimo 1"): quien atiende pacientes no necesita
 * nombres para ver si su gente está siguiendo el material.
 *
 * Si la tabla todavía no existe (migración sin correr) contesta una lista
 * vacía en vez de tumbar el panel del maestro.
 */
router.get("/:id/alumnos", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos")
      .select("id, profesional_id, mostrar_nombres")
      .eq("id", req.params.id)
      .single();
    if (grupoError || !grupo) return res.status(404).json({ error: "Grupo no encontrado." });
    if (grupo.profesional_id !== req.user.id) {
      return res.status(403).json({ error: "Este grupo no te pertenece." });
    }

    let alumnos = [];
    try {
      alumnos = await rachasDelGrupo(grupo.id);
    } catch (err) {
      console.warn("[racha alumno] no se pudo leer el grupo:", err.message);
    }

    res.json({ alumnos, muestra_nombres: !!grupo.mostrar_nombres });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/grupos/:id/temas/:temaId/ejercicios-marcados
 * Para el profesional dueño del grupo — regresa cada envío de progreso de
 * ejercicios de ese tema (ver POST .../ejercicios-marcados arriba).
 */
router.get("/:id/temas/:temaId/ejercicios-marcados", requireBuyer, async (req, res) => {
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
      .from("ejercicios_marcados_alumno")
      .select("id, nombre, indices_resueltos, total_ejercicios, created_at")
      .eq("grupo_tema_id", tema.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    res.json({ marcados: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
