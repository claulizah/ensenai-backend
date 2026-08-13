const express = require("express");
const { slugify } = require("../utils/slugify");
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
 * POST /api/creators
 * body: { name, email }
 *
 * Registro simple de creador. La verificación de credenciales (manual,
 * o vía cédula/SEP más adelante) queda pendiente — credential_verified
 * empieza en false por default.
 */
router.post("/", async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "Faltan name y/o email." });
    }

    // Si ya existe un creador con este correo, lo regresamos en vez de
    // intentar crear uno nuevo (evita el error de llave única y deja
    // que un creador que regresa siga usando su cuenta existente).
    const { data: existing, error: findError } = await supabase
      .from("creators")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (findError) throw new Error(findError.message);

    if (existing) {
      return res.json({ status: "creador_existente", creator: existing });
    }

    const { data, error } = await supabase
      .from("creators")
      .insert({ name, email, slug: slugify(name) })
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json({ status: "creador_creado", creator: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/creators/:id
 */
router.get("/:id", async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { data, error } = await supabase
      .from("creators")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) throw new Error(error.message);

    res.json({ creator: data });
  } catch (err) {
    res.status(404).json({ error: `No se encontró el creador: ${err.message}` });
  }
});

module.exports = router;
