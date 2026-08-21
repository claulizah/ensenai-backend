const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { transcribeVideo } = require("../agents/transcribe");
const { generateMaterials } = require("../agents/generate");
const { generarPdfEjercicios } = require("../agents/pdf");
const { buscarIconoRelevante } = require("../utils/iconMatcher");
const { slugify } = require("../utils/slugify");
const supabase = require("../db/supabase");

const router = express.Router();

const upload = multer({
  dest: path.join(__dirname, "..", "uploads_tmp"),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — cubre hasta ~10 min de video
});

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
 * GET /api/courses/icono-buscar?q=texto
 * Endpoint de prueba manual — busca qué ícono de tu biblioteca coincidiría
 * con un texto dado, sin necesidad de subir un curso completo.
 */
router.get("/icono-buscar", async (req, res) => {
  try {
    const { buscarIconoRelevante } = require("../utils/iconMatcher");
    const resultado = await buscarIconoRelevante(req.query.q || "");
    res.json({ query: req.query.q, resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/courses/precio-vigente
 * IMPORTANTE: va antes de "/:id" o Express la confunde con un ID.
 */
router.get("/precio-vigente", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("individual_course_price_mxn")
      .eq("id", 1)
      .single();
    if (error) throw new Error(error.message);
    res.json({ price_mxn: data.individual_course_price_mxn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/courses/publico/:slug
 * Ruta pública — regresa un curso PUBLICADO para su página pública.
 */
router.get("/publico/:slug", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: course, error } = await supabase
      .from("courses")
      .select("id, title, audience, price_mxn, video_url, slug, status, icono_portada_url, creators(name, slug)")
      .eq("slug", req.params.slug)
      .eq("status", "publicado")
      .single();
    if (error || !course) {
      return res.status(404).json({ error: "Curso no encontrado o aún no publicado." });
    }

    const { data: materials } = await supabase
      .from("course_materials")
      .select("*")
      .eq("course_id", course.id)
      .single();

    res.json({
      course,
      preview: materials
        ? {
            resumen: materials.resumen_editado || materials.resumen,
            glosario: materials.glosario_editado || materials.glosario,
            trivia: materials.trivia_editado || materials.trivia,
            repaso_tipo: materials.repaso_tipo,
            memorama: materials.memorama_editado || materials.memorama,
            flashcards: materials.flashcards_editado || materials.flashcards,
            rima: materials.rima_editado || materials.rima,
            incluye_ejercicios: materials.incluye_ejercicios,
            ejercicios_pdf_url: materials.ejercicios_pdf_url,
            tips: materials.tips_editado || materials.tips,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/courses/upload
 * form-data: video, creatorId, title, audience, tutorAnswers (opcional),
 *            repasoTipo ("memorama"|"flashcards"|"rima"|"ninguno" — requerido si audience="ninos")
 */
router.post("/upload", upload.single("video"), async (req, res) => {
  if (!requireSupabase(res)) return;

  const tmpFilePath = req.file?.path;

  try {
    const { creatorId, title, audience, tutorAnswers, repasoTipo, incluirEjercicios } = req.body;
    const quiereEjercicios = incluirEjercicios === "true" || incluirEjercicios === true;

    if (!req.file) return res.status(400).json({ error: "Falta el archivo de video (campo 'video')." });
    if (!creatorId) return res.status(400).json({ error: "Falta creatorId." });
    if (!title) return res.status(400).json({ error: "Falta title (título del curso)." });
    if (!["ninos", "padres", "profesionales"].includes(audience)) {
      return res.status(400).json({ error: "audience debe ser 'ninos', 'padres' o 'profesionales'." });
    }
    if (audience === "ninos" && !["memorama", "flashcards", "rima", "ninguno"].includes(repasoTipo)) {
      return res.status(400).json({ error: "Para audiencia 'ninos', repasoTipo es requerido." });
    }

    const parsedTutorAnswers = tutorAnswers ? JSON.parse(tutorAnswers) : null;

    // 1. Subir video a Supabase Storage
    const fileBuffer = fs.readFileSync(tmpFilePath);
    const storagePath = `${creatorId}/${Date.now()}-${req.file.originalname}`;
    const { error: uploadError } = await supabase.storage
      .from("course-videos")
      .upload(storagePath, fileBuffer, { contentType: req.file.mimetype });
    if (uploadError) throw new Error(`Error subiendo video a Storage: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage.from("course-videos").getPublicUrl(storagePath);
    const videoUrl = publicUrlData.publicUrl;

    // 2. Transcribir
    const { text: transcript } = await transcribeVideo(tmpFilePath);

    // 3. Generar materiales (estructura depende de audiencia + repasoTipo + ejercicios)
    const materials = await generateMaterials(transcript, audience, parsedTutorAnswers, repasoTipo, quiereEjercicios);

    // 3.5. Si pidió ejercicios, armar el PDF y subirlo a Storage
    let ejerciciosPdfUrl = null;
    if (quiereEjercicios && materials.ejercicios?.length) {
      const pdfLocalPath = await generarPdfEjercicios(title, materials.ejercicios);
      const pdfBuffer = fs.readFileSync(pdfLocalPath);
      const pdfStoragePath = `${creatorId}/ejercicios-${Date.now()}.pdf`;

      const { error: pdfUploadError } = await supabase.storage
        .from("course-videos")
        .upload(pdfStoragePath, pdfBuffer, { contentType: "application/pdf" });
      if (pdfUploadError) throw new Error(`Error subiendo PDF de ejercicios: ${pdfUploadError.message}`);

      const { data: pdfUrlData } = supabase.storage.from("course-videos").getPublicUrl(pdfStoragePath);
      ejerciciosPdfUrl = pdfUrlData.publicUrl;

      fs.unlinkSync(pdfLocalPath); // limpia el archivo temporal
    }

    // 3.6. Buscar un ícono relevante en tu biblioteca (título + resumen) —
    // si la biblioteca está vacía o nada coincide, el curso queda sin
    // portada, sin que esto rompa el resto del flujo.
    const iconoEncontrado = await buscarIconoRelevante(`${title} ${materials.resumen || ""}`);

    // 4. Guardar curso en borrador
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        creator_id: creatorId,
        title,
        audience,
        price_mxn: 0,
        video_url: videoUrl,
        transcript,
        status: "borrador",
        icono_portada_url: iconoEncontrado?.image_url || null,
      })
      .select()
      .single();
    if (courseError) throw new Error(`Error guardando curso: ${courseError.message}`);

    // 5. Guardar materiales generados
    const { data: savedMaterials, error: materialsError } = await supabase
      .from("course_materials")
      .insert({
        course_id: course.id,
        generation_mode: parsedTutorAnswers ? "con_ayuda_tutor" : "automatico",
        resumen: materials.resumen || null,
        glosario: materials.glosario || null,
        reflexion_prompt: materials.reflexion_prompt || null,
        trivia: materials.trivia || null,
        repaso_tipo: audience === "ninos" ? repasoTipo : null,
        memorama: materials.memorama || null,
        flashcards: materials.flashcards || null,
        rima: materials.rima || null,
        incluye_ejercicios: quiereEjercicios,
        ejercicios: materials.ejercicios || null,
        ejercicios_pdf_url: ejerciciosPdfUrl,
        tips: materials.tips || null,
      })
      .select()
      .single();
    if (materialsError) throw new Error(`Error guardando materiales: ${materialsError.message}`);

    res.json({ status: "borrador_creado", course, materials: savedMaterials });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
  }
});

/**
 * GET /api/courses/:id
 */
/**
 * GET /api/courses/publicos?audience=ninos|padres|profesionales (opcional)
 * Lista todos los cursos publicados — para la página de explorar/buscar.
 * IMPORTANTE: va antes de "/:id" o Express confunde "publicos" con un ID.
 */
router.get("/publicos", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    let query = supabase
      .from("courses")
      .select("title, slug, audience, price_mxn, icono_portada_url, creators(name, slug)")
      .eq("status", "publicado")
      .order("published_at", { ascending: false });

    if (req.query.audience) {
      query = query.eq("audience", req.query.audience);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    res.json({ courses: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (courseError) throw new Error(courseError.message);

    const { data: materials, error: materialsError } = await supabase
      .from("course_materials")
      .select("*")
      .eq("course_id", req.params.id)
      .single();
    if (materialsError) throw new Error(materialsError.message);

    res.json({ course, materials });
  } catch (err) {
    res.status(404).json({ error: `No se encontró el curso: ${err.message}` });
  }
});

/**
 * PATCH /api/courses/:id/materials
 */
router.patch("/:id/materials", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const {
      resumen_editado,
      glosario_editado,
      reflexion_editado,
      trivia_editado,
      memorama_editado,
      flashcards_editado,
      rima_editado,
      tips_editado,
    } = req.body;

    const updatePayload = { updated_at: new Date().toISOString() };
    if (resumen_editado !== undefined) updatePayload.resumen_editado = resumen_editado;
    if (glosario_editado !== undefined) updatePayload.glosario_editado = glosario_editado;
    if (reflexion_editado !== undefined) updatePayload.reflexion_editado = reflexion_editado;
    if (trivia_editado !== undefined) updatePayload.trivia_editado = trivia_editado;
    if (memorama_editado !== undefined) updatePayload.memorama_editado = memorama_editado;
    if (flashcards_editado !== undefined) updatePayload.flashcards_editado = flashcards_editado;
    if (rima_editado !== undefined) updatePayload.rima_editado = rima_editado;
    if (tips_editado !== undefined) updatePayload.tips_editado = tips_editado;

    const { data, error } = await supabase
      .from("course_materials")
      .update(updatePayload)
      .eq("course_id", req.params.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "materiales_actualizados", materials: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/courses/:id/publish
 */
router.post("/:id/publish", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: settings, error: settingsError } = await supabase
      .from("platform_settings")
      .select("individual_course_price_mxn")
      .eq("id", 1)
      .single();
    if (settingsError) throw new Error(`No se pudo leer el precio de la plataforma: ${settingsError.message}`);

    const { data: existingCourse, error: fetchError } = await supabase
      .from("courses")
      .select("title")
      .eq("id", req.params.id)
      .single();
    if (fetchError) throw new Error(fetchError.message);

    const slug = slugify(existingCourse.title);

    const { data, error } = await supabase
      .from("courses")
      .update({
        price_mxn: settings.individual_course_price_mxn,
        slug,
        status: "publicado",
        published_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "publicado", course: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
