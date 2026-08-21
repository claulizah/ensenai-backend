const express = require("express");
const { slugify } = require("../utils/slugify");
const { tieneFormatoValido } = require("../utils/curp");
const { preguntasPublicas, calificar } = require("../utils/quizReglas");
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
 * body: { name, email, curp, bio? }
 * El CURP se valida solo en formato (estructura correcta) — no se
 * confirma en vivo contra RENAPO/SEP todavía. Sirve como primer filtro
 * de control sobre quién puede subir contenido.
 */
router.post("/", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { name, email, curp, bio } = req.body;
    if (!name || !email) return res.status(400).json({ error: "Faltan name y/o email." });

    // Si el creador ya existe (mismo correo), regresa esa cuenta en vez de
    // intentar crear una nueva (evita el error de "duplicate key").
    const { data: existente } = await supabase.from("creators").select("*").eq("email", email).maybeSingle();
    if (existente) {
      return res.json({ status: "creador_existente", creator: existente });
    }

    // Solo exigimos CURP válido al CREAR una cuenta nueva — el "name: —"
    // que usa paquetes.html para identificar a un creador existente no
    // manda CURP, y no debe bloquearse aquí (ya se resolvió arriba).
    if (!curp || !tieneFormatoValido(curp)) {
      return res.status(400).json({ error: "El CURP no tiene un formato válido (18 caracteres)." });
    }

    const { data, error } = await supabase
      .from("creators")
      .insert({ name, email, curp: curp.trim().toUpperCase(), bio: bio || null, slug: slugify(name) })
      .select()
      .single();
    if (error) throw new Error(error.message);

    res.json({ status: "creador_creado", creator: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/creators/quiz
 * Regresa las preguntas del quiz de reglas, SIN las respuestas correctas.
 * IMPORTANTE: va antes de "/:id" o Express confunde "quiz" con un ID.
 */
router.get("/quiz", (req, res) => {
  res.json({ preguntas: preguntasPublicas() });
});

router.get("/:id", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase.from("creators").select("*").eq("id", req.params.id).single();
    if (error) throw new Error(error.message);
    res.json({ creator: data });
  } catch (err) {
    res.status(404).json({ error: `No se encontró el creador: ${err.message}` });
  }
});

/**
 * POST /api/creators/:id/quiz
 * body: { respuestas: { "1": 0, "2": 1, ... } }
 * Califica el quiz server-side y guarda el resultado — no bloquea el
 * flujo, solo queda como dato para tu revisión manual de verificación.
 */
router.post("/:id/quiz", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { respuestas } = req.body;
    if (!respuestas) return res.status(400).json({ error: "Faltan las respuestas." });

    const resultado = calificar(respuestas);

    const { error } = await supabase
      .from("creators")
      .update({
        quiz_reglas_aprobado: resultado.aprobado,
        quiz_reglas_puntaje: resultado.puntaje,
        quiz_reglas_fecha: new Date().toISOString(),
      })
      .eq("id", req.params.id);
    if (error) throw new Error(error.message);

    res.json({ status: "quiz_calificado", ...resultado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/creators/:id/courses
 * Cursos publicados de este creador (para armar sus paquetes temáticos).
 */
router.get("/:id/courses", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("courses")
      .select("id, title, slug, audience, price_mxn")
      .eq("creator_id", req.params.id)
      .eq("status", "publicado")
      .order("published_at", { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ courses: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/creators/:id/ventas
 * Resumen de ganancias del creador: total ganado, total de ventas, y
 * desglose por curso. Incluye ventas individuales (créditos) y las que
 * vinieron de un paquete temático — ambas quedan como filas en
 * course_purchases, así que no hay que sumarlas por separado.
 */
router.get("/:id/ventas", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: cursos, error: cursosError } = await supabase
      .from("courses")
      .select("id, title")
      .eq("creator_id", req.params.id);
    if (cursosError) throw new Error(cursosError.message);

    const idsCursos = (cursos || []).map((c) => c.id);
    if (idsCursos.length === 0) {
      return res.json({ total_ganado: 0, total_ventas: 0, por_curso: [] });
    }

    const { data: compras, error: comprasError } = await supabase
      .from("course_purchases")
      .select("course_id, creator_earnings_mxn")
      .in("course_id", idsCursos);
    if (comprasError) throw new Error(comprasError.message);

    const totalGanado = (compras || []).reduce((sum, c) => sum + Number(c.creator_earnings_mxn || 0), 0);
    const totalVentas = (compras || []).length;

    const porCurso = cursos.map((curso) => {
      const comprasDeEsteCurso = (compras || []).filter((c) => c.course_id === curso.id);
      return {
        course_id: curso.id,
        title: curso.title,
        ventas: comprasDeEsteCurso.length,
        ganado: comprasDeEsteCurso.reduce((sum, c) => sum + Number(c.creator_earnings_mxn || 0), 0),
      };
    });

    res.json({
      total_ganado: Math.round(totalGanado * 100) / 100,
      total_ventas: totalVentas,
      por_curso: porCurso,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/creators/publico/:slug
 * Ruta pública — perfil del creador + lista de sus cursos publicados.
 */
router.get("/publico/:slug", async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: creator, error: creatorError } = await supabase
      .from("creators")
      .select("id, name, bio, slug")
      .eq("slug", req.params.slug)
      .single();
    if (creatorError || !creator) {
      return res.status(404).json({ error: "Creador no encontrado." });
    }

    const { data: courses, error: coursesError } = await supabase
      .from("courses")
      .select("title, slug, price_mxn, audience, video_url")
      .eq("creator_id", creator.id)
      .eq("status", "publicado")
      .order("published_at", { ascending: false });
    if (coursesError) throw new Error(coursesError.message);

    res.json({ creator, courses: courses || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
