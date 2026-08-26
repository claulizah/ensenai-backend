const express = require("express");
const { generarMaterialTema } = require("../agents/generateTema");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");

const router = express.Router();

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
 * Regresa el contenido generado — NO lo guarda. Para agregarlo a una liga
 * de grupo, el frontend llama después a POST /api/grupos/:id/temas con
 * este mismo `contenido` (mismo patrón de pasos separados que ya usa
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

    const contenido = await generarMaterialTema(tema, nivel, perfilDominante, modoFinal);

    res.json({ status: "tema_generado", modo: modoFinal, perfil_usado: modoFinal === "individual" ? perfilDominante : null, contenido });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
