const express = require("express");
const { preguntasPublicas, calcularResultado } = require("../utils/quizInteligencias");
const { requireBuyer } = require("../middleware/auth");
const { obtenerPlanIndividual } = require("../utils/planes");
const supabase = require("../db/supabase");

const router = express.Router();

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
 * GET /api/aprendizaje/quiz?version=ninos|adulto
 * Público — regresa las preguntas del quiz de inteligencias múltiples.
 * "ninos" (default): el papá/tutor describe a su hijo.
 * "adulto": la persona se autoevalúa (adolescentes/adultos).
 */
router.get("/quiz", (req, res) => {
  const version = req.query.version === "adulto" ? "adulto" : "ninos";
  res.json({ version, preguntas: preguntasPublicas(version) });
});

/**
 * GET /api/aprendizaje/perfiles
 * Lista los perfiles de aprendizaje guardados en la cuenta (uno por
 * persona — ej. un papá puede tener un perfil por cada hijo) junto con
 * el límite de perfiles de su plan actual, para que el frontend sepa si
 * puede agregar uno más.
 */
router.get("/perfiles", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("perfiles_aprendizaje")
      .select("id, nombre, inteligencia_dominante, porcentajes, fecha")
      .eq("user_id", req.user.id)
      .order("fecha", { ascending: true });
    if (error) throw new Error(error.message);

    const plan = await obtenerPlanIndividual(req.user.id);

    res.json({ perfiles: data || [], limite_perfiles: plan.limite_perfiles, plan_nivel: plan.nivel });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/aprendizaje/perfiles
 * body: { nombre, respuestas: [0,3,1,7,2,...] } — 12 respuestas (índice
 * 0-7 por pregunta). Crea un perfil NUEVO — ya no reemplaza el único
 * perfil de la cuenta. Respeta el límite de perfiles del plan actual
 * (Gratis 1, Aprendemos 3, Ilimitado 6).
 */
router.post("/perfiles", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, respuestas } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: "Falta el nombre del perfil." });
    if (!Array.isArray(respuestas) || respuestas.length !== 12) {
      return res.status(400).json({ error: "Se necesitan las 12 respuestas." });
    }

    const plan = await obtenerPlanIndividual(req.user.id);
    const { count, error: countError } = await supabase
      .from("perfiles_aprendizaje")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id);
    if (countError) throw new Error(countError.message);

    if ((count || 0) >= plan.limite_perfiles) {
      return res.status(402).json({
        error: `Tu plan actual (${plan.nivel}) permite hasta ${plan.limite_perfiles} perfil(es). Borra uno existente o mejora tu plan para agregar más.`,
      });
    }

    const resultado = calcularResultado(respuestas);

    const { data, error } = await supabase
      .from("perfiles_aprendizaje")
      .insert({
        user_id: req.user.id,
        nombre: nombre.trim(),
        inteligencia_dominante: resultado.perfil_dominante,
        porcentajes: resultado.porcentajes,
        respuestas,
      })
      .select("id, nombre, inteligencia_dominante, porcentajes, fecha")
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "perfil_creado", perfil: data, ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/aprendizaje/perfiles/:id
 * Borra un perfil propio — útil para liberar espacio cuando ya se llegó
 * al límite del plan.
 */
router.delete("/perfiles/:id", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { error } = await supabase
      .from("perfiles_aprendizaje")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id);
    if (error) throw new Error(error.message);

    res.json({ status: "perfil_borrado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
