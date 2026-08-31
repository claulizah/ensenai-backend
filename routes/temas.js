const express = require("express");
const fs = require("fs");
const { generarMaterialTema, askClaude, EDAD_APROX } = require("../agents/generateTema");
const { generarPdfTema } = require("../agents/pdfTema");
const { combinarTemas } = require("../agents/combinarTemas");
const { revisarEjercicio } = require("../agents/revisarEjercicio");
const { verificarYCorregir } = require("../utils/revisorCalidad");
const { requireBuyer } = require("../middleware/auth");
const { obtenerPlanIndividual, inicioDeMes } = require("../utils/planes");
const { registrarActividad, obtenerEstadoGamificacion, armarTriviaDiaria } = require("../utils/gamificacion");
const { obtenerOCrearCodigo, obtenerBono, consumirBono } = require("../utils/referidos");
const { verificarRespuestas } = require("../utils/trivia");
const supabase = require("../db/supabase");

const router = express.Router();

/**
 * Convierte el rango de EDAD_APROX ("3-5", "18+") en un número usable por
 * utils/revisorCalidad.js (compararConEdad espera un entero). Se toma el
 * extremo INFERIOR del rango a propósito: es la lectura más exigente
 * (más simple) del nivel, así el chequeo de nivel de lectura no deja pasar
 * texto complicado solo porque el nivel también admite estudiantes mayores.
 */
function edadNumericaAproximada(nivel) {
  const numero = parseInt(EDAD_APROX[nivel] || "10", 10);
  return Number.isFinite(numero) ? numero : 10;
}

/**
 * true si `fechaCreacion` cae en el mismo mes calendario que hoy — usado
 * para el "boost" de bienvenida de cuentas Gratis (ver resolverAccesoIndividual
 * abajo y utils/planes.js). Se compara por mes calendario (no por "hace 7
 * días") para que encaje con inicioDeMes(), que es como ya se cuenta todo
 * lo demás en esta app — así el boost se acaba justo cuando el contador
 * normal del mes se reinicia, sin una fecha de corte aparte que llevar.
 */
function estaEnMesDeRegistro(fechaCreacion) {
  if (!fechaCreacion) return false;
  const creado = new Date(fechaCreacion);
  const ahora = new Date();
  return creado.getUTCFullYear() === ahora.getUTCFullYear() && creado.getUTCMonth() === ahora.getUTCMonth();
}

/**
 * Decide si el usuario puede generar un tema individual más este mes,
 * según su plan (Gratis/Aprendemos/Ilimitado — ver utils/planes.js y
 * db/schema_v22.sql). No aplica a modo "grupo" (ese tiene su propio cobro
 * vía grupo_temas/checkout, ver routes/grupos.js). No cuenta los simulacros
 * de "Modo Examen" (tipo="examen", ver resolverAccesoExamen) — son un
 * contador aparte desde schema_v28.
 *
 * Dos ganchos de crecimiento (ago-2026, ver utils/referidos.js y
 * schema_v30): si ya llegó a su límite normal, primero se revisa el
 * "boost" de cuenta Gratis nueva (límite más alto solo el mes en que se
 * registró), y si aun así no alcanza, se revisan sus créditos de
 * referidos (bono_temas_disponibles) antes de negar el acceso.
 *
 * @param {{id:string, created_at?:string}} user - req.user completo (no
 * solo el id) porque el boost necesita la fecha de creación de la cuenta.
 * Regresa { permitido: true, origen, usaBono? } si puede generar, o
 * { permitido: false, error } con un mensaje listo para regresar al usuario.
 */
async function resolverAccesoIndividual(user) {
  const userId = user.id;
  const plan = await obtenerPlanIndividual(userId);

  if (plan.limite_temas_mes === null) {
    return { permitido: true, origen: plan.nivel }; // ilimitado
  }

  let limiteEfectivo = plan.limite_temas_mes;
  if (plan.nivel === "gratis" && plan.limite_gratis_boost && estaEnMesDeRegistro(user.created_at)) {
    limiteEfectivo = Math.max(limiteEfectivo, plan.limite_gratis_boost);
  }

  const { count, error: countError } = await supabase
    .from("mis_temas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tipo", "tema")
    .gte("created_at", inicioDeMes().toISOString());
  if (countError) throw new Error(countError.message);

  if ((count || 0) < limiteEfectivo) {
    return { permitido: true, origen: plan.nivel };
  }

  const bono = await obtenerBono(userId);
  if (bono > 0) {
    return { permitido: true, origen: plan.nivel, usaBono: true };
  }

  return {
    permitido: false,
    error:
      plan.nivel === "gratis"
        ? `Ya usaste tus ${limiteEfectivo} temas gratis de este mes. Mejora tu plan para seguir generando (Esencial: 20 temas/mes por $79 MXN, o Ilimitado por $129 MXN/mes), o comparte tu código de referido para ganar temas de regalo.`
        : `Ya usaste los ${limiteEfectivo} temas de tu plan Esencial este mes. Cambia a Ilimitado para generar sin límite, o comparte tu código de referido para ganar temas de regalo.`,
  };
}

/**
 * Igual que resolverAccesoIndividual, pero para "Modo Examen"
 * (mis_temas.tipo="examen", schema_v28) — un contador mensual APARTE del
 * de temas normales, con su propio límite por plan (limite_examenes_mes,
 * ver utils/planes.js). No aplica a modo "grupo": ahí un examen de maestro
 * sigue el mismo mecanismo de "agregar a la liga" que ya cobra los temas
 * de grupo (routes/grupos.js), sin un contador de exámenes separado por
 * ahora.
 */
async function resolverAccesoExamen(userId) {
  const plan = await obtenerPlanIndividual(userId);

  if (plan.limite_examenes_mes === null) {
    return { permitido: true, origen: plan.nivel }; // ilimitado
  }

  if (plan.limite_examenes_mes === 0) {
    return {
      permitido: false,
      error: "Modo Examen no está incluido en tu plan Gratis. Mejora tu plan para armar simulacros de examen (Esencial: 2 al mes, o Ilimitado sin límite).",
    };
  }

  const { count, error: countError } = await supabase
    .from("mis_temas")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("tipo", "examen")
    .gte("created_at", inicioDeMes().toISOString());
  if (countError) throw new Error(countError.message);

  if ((count || 0) < plan.limite_examenes_mes) {
    return { permitido: true, origen: plan.nivel };
  }

  return {
    permitido: false,
    error: `Ya usaste tus ${plan.limite_examenes_mes} simulacros de examen de este mes. Cambia a Ilimitado para armar simulacros sin límite.`,
  };
}

/**
 * POST /api/temas/generar
 * body: { tema, nivel, modo?, perfilId?, enfoque? }
 * modo "individual" (default): usa el perfil indicado en `perfilId` (uno
 * de los que regresa GET /api/aprendizaje/perfiles) para su inteligencia
 * dominante — si no se manda o no existe, usa un perfil balanceado por
 * default. Genera UNA actividad combinada.
 * modo "grupo": pensado para la liga de grupo (maestros/psicólogos) —
 * genera una tabla con UNA actividad por cada una de las 8 inteligencias,
 * porque un salón/grupo tiene perfiles mezclados. Ignora perfilId.
 *
 * `enfoque` (default "escolar"): "psicoeducativo" cambia la FORMA del
 * contenido (ver agents/generateTema.js) para uso en terapia/consulta —
 * la actividad y los "ejercicios" pasan a ser estrategias de afrontamiento
 * y práctica para casa en vez de dinámicas escolares. No cambia el límite
 * que se consume ni el JSON de salida, así que no requiere cambios en el
 * frontend para poder verse — es opcional pedirlo.
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
    const { tema, nivel, modo, perfilId, etiquetas, detalles, imagenes, enfoque } = req.body;
    if (!tema) return res.status(400).json({ error: "Falta tema." });
    const nivelesValidos = ["preescolar", "primaria_baja", "primaria_alta", "secundaria", "preparatoria", "universidad"];
    if (!nivelesValidos.includes(nivel)) {
      return res.status(400).json({ error: `nivel debe ser uno de: ${nivelesValidos.join(", ")}.` });
    }
    const modoFinal = modo === "grupo" ? "grupo" : "individual";
    // "psicoeducativo" (pensado para la liga de grupo de psicólogos, pero
    // disponible también en modo individual) cambia la FORMA del contenido
    // — actividad y "ejercicios" pasan a ser estrategias de afrontamiento y
    // práctica para casa en vez de dinámicas/tareas escolares — pero no
    // cambia el límite mensual que consume ni el JSON de salida (ver
    // agents/generateTema.js). Default "escolar" = comportamiento de siempre.
    const enfoqueFinal = enfoque === "psicoeducativo" ? "psicoeducativo" : "escolar";

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
    let accesoUsoBono = false;
    if (modoFinal === "individual" && supabase) {
      const acceso = await resolverAccesoIndividual(req.user);
      if (!acceso.permitido) return res.status(402).json({ error: acceso.error });
      origen = acceso.origen;
      accesoUsoBono = !!acceso.usaBono;
    }

    // `detalles` (nota escrita) e `imagenes` (fotos de un resumen/apuntes)
    // son opcionales — orientan la generación sin limitarla. Ver
    // agents/generateTema.js, que valida y descarta imágenes mal formadas.
    // La llamada real va envuelta en verificarYCorregir (utils/revisorCalidad.js):
    // valida estructura y nivel de lectura gratis, y si eso pasa limpio hace
    // una revisión barata con IA — si algo falla, regenera con instrucciones
    // correctivas hasta 2 intentos en total. Si se agotan los intentos, se
    // entrega igual (no se bloquea al usuario) pero sin el sello de verificado.
    const generarFn = (temaOriginal, instruccionesCorrectivas) =>
      generarMaterialTema(temaOriginal, nivel, perfilDominante, modoFinal, {
        detalles: instruccionesCorrectivas ? `${detalles || ""} ${instruccionesCorrectivas}`.trim() : detalles,
        imagenes,
        enfoque: enfoqueFinal,
      });

    const { material: contenido, calidad } = await verificarYCorregir(
      askClaude,
      generarFn,
      tema,
      { tipo: "material_tema", modo: modoFinal, edadObjetivo: edadNumericaAproximada(nivel) },
      2,
      { onProblemaDetectado: (problemas, intento) => console.warn(`[QA temas/generar] intento ${intento}:`, problemas) }
    );

    let temaId = null;
    let gamificacion = null;
    if (modoFinal === "individual" && supabase) {
      const etiquetasFinal = normalizarEtiquetas(etiquetas);
      const { data: guardado, error: guardarError } = await supabase
        .from("mis_temas")
        .insert({ user_id: req.user.id, tema, nivel, perfil_usado: perfilDominante, contenido, origen, etiquetas: etiquetasFinal })
        .select("id")
        .single();
      if (!guardarError) {
        temaId = guardado.id;
        // La racha/medallas (utils/gamificacion.js) son el "gancho para
        // volver" del piloto — si esto falla no debe tumbar la respuesta,
        // el usuario ya generó su material.
        try {
          gamificacion = await registrarActividad(req.user.id, { contarTemas: true, etiquetaUsada: etiquetasFinal.length > 0 });
        } catch (errGam) {
          console.warn("[gamificación] no se pudo registrar actividad:", errGam.message);
        }
        // El crédito de referido (utils/referidos.js) solo se cobra si la
        // generación de verdad se guardó — igual que el límite mensual
        // normal, que tampoco se descuenta si algo falla a medias.
        if (accesoUsoBono) {
          try {
            await consumirBono(req.user.id);
          } catch (errBono) {
            console.warn("[referidos] no se pudo descontar el bono:", errBono.message);
          }
        }
      }
      // si falla el guardado no bloqueamos la respuesta — el usuario ya
      // gastó el tema generado y debe poder verlo aunque no quede en su
      // historial
    }

    res.json({
      status: "tema_generado",
      modo: modoFinal,
      enfoque: enfoqueFinal,
      perfil_usado: modoFinal === "individual" ? perfilDominante : null,
      tema_id: temaId,
      origen,
      contenido,
      calidad,
      gamificacion,
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
    const inicioMes = inicioDeMes().toISOString();

    const { count, error: countError } = await supabase
      .from("mis_temas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .eq("tipo", "tema")
      .gte("created_at", inicioMes);
    if (countError) throw new Error(countError.message);

    // Contador aparte de "Modo Examen" (schema_v28) — mismo mes, mismo
    // usuario, pero nunca se mezcla con usados_este_mes.
    const { count: countExamenes, error: countExamenesError } = await supabase
      .from("mis_temas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .eq("tipo", "examen")
      .gte("created_at", inicioMes);
    if (countExamenesError) throw new Error(countExamenesError.message);

    const gamificacion = await obtenerEstadoGamificacion(req.user.id);

    // Boost de bienvenida + créditos de referido (ver resolverAccesoIndividual
    // arriba y utils/referidos.js) — se calculan aquí también para que
    // comprador.html/tema.html puedan mostrar "3 de 3 (con boost de
    // bienvenida)" o "te quedan créditos de referido" sin adivinar nada.
    let limiteEfectivo = plan.limite_temas_mes;
    let boostActivo = false;
    if (plan.nivel === "gratis" && plan.limite_gratis_boost && estaEnMesDeRegistro(req.user.created_at)) {
      limiteEfectivo = Math.max(limiteEfectivo ?? 0, plan.limite_gratis_boost);
      boostActivo = limiteEfectivo > plan.limite_temas_mes;
    }
    const bonoDisponible = await obtenerBono(req.user.id);
    const codigoReferido = await obtenerOCrearCodigo(req.user.id, req.user.email);

    res.json({
      ...plan,
      limite_temas_mes_efectivo: limiteEfectivo,
      boost_bienvenida_activo: boostActivo,
      usados_este_mes: count || 0,
      usados_examenes_este_mes: countExamenes || 0,
      gamificacion,
      referidos: { codigo: codigoReferido, bono_disponible: bonoDisponible },
    });
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
 * POST /api/temas/mios/:id/respuestas
 * body: { respuestas: [{ indice, pregunta, respuesta, respuesta_correcta, acerto }] }
 * Guarda cómo contestó la trivia de UN tema del historial individual —
 * equivalente a POST /api/grupos/publico/:slug/temas/:temaId/respuestas
 * pero para modo individual (autenticado, sin "nombre": ya sabemos quién
 * es por el token). Es la pieza que faltaba para el seguimiento de
 * progreso/dominio (ver GET /mi-progreso): antes la trivia de un tema se
 * calificaba solo en el navegador y no dejaba ningún rastro.
 *
 * Igual que en grupos.js, "acerto" nunca se toma tal cual del cliente:
 * verificarRespuestas() lo recalcula leyendo la trivia real desde
 * mis_temas.contenido. Si falla el guardado no se le avisa a la persona —
 * ya vio su calificación en pantalla, esto es solo para su historial.
 *
 * Nota sobre alcance: esto vive por CUENTA, no por perfil/hijo — igual que
 * la racha (ver utils/gamificacion.js) — porque mis_temas no guarda con
 * qué perfil se generó cada tema, solo un snapshot de la inteligencia
 * usada. En una cuenta con varios hijos, "Mi progreso" junta a todos.
 */
router.post("/mios/:id/respuestas", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data: tema, error: temaError } = await supabase
      .from("mis_temas")
      .select("id, contenido")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });

    const { respuestas } = req.body;
    if (!Array.isArray(respuestas) || respuestas.length === 0) {
      return res.status(400).json({ error: "Faltan respuestas." });
    }

    const respuestasVerificadas = verificarRespuestas(tema.contenido, respuestas);
    const cerradas = respuestasVerificadas.filter((r) => r.acerto === true || r.acerto === false);
    const aciertos = cerradas.filter((r) => r.acerto === true).length;

    const { error } = await supabase.from("respuestas_trivia_individual").insert({
      mis_tema_id: tema.id,
      user_id: req.user.id,
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
    const { contenido, modo, temaId, incluirRespuestas } = req.body;
    if (!contenido || typeof contenido !== "object") {
      return res.status(400).json({ error: "Falta contenido (el JSON que regresó POST /api/temas/generar)." });
    }
    if (!supabase) {
      return res.status(500).json({ error: "Supabase no está configurado — no se puede subir el PDF." });
    }
    const modoFinal = modo === "grupo" ? "grupo" : "individual";
    // Por default sí incluye la hoja de respuestas — un maestro puede pedir
    // incluirRespuestas:false para armar el imprimible "en blanco" que
    // reparte al grupo (ver docstring de generarPdfTema en agents/pdfTema.js).
    const incluirRespuestasFinal = incluirRespuestas !== false;

    pdfLocalPath = await generarPdfTema(contenido, modoFinal, { incluirRespuestas: incluirRespuestasFinal });
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

const MIN_TEMAS_COMBINAR = 2;
const MAX_TEMAS_COMBINAR = 6;
// Modo Examen admite más temas de golpe (ej. "todo Matemáticas del primer
// parcial" fácil pasa de 6) — el simulador se vuelve largo pero no
// impráctico hasta unos 12.
const MAX_TEMAS_COMBINAR_EXAMEN = 12;

/**
 * POST /api/temas/combinar
 * body: { temaIds: string[], modo?: "individual"|"grupo", enfoque?: "estudio"|"examen" }
 * Junta varios temas ya generados en un solo material — pedido de piloto:
 * "juntar temas para poder estudiar exámenes". Ver agents/combinarTemas.js
 * para el prompt.
 *
 * `enfoque` (default "estudio") decide la FORMA del contenido, ortogonal a
 * `modo` (que decide de DÓNDE salen los temas y quién es dueño):
 *  - "estudio": el repaso de siempre, resumen integrado normal.
 *  - "examen" ("Modo Examen"): resumen mínimo, muchos más ejercicios, la
 *    trivia se vuelve un simulador — ver agents/combinarTemas.js.
 *
 * modo "individual" (default): los temaIds son ids de `mis_temas` del
 * usuario autenticado.
 *  - enfoque "estudio": consume un tema del límite mensual de siempre
 *    (resolverAccesoIndividual) — sin cambios de comportamiento.
 *  - enfoque "examen": consume del contador APARTE de simulacros
 *    (resolverAccesoExamen, schema_v28) y se guarda con tipo="examen".
 * En ambos casos se guarda en `mis_temas` para poder volver a verlo.
 *
 * modo "grupo": los temaIds son ids de `grupo_temas` de un grupo del
 * profesional autenticado (se verifica dueño vía `grupos.profesional_id`,
 * y que ninguno esté en pago_status "pendiente"). Igual que /generar en
 * modo grupo, aquí NO se guarda — el frontend hace un paso separado
 * (POST /api/grupos/:id/temas) si decide agregarlo a la liga, que es
 * donde ya vive el cobro de grupo (enfoque "examen" en modo grupo no tiene
 * gate propio todavía: la guía de examen del maestro se cobra igual que
 * cualquier tema de grupo).
 */
router.post("/combinar", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { temaIds, modo, enfoque } = req.body;
    const modoFinal = modo === "grupo" ? "grupo" : "individual";
    const enfoqueFinal = enfoque === "examen" ? "examen" : "estudio";
    const tope = enfoqueFinal === "examen" ? MAX_TEMAS_COMBINAR_EXAMEN : MAX_TEMAS_COMBINAR;

    if (!Array.isArray(temaIds) || temaIds.length < MIN_TEMAS_COMBINAR || temaIds.length > tope) {
      return res.status(400).json({ error: `Selecciona entre ${MIN_TEMAS_COMBINAR} y ${tope} temas para combinar.` });
    }

    let temasFuente;
    let acceso = null;

    if (modoFinal === "grupo") {
      const { data: filas, error: filasError } = await supabase
        .from("grupo_temas")
        .select("id, titulo, contenido, pago_status, grupos(profesional_id)")
        .in("id", temaIds);
      if (filasError) throw new Error(filasError.message);

      if (!filas || filas.length !== temaIds.length) {
        return res.status(404).json({ error: "Uno o más temas seleccionados ya no existen." });
      }
      if (filas.some((f) => f.grupos?.profesional_id !== req.user.id)) {
        return res.status(403).json({ error: "No tienes acceso a uno de los temas seleccionados." });
      }
      if (filas.some((f) => f.pago_status === "pendiente")) {
        return res.status(400).json({ error: "Uno de los temas seleccionados todavía no está pagado/activo." });
      }

      temasFuente = filas.map((f) => ({ tema: f.titulo, nivel: null, contenido: f.contenido }));
    } else {
      acceso = enfoqueFinal === "examen" ? await resolverAccesoExamen(req.user.id) : await resolverAccesoIndividual(req.user);
      if (!acceso.permitido) return res.status(402).json({ error: acceso.error });

      const { data: filas, error: filasError } = await supabase
        .from("mis_temas")
        .select("id, tema, nivel, contenido")
        .in("id", temaIds)
        .eq("user_id", req.user.id);
      if (filasError) throw new Error(filasError.message);

      if (!filas || filas.length !== temaIds.length) {
        return res.status(404).json({ error: "Uno o más temas seleccionados ya no existen." });
      }

      temasFuente = filas.map((f) => ({ tema: f.tema, nivel: f.nivel, contenido: f.contenido }));
    }

    const nivelPredominante = temasFuente.find((t) => t.nivel)?.nivel || "primaria_alta";
    const nombreCombinado = temasFuente.map((t) => t.tema).join(" + ");

    // Mismo wrapper de calidad que /generar (utils/revisorCalidad.js) —
    // el resultado tiene exactamente la misma forma ("material_tema"), así
    // que se valida igual: estructura, nivel de lectura y una revisión
    // barata con IA, con hasta 2 intentos.
    const generarFn = (temaOriginal, instruccionesCorrectivas) =>
      combinarTemas(temasFuente, modoFinal, enfoqueFinal, instruccionesCorrectivas);
    const { material: contenido, calidad } = await verificarYCorregir(
      askClaude,
      generarFn,
      nombreCombinado,
      { tipo: "material_tema", modo: modoFinal, edadObjetivo: edadNumericaAproximada(nivelPredominante) },
      2,
      { onProblemaDetectado: (problemas, intento) => console.warn(`[QA temas/combinar] intento ${intento}:`, problemas) }
    );

    let temaId = null;
    let gamificacion = null;
    if (modoFinal === "individual") {
      const { data: guardado, error: guardarError } = await supabase
        .from("mis_temas")
        .insert({
          user_id: req.user.id,
          tema: contenido.tema || `Repaso de ${temasFuente.length} temas`,
          nivel: nivelPredominante,
          perfil_usado: null,
          contenido,
          tipo: enfoqueFinal === "examen" ? "examen" : "tema",
          origen: acceso.origen,
          etiquetas: [],
        })
        .select("id")
        .single();
      if (!guardarError) {
        temaId = guardado.id;
        try {
          gamificacion = await registrarActividad(req.user.id, { contarTemas: true });
        } catch (errGam) {
          console.warn("[gamificación] no se pudo registrar actividad:", errGam.message);
        }
        // Solo aplica al enfoque "estudio" — resolverAccesoExamen (Modo
        // Examen) no toca créditos de referido, ese es un contador aparte.
        if (enfoqueFinal !== "examen" && acceso?.usaBono) {
          try {
            await consumirBono(req.user.id);
          } catch (errBono) {
            console.warn("[referidos] no se pudo descontar el bono:", errBono.message);
          }
        }
      }
      // igual que en /generar: si falla el guardado no bloqueamos la
      // respuesta, el usuario ya gastó el repaso y debe poder verlo aunque
      // no quede en su historial
    }

    res.json({ status: "tema_combinado", modo: modoFinal, enfoque: enfoqueFinal, tema_id: temaId, contenido, calidad, gamificacion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/temas/revisar
 * body: { imagenes: string[] }
 * Revisa la foto de un ejercicio YA RESUELTO A MANO y regresa en qué paso
 * está el error, si lo hay — pedido de piloto: "poder mandar fotos de los
 * ejercicios en las prácticas para ver en qué hay falla". Ver
 * agents/revisarEjercicio.js.
 *
 * Se gatea con el mismo límite mensual que /generar (resolverAccesoIndividual)
 * pero NO se guarda en `mis_temas` — su forma de contenido (veredicto +
 * pasos) no coincide con la de un tema normal y no debe romper el render
 * del historial. Esto es una decisión de producto abierta a cambiar: hoy
 * "cuenta" contra el límite del mes sin sumarle uso real a ese contador
 * (solo generar/combinar lo suman, al guardar en mis_temas).
 */
router.post("/revisar", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { imagenes } = req.body;
    if (!Array.isArray(imagenes) || imagenes.length === 0) {
      return res.status(400).json({ error: "Falta al menos una foto del ejercicio." });
    }

    const acceso = await resolverAccesoIndividual(req.user);
    if (!acceso.permitido) return res.status(402).json({ error: acceso.error });

    const { veredicto, pasos } = await revisarEjercicio(imagenes);

    // No se guarda nada en mis_temas aquí (ver docstring arriba), así que el
    // crédito de referido se cobra en cuanto la revisión de verdad se
    // cumplió — no hay un "guardado exitoso" más adelante que lo dispare.
    if (acceso.usaBono) {
      try {
        await consumirBono(req.user.id);
      } catch (errBono) {
        console.warn("[referidos] no se pudo descontar el bono:", errBono.message);
      }
    }

    res.json({ status: "ejercicio_revisado", veredicto, pasos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/trivia-diaria
 * Arma una trivia corta (hasta 5 preguntas) mezclando la trivia de TODOS
 * los temas que el usuario ya generó — no llama a la IA ni gasta cupo del
 * plan, solo reutiliza lo que ya tiene. Es el "gancho para volver" del
 * modo individual: da una razón para abrir la app aunque ya no necesite
 * generar nada nuevo ese día. Mismas preguntas todo el día (ver
 * utils/gamificacion.js) para que no cambien si recargan la página.
 */
router.get("/trivia-diaria", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const resultado = await armarTriviaDiaria(req.user.id);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/temas/trivia-diaria/completar
 * Marca la trivia diaria de hoy como hecha — cuenta para la racha igual
 * que generar o combinar un tema (ver utils/gamificacion.js). body
 * { aciertos, total } es opcional y solo informativo por ahora (el
 * progreso por materia se deja para una siguiente ronda).
 */
router.post("/trivia-diaria/completar", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const gamificacion = await registrarActividad(req.user.id, { triviaDiariaCompletada: true });
    res.json({ status: "trivia_diaria_completada", gamificacion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/mi-progreso
 * El "gancho" pedido para papás/alumnos: no solo racha de actividad sino
 * de DOMINIO — qué tema ya se domina y cuál sigue flojo, usando las
 * respuestas de trivia guardadas por tema (ver POST /mios/:id/respuestas).
 * Es justo lo que un chat suelto no puede dar: requiere recordar sesiones
 * anteriores, no solo la de ahorita.
 *
 * Un tema puede tener varios intentos (la persona puede volver a hacer la
 * trivia); aquí se resume cada tema por su promedio, su primer y su último
 * intento (para ver si mejoró), y se marca `necesita_repaso` cuando el
 * promedio es menor a 60%. Se ordena con los que necesitan repaso primero
 * y, dentro de cada grupo, por actividad más reciente.
 *
 * Solo entran temas con al menos un intento con preguntas cerradas
 * (opción/verdadero-falso) — las trivias 100% de preguntas abiertas no se
 * autocalifican, así que no hay con qué medir dominio.
 *
 * Mismo alcance por CUENTA (no por perfil/hijo) que el resto de
 * gamificación — ver la nota en POST /mios/:id/respuestas.
 */
router.get("/mi-progreso", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data: temas, error: temasError } = await supabase
      .from("mis_temas")
      .select("id, tema, etiquetas")
      .eq("user_id", req.user.id);
    if (temasError) throw new Error(temasError.message);

    const temaIds = (temas || []).map((t) => t.id);
    if (temaIds.length === 0) {
      return res.json({ resumen: { temas_con_trivia: 0, promedio_general: null, total_intentos: 0 }, temas: [] });
    }
    const temasPorId = Object.fromEntries((temas || []).map((t) => [t.id, t]));

    const { data: intentos, error: intentosError } = await supabase
      .from("respuestas_trivia_individual")
      .select("mis_tema_id, aciertos, total_cerradas, created_at")
      .in("mis_tema_id", temaIds)
      .order("created_at", { ascending: true });
    if (intentosError) throw new Error(intentosError.message);

    // Agrupa los intentos por tema, quedándose solo con los que sí tuvieron
    // preguntas cerradas (con esas se puede calcular un %).
    const porTema = {};
    (intentos || []).forEach((i) => {
      if (!i.total_cerradas) return;
      porTema[i.mis_tema_id] = porTema[i.mis_tema_id] || [];
      porTema[i.mis_tema_id].push({
        porcentaje: Math.round((i.aciertos / i.total_cerradas) * 100),
        fecha: i.created_at,
      });
    });

    const resultado = Object.entries(porTema)
      .map(([temaId, lista]) => {
        const tema = temasPorId[temaId];
        if (!tema) return null; // por si acaso (tema borrado, etc.)
        const promedio = Math.round(lista.reduce((sum, x) => sum + x.porcentaje, 0) / lista.length);
        return {
          mis_tema_id: temaId,
          tema: tema.tema,
          etiquetas: tema.etiquetas || [],
          intentos: lista.length,
          primer_porcentaje: lista[0].porcentaje,
          ultimo_porcentaje: lista[lista.length - 1].porcentaje,
          promedio_porcentaje: promedio,
          ultima_fecha: lista[lista.length - 1].fecha,
          necesita_repaso: promedio < 60,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.necesita_repaso !== b.necesita_repaso) return a.necesita_repaso ? -1 : 1;
        return new Date(b.ultima_fecha) - new Date(a.ultima_fecha);
      });

    const totalIntentos = resultado.reduce((sum, t) => sum + t.intentos, 0);
    const promedioGeneral = resultado.length
      ? Math.round(resultado.reduce((sum, t) => sum + t.promedio_porcentaje, 0) / resultado.length)
      : null;

    res.json({
      resumen: { temas_con_trivia: resultado.length, promedio_general: promedioGeneral, total_intentos: totalIntentos },
      temas: resultado,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
