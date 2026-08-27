const express = require("express");
const fs = require("fs");
const { generarMaterialTema } = require("../agents/generateTema");
const { generarPdfTema } = require("../agents/pdfTema");
const { requireBuyer } = require("../middleware/auth");
const { obtenerPlanIndividual, inicioDeMes } = require("../utils/planes");
const supabase = require("../db/supabase");

const router = express.Router();

/**
 * Decide si el usuario puede generar un tema individual más este mes,
 * según su plan (Gratis/Aprendemos/Ilimitado — ver utils/planes.js y
 * db/schema_v22.sql). No aplica a modo "grupo" (ese tiene su propio cobro
 * vía grupo_temas/checkout, ver routes/grupos.js).
 *
 * Regresa { permitido: true, origen } si puede generar, o
 * { permitido: false, error } con un mensaje listo para regresar al usuario.
 */
async function resolverAccesoIndividual(userId) {
  const plan = await obtenerPlanIndividual(userId);

  if (plan.limite_temas_mes === null) {
    return { permitido: true, origen: plan.nivel }; // ilimitado
  }

  const { count, error: countError } = await supabase
    .from("mis_temas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", inicioDeMes().toISOString());
  if (countError) throw new Error(countError.message);

  if ((count || 0) < plan.limite_temas_mes) {
    return { permitido: true, origen: plan.nivel };
  }

  return {
    permitido: false,
    error:
      plan.nivel === "gratis"
        ? `Ya usaste tus ${plan.limite_temas_mes} temas gratis de este mes. Mejora tu plan para seguir generando (Aprendemos: 20 temas/mes por $79 MXN, o Ilimitado por $129 MXN/mes).`
        : `Ya usaste los ${plan.limite_temas_mes} temas de tu plan Aprendemos este mes. Cambia a Ilimitado para generar sin límite.`,
  };
}

/**
 * POST /api/temas/generar
 * body: { tema, nivel, modo?, perfilId? }
 * modo "individual" (default): usa el perfil indicado en `perfilId` (uno
 * de los que regresa GET /api/aprendizaje/perfiles) para su inteligencia
 * dominante — si no se manda o no existe, usa un perfil balanceado por
 * default. Genera UNA actividad combinada.
 * modo "grupo": pensado para la liga de grupo (maestros/psicólogos) —
 * genera una tabla con UNA actividad por cada una de las 8 inteligencias,
 * porque un salón/grupo tiene perfiles mezclados. Ignora perfilId.
 *
 * En modo individual, el tema se guarda automáticamente en `mis_temas`
 * (historial personal — ver GET /mios) para que se pueda volver a ver o
 * reimprimir sin gastar de nuevo. En modo grupo NO se guarda aquí — para
 * eso el frontend llama después a POST /api/grupos/:id/temas con este
 * mismo `contenido` (mismo patrón de pasos separados que ya usa
 * courses.js: subir → generar → publicar).
 */
/**
 * Normaliza lo que mande el frontend como etiquetas: acepta un arreglo de
 * strings, recorta espacios, quita vacíos y duplicados. Cualquier otra cosa
 * (undefined, string suelto, etc.) regresa un arreglo vacío — las etiquetas
 * son opcionales en todo momento.
 */
function normalizarEtiquetas(valor) {
  if (!Array.isArray(valor)) return [];
  const limpias = valor.map((e) => String(e || "").trim()).filter(Boolean);
  return [...new Set(limpias)].slice(0, 10); // hasta 10 etiquetas por tema, suficiente para materia/parcial/etc.
}

router.post("/generar", requireBuyer, async (req, res) => {
  try {
    const { tema, nivel, modo, perfilId, etiquetas } = req.body;
    if (!tema) return res.status(400).json({ error: "Falta tema." });
    const nivelesValidos = ["preescolar", "primaria_baja", "primaria_alta", "secundaria", "preparatoria", "universidad"];
    if (!nivelesValidos.includes(nivel)) {
      return res.status(400).json({ error: `nivel debe ser uno de: ${nivelesValidos.join(", ")}.` });
    }
    const modoFinal = modo === "grupo" ? "grupo" : "individual";

    let perfilDominante = ["linguistica"]; // default balanceado si no se indica perfil (ignorado en modo grupo)
    if (modoFinal === "individual" && supabase && perfilId) {
      const { data: perfil } = await supabase
        .from("perfiles_aprendizaje")
        .select("inteligencia_dominante")
        .eq("id", perfilId)
        .eq("user_id", req.user.id)
        .maybeSingle();
      if (perfil?.inteligencia_dominante?.length) {
        perfilDominante = perfil.inteligencia_dominante;
      }
    }

    // El límite de generaciones/mes (Gratis/Aprendemos/Ilimitado) solo
    // aplica al modo individual. El modo grupo se cobra aparte, por
    // tema-grupo o suscripción de grupo, al agregarlo a la liga (ver
    // routes/grupos.js).
    let origen = null;
    if (modoFinal === "individual" && supabase) {
      const acceso = await resolverAccesoIndividual(req.user.id);
      if (!acceso.permitido) return res.status(402).json({ error: acceso.error });
      origen = acceso.origen;
    }

    const contenido = await generarMaterialTema(tema, nivel, perfilDominante, modoFinal);

    let temaId = null;
    if (modoFinal === "individual" && supabase) {
      const { data: guardado, error: guardarError } = await supabase
        .from("mis_temas")
        .insert({ user_id: req.user.id, tema, nivel, perfil_usado: perfilDominante, contenido, origen, etiquetas: normalizarEtiquetas(etiquetas) })
        .select("id")
        .single();
      if (!guardarError) temaId = guardado.id;
      // si falla el guardado no bloqueamos la respuesta — el usuario ya
      // gastó el tema generado y debe poder verlo aunque no quede en su
      // historial
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
 * GET /api/temas/mi-plan
 * Regresa el plan individual activo del usuario (Gratis/Aprendemos/
 * Ilimitado — ver utils/planes.js) junto con cuántos temas ha generado
 * este mes, para que el frontend (comprador.html) muestre "12/20 temas
 * este mes" y ofrezca subir de plan si aplica.
 */
router.get("/mi-plan", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const plan = await obtenerPlanIndividual(req.user.id);
    const { count, error: countError } = await supabase
      .from("mis_temas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .gte("created_at", inicioDeMes().toISOString());
    if (countError) throw new Error(countError.message);

    res.json({ ...plan, usados_este_mes: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/mios
 * Historial de temas generados en modo individual por el usuario
 * autenticado (papás/adolescentes/adultos generando para sí mismos).
 *
 * Query opcional `etiqueta`: si se manda, regresa solo los temas que
 * tengan esa etiqueta exacta (ej. "Matemáticas", "Parcial 1") — pensado
 * para que el frontend pueda filtrar el historial. El filtrado por texto
 * libre (buscar por el nombre del tema) se hace del lado del frontend
 * sobre esta misma lista, no hace falta ida y vuelta al servidor para eso.
 */
router.get("/mios", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    let query = supabase
      .from("mis_temas")
      .select("id, tema, nivel, pdf_url, etiquetas, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    const { etiqueta } = req.query;
    if (etiqueta) query = query.contains("etiquetas", [etiqueta]);

    const { data, error } = await query;
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
 * PATCH /api/temas/mios/:id
 * body: { etiquetas: string[] }
 * Actualiza las etiquetas de un tema ya guardado en el historial — para
 * poder agregar/corregir etiquetas (ej. "Parcial 1") después de generado,
 * sin tener que gastar un tema nuevo.
 */
router.patch("/mios/:id", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const etiquetas = normalizarEtiquetas(req.body.etiquetas);
    const { data, error } = await supabase
      .from("mis_temas")
      .update({ etiquetas })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id, etiquetas")
      .single();
    if (error || !data) return res.status(404).json({ error: "Tema no encontrado." });

    res.json({ status: "etiquetas_actualizadas", etiquetas: data.etiquetas });
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
