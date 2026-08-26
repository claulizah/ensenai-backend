const express = require("express");
const { preguntasPublicas, calcularResultado } = require("../utils/quizInteligencias");
const { requireBuyer } = require("../middleware/auth");
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
 * POST /api/aprendizaje/resultado
 * body: { respuestas: [0,3,1,7,2,...] } — un índice (0-7) por pregunta, en
 * orden (12 respuestas). Requiere sesión de comprador. Calcula y GUARDA el
 * resultado (1 por cuenta por ahora — si ya existía, se reemplaza).
 */
router.post("/resultado", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { respuestas } = req.body;
    if (!Array.isArray(respuestas) || respuestas.length !== 12) {
      return res.status(400).json({ error: "Se necesitan las 12 respuestas." });
    }

    const resultado = calcularResultado(respuestas);

    const { error } = await supabase.from("perfiles_aprendizaje").upsert(
      {
        user_id: req.user.id,
        inteligencia_dominante: resultado.perfil_dominante,
        porcentajes: resultado.porcentajes,
        respuestas,
        fecha: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) throw new Error(error.message);

    res.json({ status: "resultado_guardado", ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/aprendizaje/mi-resultado
 * Requiere sesión de comprador. Regresa el resultado guardado, si existe.
 */
router.get("/mi-resultado", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("perfiles_aprendizaje")
      .select("*")
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!data) return res.json({ tiene_resultado: false });

    const detalle = calcularResultado(data.respuestas);

    res.json({ tiene_resultado: true, fecha: data.fecha, ...detalle });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
