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
const { buscarIlustraciones, anotarFaltante } = require("../utils/iconMatcher");
const supabase = require("../db/supabase");
const trabajos = require("../utils/trabajos");

const router = express.Router();

/**
 * Le cuelga al material las ilustraciones de la biblioteca que le queden
 * (2-sep-2026, junto con admin.html).
 *
 * Son imágenes fijas que la usuaria sube a mano y se empatan por palabras
 * clave — no se generan con IA. Por eso esto no cuesta nada, no tarda nada
 * y no puede inventarse un sistema solar con siete planetas.
 *
 * Reglas:
 *   - Nunca lanza. Si la tabla no existe, si Supabase falla o si no hay
 *     nada que empate, el tema sale sin ilustración y ya. Jamás se le cae
 *     una generación al usuario por una imagen.
 *   - En Modo Examen no se pone ninguna: ese material es simulador puro,
 *     sin explicación (ver el bloque de `enfoque === "examen"`).
 *   - Si no encontró nada, se anota el tema en ilustraciones_faltantes para
 *     que el panel de admin muestre qué conviene ilustrar primero.
 *
 * El texto de búsqueda es el título más el resumen: el título solo se queda
 * corto ("Repaso de 3 temas") y el material completo trae demasiado ruido.
 */
async function adjuntarIlustraciones(contenido, tema, nivel, enfoque) {
  try {
    if (!contenido || enfoque === "examen") return;

    const r = contenido.resumen;
    const partes = [contenido.tema || tema || ""];
    if (r && typeof r === "object") {
      partes.push(r.que_es || "");
      (r.secciones || []).forEach((sec) => partes.push(sec.titulo || ""));
      (r.ideas_clave || []).forEach((idea) => partes.push(idea));
    } else if (typeof r === "string") {
      partes.push(r);
    }
    if (contenido.diagrama?.titulo) partes.push(contenido.diagrama.titulo);

    const texto = partes.filter(Boolean).join(" ");
    const encontradas = await buscarIlustraciones(texto, { maximo: 2 });

    if (encontradas.length) {
      contenido.ilustraciones = encontradas;
    } else {
      await anotarFaltante(contenido.tema || tema, nivel);
    }
  } catch (err) {
    console.warn("[ilustraciones] no se pudieron adjuntar:", err.message);
  }
}

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

/**
 * mis_temas.aprendido llega en db/schema_v36.sql. Si el backend se despliega
 * ANTES de correr esa migración, PostgREST contesta 42703 ("column does not
 * exist") y el historial se quedaría en blanco — con el piloto corriendo eso
 * es inaceptable. Esto lo detecta una sola vez y sigue trabajando como si
 * ningún tema estuviera aprendido hasta que la columna exista.
 */
let faltaColumnaDesde = 0; // 0 = la columna existe (o todavía no sabemos que no)
const MS_REINTENTAR_COLUMNA = 5 * 60 * 1000;
const hayColumnaAprendido = () => !faltaColumnaDesde || Date.now() - faltaColumnaDesde > MS_REINTENTAR_COLUMNA;
const esColumnaFaltante = (error) =>
  !!error && (error.code === "42703" || /column .*aprendido.* does not exist/i.test(error.message || ""));

/**
 * Lee los temas del historial de una cuenta, con o sin la columna nueva.
 * `columnas` NO debe incluir "aprendido": se agrega aquí.
 */
async function leerMisTemas(userId, columnas, { etiqueta } = {}) {
  const armar = (cols) => {
    let q = supabase.from("mis_temas").select(cols).eq("user_id", userId).order("created_at", { ascending: false });
    if (etiqueta) q = q.contains("etiquetas", [etiqueta]);
    return q;
  };

  if (hayColumnaAprendido()) {
    const { data, error } = await armar(`${columnas}, aprendido`);
    if (!error) {
      faltaColumnaDesde = 0; // ya está: se vuelve al camino normal sin reiniciar Render
      return data || [];
    }
    if (!esColumnaFaltante(error)) throw new Error(error.message);
    // No se vuelve a intentar en cada petición (sería un error por consulta),
    // pero sí cada 5 minutos: así, en cuanto se corra db/schema_v36.sql, la
    // app se recupera sola sin tener que redesplegar.
    faltaColumnaDesde = Date.now();
  }

  const { data, error } = await armar(columnas);
  if (error) throw new Error(error.message);
  return (data || []).map((t) => ({ ...t, aprendido: false }));
}

/**
 * Error de generación con código HTTP propio. Existe porque la misma
 * lógica corre en dos lugares: dentro de la petición (POST /generar) y
 * fuera de ella, en un trabajo de segundo plano (POST /generar-async).
 * En el segundo caso ya no hay un `res` a la mano cuando algo falla, así
 * que el código viaja en el error y quien lo atrapa decide qué hacer.
 */
class ErrorGeneracion extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.name = "ErrorGeneracion";
    this.status = status;
  }
}

const NIVELES_VALIDOS = ["preescolar", "primaria_baja", "primaria_alta", "secundaria", "preparatoria", "universidad"];

/**
 * Lo que se puede revisar barato y de inmediato: que venga el tema y que
 * el nivel sea uno de los conocidos. Se corre ANTES de encolar un trabajo
 * para que un error de captura se conteste al instante y no después de
 * un minuto de espera.
 */
function validarPeticionTema(cuerpo) {
  const { tema, nivel, modo, perfilId, etiquetas, detalles, enfoque } = cuerpo || {};
  if (!tema || !String(tema).trim()) throw new ErrorGeneracion(400, "Falta tema.");
  if (!NIVELES_VALIDOS.includes(nivel)) {
    throw new ErrorGeneracion(400, `nivel debe ser uno de: ${NIVELES_VALIDOS.join(", ")}.`);
  }
  return {
    tema: String(tema).trim(),
    nivel,
    // "psicoeducativo" (pensado para la liga de grupo de psicólogos, pero
    // disponible también en modo individual) cambia la FORMA del contenido
    // — actividad y "ejercicios" pasan a ser estrategias de afrontamiento y
    // práctica para casa en vez de dinámicas/tareas escolares — pero no
    // cambia el límite mensual que consume ni el JSON de salida (ver
    // agents/generateTema.js). Default "escolar" = comportamiento de siempre.
    enfoque: enfoque === "psicoeducativo" ? "psicoeducativo" : "escolar",
    modo: modo === "grupo" ? "grupo" : "individual",
    perfilId: perfilId || null,
    etiquetas: normalizarEtiquetas(etiquetas),
    detalles: detalles ? String(detalles) : "",
  };
}

/**
 * El trabajo de verdad: resuelve el perfil, cobra el límite del plan,
 * genera el material y lo guarda. Regresa exactamente el mismo objeto que
 * POST /api/temas/generar devolvía antes, para que ni el frontend viejo
 * ni el nuevo tengan que interpretar dos formas distintas.
 *
 * `imagenes` va aparte de `params` porque en el camino asíncrono no viaja
 * por la base de datos (pesa megas en base64, ver utils/trabajos.js).
 */
async function ejecutarGeneracionTema(user, params, imagenes) {
  const { tema, nivel, enfoque: enfoqueFinal, modo: modoFinal, perfilId, etiquetas, detalles } = params;

  let perfilDominante = ["linguistica"]; // default balanceado si no se indica perfil (ignorado en modo grupo)
  if (modoFinal === "individual" && supabase && perfilId) {
    const { data: perfil } = await supabase
      .from("perfiles_aprendizaje")
      .select("inteligencia_dominante")
      .eq("id", perfilId)
      .eq("user_id", user.id)
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
    const acceso = await resolverAccesoIndividual(user);
    if (!acceso.permitido) throw new ErrorGeneracion(402, acceso.error);
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

  // Va ANTES de guardar, para que las ilustraciones queden dentro del
  // contenido del tema y el historial las conserve aunque después se borre
  // una de la biblioteca.
  await adjuntarIlustraciones(contenido, tema, nivel, enfoqueFinal);

  let temaId = null;
  let gamificacion = null;
  if (modoFinal === "individual" && supabase) {
    const etiquetasFinal = normalizarEtiquetas(etiquetas);
    const { data: guardado, error: guardarError } = await supabase
      .from("mis_temas")
      .insert({ user_id: user.id, tema, nivel, perfil_usado: perfilDominante, contenido, origen, etiquetas: etiquetasFinal })
      .select("id")
      .single();
    if (!guardarError) {
      temaId = guardado.id;
      // La racha/medallas (utils/gamificacion.js) son el "gancho para
      // volver" del piloto — si esto falla no debe tumbar la respuesta,
      // el usuario ya generó su material.
      try {
        gamificacion = await registrarActividad(user.id, { contarTemas: true, etiquetaUsada: etiquetasFinal.length > 0 });
      } catch (errGam) {
        console.warn("[gamificación] no se pudo registrar actividad:", errGam.message);
      }
      // El crédito de referido (utils/referidos.js) solo se cobra si la
      // generación de verdad se guardó — igual que el límite mensual
      // normal, que tampoco se descuenta si algo falla a medias.
      if (accesoUsoBono) {
        try {
          await consumirBono(user.id);
        } catch (errBono) {
          console.warn("[referidos] no se pudo descontar el bono:", errBono.message);
        }
      }
    }
    // si falla el guardado no bloqueamos la respuesta — el usuario ya
    // gastó el tema generado y debe poder verlo aunque no quede en su
    // historial
  }

  return {
    status: "tema_generado",
    modo: modoFinal,
    enfoque: enfoqueFinal,
    perfil_usado: modoFinal === "individual" ? perfilDominante : null,
    tema_id: temaId,
    origen,
    contenido,
    calidad,
    gamificacion,
  };
}

router.post("/generar", requireBuyer, async (req, res) => {
  try {
    const params = validarPeticionTema(req.body);
    const payload = await ejecutarGeneracionTema(req.user, params, req.body.imagenes);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/temas/generar-async
 * Mismo cuerpo que /generar, más un `claveCliente` opcional (un id que
 * inventa el frontend por intento, para idempotencia).
 *
 * Encola la generación y contesta 202 en menos de un segundo con
 * { trabajo_id }. El material se genera aparte y se recoge con
 * GET /api/temas/trabajos/:id.
 *
 * Por qué existe: /generar deja la petición HTTP abierta 40-90 segundos.
 * En celular, bloquear la pantalla o cambiarse de app suspende la pestaña
 * y mata esa conexión — el tema se generaba y se guardaba, pero el usuario
 * veía un error y creía haber perdido su cupo del mes (reporte sep-2026).
 * /generar se mantiene tal cual para no romper páginas ya cacheadas.
 */
router.post("/generar-async", requireBuyer, async (req, res) => {
  try {
    if (!supabase) throw new ErrorGeneracion(500, "Supabase no está configurado.");
    const params = validarPeticionTema(req.body);
    const claveCliente = req.body.claveCliente ? String(req.body.claveCliente).slice(0, 100) : null;

    // Reintento de la MISMA petición (red intermitente, doble tap): se
    // devuelve el trabajo que ya existe en vez de encolar —y cobrar— otro.
    const yaExiste = await trabajos.buscarPorClave(req.user.id, claveCliente);
    if (yaExiste) return res.status(202).json({ trabajo_id: yaExiste.id, estado: yaExiste.estado });

    // Una sola generación a la vez por usuario: dos en paralelo gastarían
    // cupo doble y la segunda pisaría la pantalla de espera de la primera.
    const enCurso = await trabajos.trabajoSinTerminar(req.user.id);
    if (enCurso) {
      return res.status(409).json({
        error: `Ya estás generando "${enCurso.titulo}". Espera a que termine.`,
        trabajo_id: enCurso.id,
        estado: enCurso.estado,
      });
    }

    // El límite del plan se revisa ANTES de encolar para que un 402 llegue
    // al instante y no después de un minuto de espera. Se vuelve a revisar
    // dentro de la generación (es una lectura, no cobra nada dos veces).
    if (params.modo === "individual") {
      const acceso = await resolverAccesoIndividual(req.user);
      if (!acceso.permitido) return res.status(402).json({ error: acceso.error });
    }

    const trabajo = await trabajos.crearTrabajo(req.user.id, {
      modo: params.modo,
      titulo: params.tema,
      claveCliente,
      parametros: params,
      imagenes: Array.isArray(req.body.imagenes) ? req.body.imagenes : [],
    });

    res.status(202).json({ trabajo_id: trabajo.id, estado: trabajo.estado });

    // Fuera del ciclo de la petición a propósito: la respuesta ya salió.
    // Si el usuario cierra la app, bloquea el celular o se le cae la red,
    // esto sigue corriendo y el resultado queda esperándolo en la tabla.
    setImmediate(async () => {
      const usuario = req.user;
      try {
        await trabajos.marcarGenerando(trabajo.id);
        const payload = await ejecutarGeneracionTema(usuario, params, trabajos.imagenesDe(trabajo.id));
        await trabajos.marcarListo(trabajo.id, payload);
      } catch (err) {
        console.error(`[trabajos] ${trabajo.id} falló:`, err.message);
        await trabajos.marcarFallido(trabajo.id, err.message || "No se pudo generar el material.");
      }
    });
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/trabajos/ultimo
 * El trabajo más reciente de la última media hora. Es la red de seguridad
 * para cuando el frontend pierde el id: si el POST alcanzó a encolar pero
 * la respuesta nunca llegó al celular, con esto la app lo vuelve a
 * encontrar al abrirse en vez de dejar el material huérfano.
 * Se declara antes que /trabajos/:id para que "ultimo" no se lea como id.
 */
router.get("/trabajos/ultimo", requireBuyer, async (req, res) => {
  try {
    const trabajo = await trabajos.ultimoTrabajo(req.user.id);
    if (!trabajo) return res.json({ trabajo: null });
    res.json({ trabajo: aRespuestaTrabajo(trabajo) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/temas/trabajos/:id
 * Estado de una generación encolada. Mientras va en camino regresa
 * { estado: "pendiente" | "generando" }; al terminar, `resultado` trae
 * exactamente el mismo objeto que devolvía POST /api/temas/generar.
 */
router.get("/trabajos/:id", requireBuyer, async (req, res) => {
  try {
    const trabajo = await trabajos.obtenerTrabajo(req.user.id, req.params.id);
    if (!trabajo) return res.status(404).json({ error: "No encontramos esa generación." });
    res.json(aRespuestaTrabajo(trabajo));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Forma pública de un trabajo (sin los parámetros internos). */
function aRespuestaTrabajo(trabajo) {
  return {
    trabajo_id: trabajo.id,
    estado: trabajo.estado,
    modo: trabajo.modo,
    titulo: trabajo.titulo,
    error: trabajo.error || null,
    resultado: trabajo.estado === trabajos.ESTADOS.LISTO ? trabajo.resultado : null,
    created_at: trabajo.created_at,
  };
}

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
    // "aprendido" viaja en cada tema y el frontend decide cómo mostrarlos
    // (ver db/schema_v36.sql): así el historial sigue completo — un tema
    // aprendido se puede reabrir, reimprimir y volver a marcar como pendiente.
    const temas = await leerMisTemas(req.user.id, "id, tema, nivel, pdf_url, etiquetas, created_at", {
      etiqueta: req.query.etiqueta,
    });

    res.json({ temas });
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
 * body: { etiquetas?: string[], aprendido?: boolean }
 * Actualiza un tema ya guardado en el historial sin gastar cupo. Dos usos:
 *  - etiquetas: agregar/corregir etiquetas (ej. "Parcial 1") después.
 *  - aprendido: marcarlo como ya dominado (2-sep-2026). Al marcarlo, el tema
 *    sale de "Mi progreso" y sus preguntas dejan de entrar en la trivia
 *    diaria — o sea, deja de empujar la racha. Es reversible.
 * Solo se tocan los campos que vengan en el body: mandar solo "aprendido" no
 * borra las etiquetas, que era el riesgo obvio de reusar esta ruta.
 */
router.patch("/mios/:id", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const cambios = {};
    if (req.body.etiquetas !== undefined) cambios.etiquetas = normalizarEtiquetas(req.body.etiquetas);
    if (req.body.aprendido !== undefined) cambios.aprendido = !!req.body.aprendido;
    if (!Object.keys(cambios).length) {
      return res.status(400).json({ error: "No mandaste nada que actualizar." });
    }

    const columnas = cambios.aprendido !== undefined ? "id, etiquetas, aprendido" : "id, etiquetas";
    const { data, error } = await supabase
      .from("mis_temas")
      .update(cambios)
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select(columnas)
      .single();
    if (error && esColumnaFaltante(error)) {
      return res.status(503).json({ error: "Falta correr db/schema_v36.sql en Supabase para poder marcar temas como aprendidos." });
    }
    if (error || !data) return res.status(404).json({ error: "Tema no encontrado." });

    res.json({ status: "tema_actualizado", etiquetas: data.etiquetas, aprendido: data.aprendido ?? false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/temas/mios/:id
 * Borra un tema del historial individual, definitivo. Las respuestas de
 * trivia (v32) y los ejercicios marcados (v33) se van con él por el
 * "on delete cascade" de sus llaves foráneas.
 *
 * NO devuelve cupo del mes: el contador cuenta generaciones hechas, no temas
 * guardados — si borrar regresara cupo, se podría generar sin límite
 * borrando cada tema al terminar. El frontend lo advierte antes de borrar.
 */
router.delete("/mios/:id", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    // Se filtra SIEMPRE por user_id además del id: sin eso, cualquiera con
    // un id ajeno podría borrar el tema de otra persona.
    const { data, error } = await supabase
      .from("mis_temas")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: "Tema no encontrado." });

    res.json({ status: "tema_borrado", id: data.id });
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
 * GET /api/temas/mios/:id/ejercicios-resueltos
 * PUT  /api/temas/mios/:id/ejercicios-resueltos  body: { indices: number[] }
 *
 * Checkbox ligero de "ya la resolví" para la pestaña Practicar en modo
 * individual (31-ago-2026) — equivalente a POST/GET
 * /api/grupos/publico/:slug/temas/:temaId/ejercicios-marcados (modo grupo),
 * pero pensado para una sola persona en vez de un salón: en lugar de ir
 * guardando un registro por cada clic (ahí el profe necesita ver el
 * historial de cada alumno), aquí basta con UN solo estado que se
 * sobrescribe (upsert) — la persona solo necesita ver, la próxima vez que
 * abre el tema, cuáles ejercicios ya había marcado.
 *
 * Los índices se limpian contra el total real de ejercicios del tema
 * guardado (nunca se confía en lo que mande el cliente), igual que en
 * grupos.js.
 */
router.get("/mios/:id/ejercicios-resueltos", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data: tema, error: temaError } = await supabase
      .from("mis_temas")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });

    const { data, error } = await supabase
      .from("ejercicios_resueltos_individual")
      .select("indices_resueltos, total_ejercicios")
      .eq("mis_tema_id", tema.id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    res.json({
      indices_resueltos: data?.indices_resueltos || [],
      total_ejercicios: data?.total_ejercicios || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/mios/:id/ejercicios-resueltos", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const { data: tema, error: temaError } = await supabase
      .from("mis_temas")
      .select("id, contenido")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });

    const totalEjercicios = Array.isArray(tema.contenido?.ejercicios) ? tema.contenido.ejercicios.length : 0;
    const indicesRecibidos = Array.isArray(req.body.indices) ? req.body.indices : [];
    const indices = [
      ...new Set(
        indicesRecibidos.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < totalEjercicios)
      ),
    ];

    const { error } = await supabase.from("ejercicios_resueltos_individual").upsert(
      {
        mis_tema_id: tema.id,
        user_id: req.user.id,
        indices_resueltos: indices,
        total_ejercicios: totalEjercicios,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mis_tema_id" }
    );
    if (error) throw new Error(error.message);

    res.json({ status: "progreso_guardado", indices_resueltos: indices, total_ejercicios: totalEjercicios });
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

      // nivel: grupo_temas no lo guarda como columna, pero desde el 31-ago
      // viaja dentro del contenido. Sin esto, toda guía de examen de grupo
      // se redactaba y validaba para 9-12 años.
      temasFuente = filas.map((f) => ({ tema: f.titulo, nivel: f.contenido?.nivel || null, contenido: f.contenido }));
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
      {
        tipo: "material_tema",
        modo: modoFinal,
        enfoque: enfoqueFinal,
        edadObjetivo: edadNumericaAproximada(nivelPredominante),
      },
      2,
      { onProblemaDetectado: (problemas, intento) => console.warn(`[QA temas/combinar] intento ${intento}:`, problemas) }
    );

    // Modo Examen = simulador puro. El prompt ya lo pide, pero el modelo a
    // veces llena igual "esquema_visual" o la actividad, y entonces al
    // usuario le aparece una pestaña "Estudiar" con un esquema suelto o un
    // recuadro de actividad en blanco (31-ago-2026). Aquí se garantiza el
    // contrato pase lo que pase, en vez de confiar en la redacción.
    if (enfoqueFinal === "examen") {
      contenido.resumen = { que_es: "", secciones: [], pasos: [], ideas_clave: [], ojo_aqui: "", truco: "" };
      contenido.esquema_visual = "";
      contenido.diagrama = null;
      contenido.material_extra = [];
      if (modoFinal === "grupo") contenido.actividades = [];
      else contenido.actividad = null;
    }

    await adjuntarIlustraciones(contenido, contenido.tema || nombreCombinado, nivelPredominante, enfoqueFinal);

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
 * POST /api/temas/mios/:id/revisar-ejercicio
 * body: { indice: number, procedimiento?: string, imagenes?: string[] }
 *
 * "Que lo puedas resolver y la IA te diga cómo lo resolviste" (2-sep-2026).
 * Es la versión POR EJERCICIO de POST /revisar: en vez de mandar una foto
 * suelta sin contexto, aquí el servidor ya sabe QUÉ ejercicio es y cuál era
 * su solución, porque los lee del tema guardado (mis_temas.contenido). Eso
 * es lo que permite decir "te trabaste en el paso 3" en vez de solo revisar
 * aritmética a ciegas.
 *
 * El enunciado y la solución NUNCA se toman del cliente: se leen del tema
 * (por índice). Si alguien manda un índice que no existe, es 400 — no se
 * inventa un ejercicio ni se llama a la IA.
 *
 * Se puede mandar el procedimiento escrito, fotos, o las dos cosas; con
 * ninguna, 400. Mismo gateo de plan que /revisar (no suma al contador del
 * mes, igual que allá) y no guarda nada: es retroalimentación del momento.
 */
router.post("/mios/:id/revisar-ejercicio", requireBuyer, async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase no está configurado." });
  try {
    const procedimiento = typeof req.body.procedimiento === "string" ? req.body.procedimiento.trim() : "";
    const imagenes = Array.isArray(req.body.imagenes) ? req.body.imagenes : [];
    if (!procedimiento && !imagenes.length) {
      return res.status(400).json({ error: "Escribe cómo lo resolviste o sube una foto para poder revisarlo." });
    }
    // Un procedimiento larguísimo casi siempre es un pegado accidental;
    // además protege el costo de la llamada a la IA.
    if (procedimiento.length > 4000) {
      return res.status(400).json({ error: "El procedimiento es demasiado largo — resume los pasos principales." });
    }

    const indice = Number(req.body.indice);
    if (!Number.isInteger(indice) || indice < 0) {
      return res.status(400).json({ error: "Falta decir qué ejercicio es." });
    }

    const { data: tema, error: temaError } = await supabase
      .from("mis_temas")
      .select("id, nivel, contenido")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .single();
    if (temaError || !tema) return res.status(404).json({ error: "Tema no encontrado." });

    const ejercicios = Array.isArray(tema.contenido?.ejercicios) ? tema.contenido.ejercicios : [];
    const ejercicio = ejercicios[indice];
    if (!ejercicio) return res.status(400).json({ error: "Ese ejercicio ya no existe en el tema." });

    const acceso = await resolverAccesoIndividual(req.user);
    if (!acceso.permitido) return res.status(402).json({ error: acceso.error });

    const { veredicto, pasos, sugerencia } = await revisarEjercicio(imagenes, {
      enunciado: ejercicio.enunciado || "",
      solucion: ejercicio.solucion || ejercicio.respuesta || "",
      procedimiento,
      nivel: tema.nivel || "",
    });

    if (acceso.usaBono) {
      try {
        await consumirBono(req.user.id);
      } catch (errBono) {
        console.warn("[referidos] no se pudo descontar el bono:", errBono.message);
      }
    }

    res.json({ status: "ejercicio_revisado", indice, veredicto, pasos, sugerencia });
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
    // Los temas marcados como "ya lo aprendí" salen de aquí a propósito
    // (db/schema_v36.sql): "Mi progreso" es la lista de lo que falta
    // trabajar, no un archivo histórico. Se siguen contando aparte para
    // poder felicitar por ellos en pantalla.
    const todos = await leerMisTemas(req.user.id, "id, tema, etiquetas");
    const temas = todos.filter((t) => !t.aprendido);
    const aprendidos = todos.length - temas.length;

    const temaIds = temas.map((t) => t.id);
    if (temaIds.length === 0) {
      return res.json({
        resumen: { temas_con_trivia: 0, promedio_general: null, total_intentos: 0, temas_aprendidos: aprendidos },
        temas: [],
      });
    }
    const temasPorId = Object.fromEntries(temas.map((t) => [t.id, t]));

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
      resumen: {
        temas_con_trivia: resultado.length,
        promedio_general: promedioGeneral,
        total_intentos: totalIntentos,
        temas_aprendidos: aprendidos,
      },
      temas: resultado,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
