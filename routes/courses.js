const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { transcribeVideo } = require("../agents/transcribe");
const { generateMaterials } = require("../agents/generate");
const { slugify } = require("../utils/slugify");
const supabase = require("../db/supabase");

const router = express.Router();

const upload = multer({
  dest: path.join(__dirname, "..", "uploads_tmp"),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB — cubre hasta ~10 min de video, el audio se comprime aparte para Whisper
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
 * POST /api/courses/upload
 * form-data: video (archivo), creatorId (uuid), title (texto),
 *            audience ("ninos"|"padres"|"profesionales"),
 *            tutorAnswers (JSON string, opcional)
 *
 * Sube el video a Supabase Storage, transcribe, genera materiales,
 * y guarda todo en la base de datos como curso en estado "borrador".
 */
router.post("/upload", upload.single("video"), async (req, res) => {
  if (!requireSupabase(res)) return;

  const tmpFilePath = req.file?.path;

  try {
    const { creatorId, title, audience, tutorAnswers } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Falta el archivo de video (campo 'video')." });
    }
    if (!creatorId) {
      return res.status(400).json({ error: "Falta creatorId." });
    }
    if (!title) {
      return res.status(400).json({ error: "Falta title (título del curso)." });
    }
    if (!["ninos", "padres", "profesionales"].includes(audience)) {
      return res.status(400).json({ error: "audience debe ser 'ninos', 'padres' o 'profesionales'." });
    }

    const parsedTutorAnswers = tutorAnswers ? JSON.parse(tutorAnswers) : null;

    // 1. Subir el video a Supabase Storage (bucket "course-videos", créalo antes en el dashboard)
    const fileBuffer = fs.readFileSync(tmpFilePath);
    const storagePath = `${creatorId}/${Date.now()}-${req.file.originalname}`;

    const { error: uploadError } = await supabase.storage
      .from("course-videos")
      .upload(storagePath, fileBuffer, { contentType: req.file.mimetype });

    if (uploadError) {
      throw new Error(`Error subiendo video a Storage: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from("course-videos")
      .getPublicUrl(storagePath);
    const videoUrl = publicUrlData.publicUrl;

    // 2. Transcribir
    const { text: transcript } = await transcribeVideo(tmpFilePath);

    // 3. Generar materiales (automático si no hay tutorAnswers, con ayuda si sí)
    const materials = await generateMaterials(transcript, audience, parsedTutorAnswers);

    // 4. Guardar curso en estado "borrador"
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        creator_id: creatorId,
        title,
        audience,
        price_mxn: 0, // se define al publicar
        video_url: videoUrl,
        transcript,
        status: "borrador",
      })
      .select()
      .single();

    if (courseError) throw new Error(`Error guardando curso: ${courseError.message}`);

    // 5. Guardar los materiales generados, ligados al curso
    const { data: savedMaterials, error: materialsError } = await supabase
      .from("course_materials")
      .insert({
        course_id: course.id,
        generation_mode: parsedTutorAnswers ? "con_ayuda_tutor" : "automatico",
        resumen: materials.resumen || null,
        trivia: materials.trivia || null,
        memorama: materials.memorama || null,
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
    // limpia el archivo temporal sin importar si hubo error
    if (tmpFilePath && fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
  }
});

/**
 * GET /api/courses/precio-vigente
 * Regresa el precio individual actual (configurado en platform_settings).
 * IMPORTANTE: esta ruta debe ir ANTES de "/:id" o Express la confunde con un ID.
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
 * Regresa un curso publicado (con el nombre del creador) y una vista previa
 * del resumen, para la página pública del curso (curso.html).
 * IMPORTANTE: esta ruta debe ir ANTES de "/:id" o Express la confunde con un ID.
 */
router.get("/publico/:slug", async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("*, creators(name)")
      .eq("slug", req.params.slug)
      .eq("status", "publicado")
      .single();

    if (courseError || !course) {
      return res.status(404).json({ error: "Curso no encontrado." });
    }

    // Por default NO se manda la liga del video — solo se agrega si
    // el visitante tiene sesión y ya compró este curso.
    let tieneAcceso = false;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (token) {
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        const { data: compra } = await supabase
          .from("course_purchases")
          .select("id")
          .eq("user_id", userData.user.id)
          .eq("course_id", course.id)
          .maybeSingle();
        tieneAcceso = !!compra;
      }
    }

    const cursoParaEnviar = { ...course, video_url: tieneAcceso ? course.video_url : null };

    const { data: materials } = await supabase
      .from("course_materials")
      .select("resumen, resumen_editado")
      .eq("course_id", course.id)
      .single();

    const preview = {
      resumen: materials?.resumen_editado || materials?.resumen || null,
    };

    res.json({ course: cursoParaEnviar, preview, tieneAcceso });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/**
 * GET /api/courses/:id
 * Regresa el curso + sus materiales, para la pantalla de revisión/edición.
 */
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
 * body: { resumen_editado?, trivia_editado?, memorama_editado?, tips_editado? }
 *
 * Guarda las ediciones del creador sin tocar la versión original generada por IA.
 */
router.patch("/:id/materials", async (req, res) => {
  if (!requireSupabase(res)) return;

  try {
    const { resumen_editado, trivia_editado, memorama_editado, tips_editado } = req.body;

    const { data, error } = await supabase
      .from("course_materials")
      .update({
        resumen_editado,
        trivia_editado,
        memorama_editado,
        tips_editado,
        updated_at: new Date().toISOString(),
      })
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
 *
 * Publica el curso: le asigna slug público y lo marca como publicado.
 * El precio individual ya NO lo define el creador — se toma el valor
 * fijo de platform_settings (editable desde Supabase, no desde la app).
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
