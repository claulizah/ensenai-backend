/**
 * Lo que los maestros y psicólogos VEN de la biblioteca (2-sep-2026).
 *
 * El panel de admin (routes/admin.js) es donde la usuaria sube; esto es el
 * otro lado: solo lectura, solo lo que está publicado, para pintarlo en
 * grupo.html.
 *
 * Las ilustraciones no salen por aquí a propósito: esas no se piden, se
 * enganchan solas al material de un tema (ver utils/iconMatcher.js).
 */

const express = require("express");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");
const { elegirPlantillas } = require("../utils/matcherPlantillas");

const router = express.Router();

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Supabase no está configurado." });
    return false;
  }
  return true;
}

/**
 * GET /api/recursos/plantillas
 * Las plantillas publicadas, con filtro opcional por nivel y enfoque.
 * Una plantilla sin nivel (o sin enfoque) sirve para todos, así que el
 * filtro nunca la esconde.
 */
router.get("/plantillas", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("plantillas")
      .select("id, nombre, descripcion, categoria, nivel, enfoque, archivo_url, tipo_mime, tamano_bytes, created_at")
      .eq("publicada", true)
      .order("created_at", { ascending: false });

    // Si todavía no se corre db/schema_v38.sql, la tabla no existe: se
    // contesta lista vacía en vez de romperle el panel al maestro.
    if (error) return res.json({ plantillas: [] });

    const nivel = String(req.query.nivel || "").trim();
    const enfoque = String(req.query.enfoque || "").trim();
    const lista = (data || []).filter((p) => {
      if (nivel && p.nivel && p.nivel !== nivel) return false;
      if (enfoque && p.enfoque && p.enfoque !== enfoque) return false;
      return true;
    });

    res.json({ plantillas: lista });
  } catch (err) {
    res.json({ plantillas: [] });
  }
});

/**
 * GET /api/recursos/plantillas/para-tema
 * query: { tema, nivel?, enfoque?, maximo? }
 *
 * Las 2-3 plantillas que embonan con un tema recién generado, para pintarlas
 * DENTRO del tema en vez de obligar a la persona a ir a buscarlas a la
 * biblioteca. Mismo espíritu que las ilustraciones de utils/iconMatcher.js:
 * si no hay nada que embone, se contesta lista vacía y la pantalla ni pinta
 * la sección — más vale no ofrecer nada que ofrecer algo que no viene al caso.
 *
 * Va ANTES de las rutas con :id para que "para-tema" no se lea como un id.
 */
router.get("/plantillas/para-tema", requireBuyer, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const tema = String(req.query.tema || "").slice(0, 500);
    if (!tema.trim()) return res.json({ plantillas: [] });

    const { data, error } = await supabase
      .from("plantillas")
      .select("id, nombre, descripcion, categoria, nivel, enfoque, archivo_url, tipo_mime")
      .eq("publicada", true);
    if (error) return res.json({ plantillas: [] });

    const maximo = Math.min(Math.max(parseInt(req.query.maximo, 10) || 3, 1), 6);
    const elegidas = elegirPlantillas(tema, data || [], {
      nivel: String(req.query.nivel || "").trim() || null,
      enfoque: String(req.query.enfoque || "").trim() || null,
      maximo,
    });

    res.json({ plantillas: elegidas });
  } catch (err) {
    res.json({ plantillas: [] });
  }
});

/**
 * POST /api/recursos/plantillas/:id/descarga
 * Solo lleva la cuenta de descargas — sirve para saber cuáles vale la pena
 * seguir haciendo. Nunca falla hacia el usuario: si no se puede contar, la
 * descarga sigue su camino igual.
 */
router.post("/plantillas/:id/descarga", requireBuyer, async (req, res) => {
  res.json({ status: "ok" });
  if (!supabase) return;
  try {
    const { data } = await supabase.from("plantillas").select("descargas").eq("id", req.params.id).single();
    if (!data) return;
    await supabase
      .from("plantillas")
      .update({ descargas: (data.descargas || 0) + 1 })
      .eq("id", req.params.id);
  } catch (err) {
    /* contar descargas es un extra, no puede costarle nada a nadie */
  }
});

module.exports = router;
