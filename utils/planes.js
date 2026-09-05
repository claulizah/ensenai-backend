const supabase = require("../db/supabase");

/**
 * Modelo de planes (26 de agosto, reemplaza freemium + créditos sueltos +
 * founder pricing de schema_v20/v21 por una estructura de 3 escalones,
 * más simple de explicar en una página de precios):
 *
 *   Gratis      — sin suscripción activa.
 *   Aprendemos  — suscripción de nivel "aprendemos": generaciones limitadas
 *                 al mes, más perfiles/grupos que el gratis.
 *   Ilimitado   — suscripción de nivel "ilimitado": generaciones sin límite,
 *                 el máximo de perfiles/grupos.
 *
 * "Perfiles" (individual) = personas distintas guardadas en la cuenta (ej.
 * un papá con 2 hijos). "Grupos" (profesional) = salones/consultorios
 * distintos que puede administrar un mismo maestro/psicólogo — ya existía
 * la posibilidad técnica de crear varios grupos, ahora se limita por plan.
 *
 * Los precios y límites viven en platform_settings, editables sin tocar
 * código. Los valores en código son solo el fallback si por alguna razón
 * la fila no tiene el dato (no debería pasar una vez corrida la migración).
 */

async function obtenerSettings() {
  const { data, error } = await supabase.from("platform_settings").select("*").eq("id", 1).single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Plan individual activo del usuario (papás/adolescentes/adultos).
 * Regresa { nivel, precio_mxn, limite_temas_mes, limite_perfiles,
 * limite_examenes_mes }. limite_temas_mes/limite_examenes_mes = null
 * significa ilimitado.
 *
 * limite_examenes_mes (schema_v28) es un contador APARTE del de temas —
 * "Modo Examen" (combinar con enfoque:"examen", ver agents/combinarTemas.js
 * y POST /api/temas/combinar) gasta de este límite, no del de temas
 * normales. Un repaso combinado en enfoque:"estudio" (el de siempre) sigue
 * gastando limite_temas_mes, sin cambios.
 */
async function obtenerPlanIndividual(userId) {
  const settings = await obtenerSettings();

  const { data: sus } = await supabase
    .from("suscripciones")
    .select("nivel")
    .eq("user_id", userId)
    .eq("tipo", "individual")
    .eq("status", "activa")
    .maybeSingle();

  if (sus?.nivel === "ilimitado") {
    return {
      nivel: "ilimitado",
      precio_mxn: settings.plan_individual_ilimitado_precio_mxn,
      limite_temas_mes: null,
      limite_perfiles: settings.plan_individual_ilimitado_limite_perfiles,
      limite_examenes_mes: null,
      // Techo de uso justo (schema_v44). NO es una cuota comercial: son
      // ~10 temas diarios todos los días, que nadie legítimo alcanza. Es
      // el seguro contra la cuenta compartida entre veinte maestros o el
      // script desbocado, que con "ilimitado" literal costaba miles de
      // pesos al mes. Si la columna no existe todavía, queda en null y el
      // comportamiento es exactamente el de antes.
      tope_justo: settings.tope_justo_temas_individual ?? null,
    };
  }
  if (sus?.nivel === "aprendemos") {
    return {
      nivel: "aprendemos",
      precio_mxn: settings.plan_individual_aprendemos_precio_mxn,
      limite_temas_mes: settings.plan_individual_aprendemos_limite_temas,
      limite_perfiles: settings.plan_individual_aprendemos_limite_perfiles,
      limite_examenes_mes: settings.plan_individual_aprendemos_limite_examenes,
    };
  }
  return {
    nivel: "gratis",
    precio_mxn: 0,
    limite_temas_mes: settings.plan_gratis_limite_temas_individual,
    limite_perfiles: settings.plan_gratis_limite_perfiles,
    limite_examenes_mes: settings.plan_gratis_limite_examenes,
    // "Boost" de bienvenida (schema_v30, gancho de crecimiento ago-2026):
    // cuentas Gratis nuevas pueden generar hasta este límite en vez del
    // normal, pero SOLO durante el mes calendario en que se registraron —
    // ver resolverAccesoIndividual en routes/temas.js, que es quien decide
    // si aplica según la fecha de creación de la cuenta.
    limite_gratis_boost: settings.plan_gratis_boost_limite_temas,
  };
}

/**
 * Plan de grupo activo del profesional (maestro/psicólogo). Regresa
 * { nivel, precio_mxn, limite_temas_mes, limite_grupos }.
 * Sin suscripción, el profesional sigue pudiendo usar el mecanismo ya
 * existente de "primer tema gratis por grupo" (routes/grupos.js), solo
 * que limitado a 1 grupo hasta que se suscriba.
 */
async function obtenerPlanGrupo(userId) {
  const settings = await obtenerSettings();

  const { data: sus } = await supabase
    .from("suscripciones")
    .select("nivel")
    .eq("user_id", userId)
    .eq("tipo", "grupo")
    .eq("status", "activa")
    .maybeSingle();

  if (sus?.nivel === "ilimitado") {
    return {
      nivel: "ilimitado",
      precio_mxn: settings.plan_grupo_ilimitado_precio_mxn,
      limite_temas_mes: null,
      limite_grupos: settings.plan_grupo_ilimitado_limite_grupos,
      tope_justo: settings.tope_justo_temas_grupo ?? null,
    };
  }
  if (sus?.nivel === "aprendemos") {
    return {
      nivel: "aprendemos",
      precio_mxn: settings.plan_grupo_aprendemos_precio_mxn,
      limite_temas_mes: settings.plan_grupo_aprendemos_limite_temas,
      limite_grupos: settings.plan_grupo_aprendemos_limite_grupos,
    };
  }
  return {
    nivel: "gratis",
    precio_mxn: 0,
    limite_temas_mes: null, // sin plan, el límite real es el mecanismo de "primer tema gratis" por grupo
    limite_grupos: settings.plan_gratis_limite_grupos,
  };
}

/**
 * Los precios de todos los planes, leídos de platform_settings.
 *
 * Existe por un problema real que se encontró antes de lanzar: los precios
 * estaban escritos A MANO dentro de los mensajes de error ("Ilimitado por
 * $129 MXN/mes"). Cuando Claudia los bajó, la página de ventas quedó en
 * $59/$99 y los mensajes siguieron diciendo $79/$129 — el cliente leía un
 * precio, aceptaba otros términos y se topaba con un tercer número justo
 * en el momento de decidir si pagaba.
 *
 * Cualquier texto que mencione un precio tiene que salir de aquí. Así,
 * cambiar el precio en platform_settings lo cambia en todos lados.
 *
 * Nunca lanza: si la consulta falla, devuelve null y quien lo llame arma
 * su mensaje sin cifras, que es mejor que decir una equivocada.
 */
async function obtenerPrecios() {
  try {
    const s = await obtenerSettings();
    return {
      individual: {
        esencial: s.plan_individual_aprendemos_precio_mxn,
        ilimitado: s.plan_individual_ilimitado_precio_mxn,
        esencial_limite: s.plan_individual_aprendemos_limite_temas,
      },
      grupo: {
        esencial: s.plan_grupo_aprendemos_precio_mxn,
        ilimitado: s.plan_grupo_ilimitado_precio_mxn,
        esencial_limite: s.plan_grupo_aprendemos_limite_temas,
      },
    };
  } catch (err) {
    return null;
  }
}

function inicioDeMes() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = {
  obtenerPrecios,
  obtenerPlanIndividual,
  obtenerPlanGrupo,
  inicioDeMes,
};
