const express = require("express");
const { requireBuyer } = require("../middleware/auth");
const { canjearCodigo } = require("../utils/referidos");

const router = express.Router();

/**
 * POST /api/referidos/canjear
 * body: { codigo }
 * Canjea el código de otro usuario — le da +1 tema de regalo a quien
 * invitó (ver utils/referidos.js). Quien canjea no gana nada aparte del
 * boost normal de cuenta nueva (GET /api/temas/mi-plan ya lo aplica solo).
 * El código propio de cada quien (para compartir) se lee de
 * GET /api/temas/mi-plan → referidos.codigo, no hace falta otro endpoint.
 */
router.post("/canjear", requireBuyer, async (req, res) => {
  try {
    const { codigo } = req.body;
    const resultado = await canjearCodigo(req.user.id, codigo);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    res.json({ status: "codigo_canjeado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
