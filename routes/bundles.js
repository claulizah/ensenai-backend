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
 * POST /api/bundles
 * body: { creatorId, title }
 * Crea un paquete temático en borrador (sin precio ni cursos todavía).
 */
router.post("/", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { creatorId, title } = req.body;
    if (!creatorId || !title) return res.status(400).json({ error: "Faltan creatorId y/o title." });

    const { data, error } = await supabase
      .from("bundles")
      .insert({ creator_id: creatorId, title, price_mxn: 0, status: "borrador" })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "paquete_creado", bundle: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bundles/publico/:slug
 * Ruta pública — paquete publicado + sus cursos, para su página de compra.
 * IMPORTANTE: va antes de "/:id" o Express la confunde con un ID.
 */
router.get("/publico/:slug", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: bundle, error: bundleError } = await supabase
      .from("bundles")
      .select("id, title, price_mxn, slug, status, creators(name, slug)")
      .eq("slug", req.params.slug)
      .eq("status", "publicado")
      .single();
    if (bundleError || !bundle) {
      return res.status(404).json({ error: "Paquete no encontrado o aún no publicado." });
    }

    const { data: bundleCourses, error: bcError } = await supabase
      .from("bundle_courses")
      .select("courses(id, title, audience, slug)")
      .eq("bundle_id", bundle.id);
    if (bcError) throw new Error(bcError.message);

    res.json({ bundle, courses: (bundleCourses || []).map((bc) => bc.courses) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/bundles/:id
 * Regresa el paquete + los cursos que ya tiene agregados.
 */
/**
 * GET /api/bundles/publicos
 * Lista todos los paquetes publicados — para la página de explorar/buscar.
 * IMPORTANTE: va antes de "/:id" o Express confunde "publicos" con un ID.
 */
router.get("/publicos", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("bundles")
      .select("title, slug, price_mxn, creators(name, slug)")
      .eq("status", "publicado")
      .order("published_at", { ascending: false });
    if (error) throw new Error(error.message);

    res.json({ bundles: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: bundle, error: bundleError } = await supabase
      .from("bundles")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (bundleError) throw new Error(bundleError.message);

    const { data: bundleCourses, error: bcError } = await supabase
      .from("bundle_courses")
      .select("course_id, courses(id, title, slug, price_mxn)")
      .eq("bundle_id", req.params.id);
    if (bcError) throw new Error(bcError.message);

    res.json({ bundle, courses: (bundleCourses || []).map((bc) => bc.courses) });
  } catch (err) {
    res.status(404).json({ error: `No se encontró el paquete: ${err.message}` });
  }
});

/**
 * POST /api/bundles/:id/courses
 * body: { courseId }
 * Agrega un curso al paquete.
 */
router.post("/:id/courses", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: "Falta courseId." });

    const { error } = await supabase
      .from("bundle_courses")
      .insert({ bundle_id: req.params.id, course_id: courseId });
    if (error) throw new Error(error.message);

    res.json({ status: "curso_agregado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/bundles/:id/courses/:courseId
 * Quita un curso del paquete.
 */
router.delete("/:id/courses/:courseId", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { error } = await supabase
      .from("bundle_courses")
      .delete()
      .eq("bundle_id", req.params.id)
      .eq("course_id", req.params.courseId);
    if (error) throw new Error(error.message);

    res.json({ status: "curso_quitado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bundles/:id/publish
 * body: { price_mxn }
 * Publica el paquete — requiere al menos 2 cursos y un precio.
 */
router.post("/:id/publish", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { price_mxn } = req.body;
    if (!price_mxn || price_mxn <= 0) {
      return res.status(400).json({ error: "price_mxn es requerido y debe ser mayor a 0." });
    }

    const { data: bundleCourses, error: bcError } = await supabase
      .from("bundle_courses")
      .select("course_id")
      .eq("bundle_id", req.params.id);
    if (bcError) throw new Error(bcError.message);
    if (!bundleCourses || bundleCourses.length < 2) {
      return res.status(400).json({ error: "Un paquete necesita al menos 2 cursos antes de publicarse." });
    }

    const { data: existingBundle, error: fetchError } = await supabase
      .from("bundles")
      .select("title")
      .eq("id", req.params.id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    const slug = slugify(existingBundle.title);

    const { data, error } = await supabase
      .from("bundles")
      .update({ price_mxn, slug, status: "publicado", published_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "publicado", bundle: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
