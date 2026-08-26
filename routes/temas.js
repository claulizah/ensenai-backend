const express = require("express");
const fs = require("fs");
const { generarMaterialTema } = require("../agents/generateTema");
const { generarPdfTema } = require("../agents/pdfTema");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");

const router = express.Router();

/**
 * Decide cómo se cubre un tema individual nuevo (freemium/crédito/
 * suscripción) — ver db/schema_v20.sql y la sección "Precios y freemium"
 * de plan-pivote-lanzamiento.md. No aplica a modo "grupo" (ese tiene su
 * propio cobro vía grupo_temas/checkout, ver routes/grupos.js).
 *
 * Regresa { permitido: true, origen } si puede generar, o
 * { permitido: false, error } con un mensaje listo para regresar al usuario.
 */
async function resolverAccesoIndividual(userId, userCreatedAt) {
  // 1. ¿Suscripción individual activa? → temas ilimitados.
  const { data: suscripcion } = await supabase
    .from("suscripciones")
    .select("id")
    .eq("user_id", userId)
    .eq("tipo", "individual")
    .eq("status", "activa")
    .maybeSingle();
  if (suscripcion) return { permitido: true, origen: "suscripcion" };

  // 2. ¿Le quedan temas gratis este mes? El límite depende de si se
  // registró antes o después del cierre de la promo de lanzamiento —
  // se compara contra su fecha de registro real, no hace falta guardar
  // una bandera aparte.
  const { data: settings, error: settingsError } = await supabase
    .from("platform_settings")
    .select("fecha_cierre_promo_lanzamiento, temas_gratis_ventana_lanzamiento, temas_gratis_normal, precio_tema_suelto_mxn")
    .eq("id", 1)
    .single();
  if (settingsError) throw new Error(settingsError.message);

  const esVentanaLanzamiento = new Date(userCreatedAt) < new Date(settings.fecha_cierre_promo_lanzamiento);
  const limiteGratis = esVentanaLanzamiento ? settings.temas_gratis_ventana_lanzamiento : settings.temas_gratis_normal;

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { count, error: countError } = await supabase
    .from("mis_temas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", inicioMes.toISOString());
  if (countError) throw new Error(countError.message);

  if ((count || 0) < limiteGratis) return { permitido: true, origen: "gratis" };

  // 3. Sin gratis disponible — ¿tiene créditos comprados? (mismo sistema
  // de credit_batches ya usado para cursos — 1 tema = 1 crédito).
  const { data: batches, error: batchError } = await supabase
    .from("credit_batches")
    .select("id, credits_remaining")
    .eq("user_id", userId)
    .eq("stripe_payment_status", "pagado")
    .gt("credits_remaining", 0)
    .order("purchased_at", { ascending: true })
    .limit(1);
  if (batchError) throw new Error(batchError.message);

  if (batches?.length) {
    // No descontamos el crédito aquí todavía — solo hasta que la
    // generación con IA termine bien (ver POST /generar), para no
    // cobrarle un crédito a alguien si la generación falla.
    return { permitido: true, origen: "credito", batchIdADescontar: batches[0].id, creditosRestantesBatch: batches[0].credits_remaining };
  }

  return {
    permitido: false,
    error: `Ya usaste tus ${limiteGratis} temas gratis de este mes. Compra un paquete de créditos (desde $${settings.precio_tema_suelto_mxn} MXN) o suscríbete para generar temas ilimitados.`,
  };
}

/**
 * POST /api/temas/generar
 * body: { tema, nivel, modo? }
 * modo "individual" (default): usa el perfil de inteligencia dominante
 * guardado en perfiles_aprendizaje (si el usuario ya hizo el test — si no,
 * perfil balanceado por default) y genera UNA actividad combinada.
 * modo "grupo": pensado para la liga de grupo (maestros/psicólogos) —
 * genera una tabla con UNA actividad por cada una de las 8 inteligencias,
 * porque un salón/grupo tiene perfiles mezclados.
 *
 * En modo individual, el tema se guarda automáticamente en `mis_temas`
 * (historial personal — ver GET /mios) para que se pueda volver a ver o
 * reimprimir sin gastar de nuevo. En modo grupo NO se guarda aquí — para
 * eso el frontend llama después a POST /api/grupos/:id/temas con este
 * mismo `contenido` (mismo patrón de pasos separados que ya usa
 * courses.js: subir → generar → publicar).
 */
router.post("/generar", requireBuyer, async (req, res) => {
  try {
    const { tema, nivel, modo } = req.body;
    if (!tema) return res.status(400).json({ error: "Falta tema." });
    const nivelesValidos = ["preescolar", "primaria_baja", "primaria_alta", "secundaria", "preparatoria", "universidad"];
    if (!nivelesValidos.includes(nivel)) {
      return res.status(400).json({ error: `nivel debe ser uno de: ${nivelesValidos.join(", ")}.` });
    }
    const modoFinal = modo === "grupo" ? "grupo" : "individual";

    let perfilDominante = ["linguistica"]; // default balanceado si no ha hecho el test (ignorado en modo grupo)
    if (modoFinal === "individual" && supabase) {
      const { data: perfil } = await supabase
        .from("perfiles_aprendizaje")
        .select("inteligencia_dominante")
        .eq("user_id", req.user.id)
        .maybeSingle();
      if (perfil?.inteligencia_dominante?.length) {
        perfilDominante = perfil.inteligencia_dominante;
      }
    }

    // El freemium (temas gratis/mes → crédito → suscripción) solo aplica
    // al modo individual. El modo grupo se cobra aparte, por tema-grupo o
    // suscripción de grupo, al agregarlo a la liga (ver routes/grupos.js).
    let origen = null;
    let accesoIndividual = null;
    if (modoFinal === "individual" && supabase) {
      accesoIndividual = await resolverAccesoIndividual(req.user.id, req.user.created_at);
      if (!accesoIndividual.permitido) return res.status(402).json({ error: accesoIndividual.error });
      origen = accesoIndividual.origen;
    }

    const contenido = await generarMaterialTema(tema, nivel, perfilDominante, modoFinal);

    // Recién ahora que la generación con IA terminó bien descontamos el
    // crédito (si aplicaba) — así una falla de la IA no le cuesta un
    // crédito al usuario.
    if (origen === "credito" && supabase) {
      await supabase
        .from("credit_batches")
        .update({ credits_remaining: accesoIndividual.creditosRestantesBatch - 1 })
        .eq("id", accesoIndividual.batchIdADescontar);
    }

    let temaId = null;
    if (modoFinal === "individual" && supabase) {
      const { data: guardado, error: guardarError } = await supabase
        .from("mis_temas")
        .insert({ user_id: req.user.id, tema, nivel, perfil_usado: perfilDominante, contenido, origen })
        .select("id")
        .single();
      if (!guardarError) temaId = guardado.id;
      // si falla el guardado no bloqueamos la respuesta — el usuario ya
      // pagó/gastó el tema generado y debe poder verlo aunque no quede
      // en su historial
    }

    res.json({
      status: "tema_generado",
      modo: modoFinal,
      perfil_usado: modoFinal === "individual" ? perfilDominante : null,
      tema_id: temaId,
      origen,
      contenido,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/mios
 * Historial de temas generados en modo individual por el usuario
 * autenticado (papás/adolescentes/adultos generando para sí mismos).
 */
router.get("/mios", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data, error } = await supabase
      .from("mis_temas")
      .select("id, tema, nivel, pdf_url, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    res.json({ temas: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/mios/:id
 * Detalle completo (contenido) de un tema del historial individual —
 * para volver a verlo o reimprimirlo sin gastar de nuevo.
 */
router.get("/mios/:id", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data, error } = await supabase
      .from("mis_temas")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (error || !data) return res.status(404).json({ error: "Tema no encontrado." });

    res.json({ tema: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/temas/pdf
 * body: { contenido, modo?, temaId? }
 * Genera el imprimible en PDF de un tema ya generado (ver POST /generar)
 * y lo sube a Supabase Storage, igual que ya se hacía para los ejercicios
 * de los cursos con video (routes/courses.js + agents/pdf.js) — reutiliza
 * el mismo bucket ("course-videos") para no requerir crear uno nuevo.
 * Regresa la URL pública del PDF.
 *
 * Si se manda `temaId` (el id que regresó POST /generar al guardar en el
 * historial individual), también actualiza `mis_temas.pdf_url` para no
 * tener que regenerar el PDF cada vez que el usuario vuelve a su historial.
 *
 * Nota: es un paso separado de /generar (mismo patrón de pasos sueltos
 * que el resto de la API) porque no todos los usos necesitan PDF — el
 * frontend solo lo llama cuando el usuario pide "descargar/imprimir".
 */
router.post("/pdf", requireBuyer, async (req, res) => {
  let pdfLocalPath;
  try {
    const { contenido, modo, temaId } = req.body;
    if (!contenido || typeof contenido !== "object") {
      return res.status(400).json({ error: "Falta contenido (el JSON que regresó POST /api/temas/generar)." });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Supabase no está configurado — no se puede subir el PDF." });
    }
    const modoFinal = modo === "grupo" ? "grupo" : "individual";

    pdfLocalPath = await generarPdfTema(contenido, modoFinal);
    const pdfBuffer = fs.readFileSync(pdfLocalPath);
    const storagePath = `${req.user.id}/tema-${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("course-videos")
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) throw new Error(`Error subiendo el PDF: ${uploadError.message}`);

    const { data: urlData } = supabase.storage.from("course-videos").getPublicUrl(storagePath);

    if (temaId) {
      await supabase.from("mis_temas").update({ pdf_url: urlData.publicUrl }).eq("id", temaId).eq("user_id", req.user.id);
    }

    res.json({ status: "pdf_generado", pdf_url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (pdfLocalPath) fs.unlink(pdfLocalPath, () => {});
  }
});

module.exports = router;
