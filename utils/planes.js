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

function inicioDeMes() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = { obtenerPlanIndividual, obtenerPlanGrupo, inicioDeMes };
