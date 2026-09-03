/**
 * Panel de administración de la biblioteca (2-sep-2026).
 *
 * "¿Podría tener un admin donde pueda ir subiendo plantillas que haga, svg
 * y demás recursos?" — pedido de la usuaria.
 *
 * Dos cosas distintas viven aquí:
 *
 *   ILUSTRACIONES (icon_library) — se enganchan solas a un tema por
 *   palabras clave (utils/iconMatcher.js). El maestro nunca las pide.
 *
 *   PLANTILLAS (plantillas) — el maestro las busca y las descarga tal cual.
 *   Formatos, fichas, planeaciones.
 *
 * Todo lo que escribe pasa por requireBuyer + requireAdmin: el correo se
 * compara contra ADMIN_EMAILS de Render, no contra nada que venga en el
 * body (ver middleware/admin.js).
 *
 * Los archivos van al bucket público `biblioteca` (db/schema_v38.sql). Los
 * SVG se limpian ANTES de guardarse — ver utils/archivosBiblioteca.js.
 */

const express = require("express");
const { requireBuyer } = require("../middleware/auth");
const { requireAdmin, esAdmin } = require("../middleware/admin");
const {
  TIPOS_ILUSTRACION,
  TIPOS_PLANTILLA,
  leerArchivoSubido,
  rutaEnBucket,
  normalizarClaves,
} = require("../utils/archivosBiblioteca");
const supabase = require("../db/supabase");

const router = express.Router();
const BUCKET = "biblioteca";

const CATEGORIAS_ILUSTRACION = [
  "emociones",
  "cuerpo_vida",
  "tierra_espacio",
  "matematicas",
  "mexico",
  "lenguaje",
  "convivencia",
  "otros",
];

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Supabase no está configurado. Revisa SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY." });
    return false;
  }
  return true;
}

/** Sube el buffer al bucket y devuelve { url, path }. */
async function subirArchivo(carpeta, nombre, buffer, extension, tipoMime) {
  const path = rutaEnBucket(carpeta, nombre, extension);
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: tipoMime,
    upsert: false,
  });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Borra del bucket sin tumbar la petición si el archivo ya no está. */
async function borrarArchivo(path) {
  if (!path) return;
  try {
    await supabase.storage.from(BUCKET).remove([path]);
  } catch (err) {
    /* la fila es lo que importa; un archivo huérfano no rompe nada */
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Quién soy
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/soy-admin
 * Lo llama admin.html al abrir, para saber si pinta el panel o manda a la
 * pantalla de "esto no es para ti". Requiere sesión pero NO requireAdmin:
 * tiene que poder contestar `false` sin dar 403.
 */
router.get("/soy-admin", requireBuyer, (req, res) => {
  res.json({ admin: esAdmin(req.user) });
});

/* ═══════════════════════════════════════════════════════════════════════
   Ilustraciones
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/ilustraciones?categoria=&q=
 * Lista completa (incluidas las desactivadas, que el público no ve).
 */
router.get("/ilustraciones", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    let consulta = supabase
      .from("icon_library")
      .select("id, nombre, descripcion, categoria, palabras_clave, image_url, storage_path, tipo_mime, tamano_bytes, licencia, autor, fuente_url, activa, created_at")
      .order("created_at", { ascending: false });

    if (req.query.categoria && CATEGORIAS_ILUSTRACION.includes(req.query.categoria)) {
      consulta = consulta.eq("categoria", req.query.categoria);
    }
    const { data, error } = await consulta;
    if (error) throw new Error(error.message);

    // La búsqueda por texto se hace aquí y no en SQL a propósito: la
    // biblioteca son decenas de filas, no miles, y así busca igual en el
    // nombre que en las palabras clave sin pelearse con los acentos.
    const q = String(req.query.q || "").trim().toLowerCase();
    const lista = !q
      ? data || []
      : (data || []).filter((i) => {
          const heno = [i.nombre, i.descripcion, ...(i.palabras_clave || [])].join(" ").toLowerCase();
          return heno.includes(q);
        });

    res.json({ ilustraciones: lista });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/ilustraciones
 * body: { nombre, categoria, palabrasClave, descripcion?, licencia?, autor?,
 *         fuenteUrl?, archivoBase64, tipoMime }
 *
 * El archivo viaja en base64 dentro del JSON, igual que las fotos de
 * apuntes en routes/temas.js — así no hace falta meter multer solo para
 * esto, y el límite de 12 MB de express.json ya está puesto en server.js.
 */
router.post("/ilustraciones", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, categoria, palabrasClave, descripcion, licencia, autor, fuenteUrl, archivoBase64, tipoMime } = req.body || {};

    const nombreLimpio = String(nombre || "").trim();
    if (!nombreLimpio) return res.status(400).json({ error: "Ponle un nombre a la ilustración." });
    if (!CATEGORIAS_ILUSTRACION.includes(categoria)) {
      return res.status(400).json({ error: "Elige una categoría de la lista." });
    }
    const claves = normalizarClaves(palabrasClave);
    if (claves.length === 0) {
      return res.status(400).json({ error: "Necesita al menos una palabra clave — es lo que la conecta con los temas." });
    }

    const archivo = leerArchivoSubido(archivoBase64, tipoMime, TIPOS_ILUSTRACION);
    if (archivo.error) return res.status(400).json({ error: archivo.error });

    const { url, path } = await subirArchivo("ilustraciones", nombreLimpio, archivo.buffer, archivo.extension, tipoMime);

    const { data, error } = await supabase
      .from("icon_library")
      .insert({
        nombre: nombreLimpio.slice(0, 200),
        descripcion: String(descripcion || "").trim().slice(0, 500) || null,
        categoria,
        palabras_clave: claves,
        image_url: url,
        storage_path: path,
        tipo_mime: tipoMime,
        tamano_bytes: archivo.buffer.length,
        licencia: String(licencia || "").trim().slice(0, 120) || null,
        autor: String(autor || "").trim().slice(0, 200) || null,
        fuente_url: String(fuenteUrl || "").trim().slice(0, 500) || null,
        activa: true,
      })
      .select()
      .single();

    if (error) {
      await borrarArchivo(path); // no dejar el archivo suelto si falló la fila
      throw new Error(error.message);
    }

    res.status(201).json({ ilustracion: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/admin/ilustraciones/:id
 * Cambia los datos, nunca el archivo — para cambiar la imagen se sube otra
 * y se borra esta (así la URL vieja no queda apuntando a algo distinto de
 * lo que ya se pintó en un tema guardado).
 */
router.patch("/ilustraciones/:id", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, descripcion, categoria, palabrasClave, licencia, autor, fuenteUrl, activa } = req.body || {};
    const cambios = {};

    if (nombre !== undefined) {
      const limpio = String(nombre).trim();
      if (!limpio) return res.status(400).json({ error: "El nombre no puede quedar vacío." });
      cambios.nombre = limpio.slice(0, 200);
    }
    if (descripcion !== undefined) cambios.descripcion = String(descripcion).trim().slice(0, 500) || null;
    if (categoria !== undefined) {
      if (!CATEGORIAS_ILUSTRACION.includes(categoria)) return res.status(400).json({ error: "Esa categoría no existe." });
      cambios.categoria = categoria;
    }
    if (palabrasClave !== undefined) {
      const claves = normalizarClaves(palabrasClave);
      if (claves.length === 0) return res.status(400).json({ error: "Déjale al menos una palabra clave." });
      cambios.palabras_clave = claves;
    }
    if (licencia !== undefined) cambios.licencia = String(licencia).trim().slice(0, 120) || null;
    if (autor !== undefined) cambios.autor = String(autor).trim().slice(0, 200) || null;
    if (fuenteUrl !== undefined) cambios.fuente_url = String(fuenteUrl).trim().slice(0, 500) || null;
    if (activa !== undefined) cambios.activa = !!activa;

    if (Object.keys(cambios).length === 0) return res.status(400).json({ error: "No mandaste nada que cambiar." });
    cambios.actualizada_en = new Date().toISOString();

    const { data, error } = await supabase.from("icon_library").update(cambios).eq("id", req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: "No encontramos esa ilustración." });

    res.json({ ilustracion: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/admin/ilustraciones/:id — borra la fila y el archivo. */
router.delete("/ilustraciones/:id", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: fila } = await supabase.from("icon_library").select("id, storage_path").eq("id", req.params.id).single();
    if (!fila) return res.status(404).json({ error: "No encontramos esa ilustración." });

    const { error } = await supabase.from("icon_library").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    await borrarArchivo(fila.storage_path);

    res.json({ status: "borrada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   Plantillas
   ═══════════════════════════════════════════════════════════════════════ */

/** GET /api/admin/plantillas — todas, publicadas o no. */
router.get("/plantillas", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("plantillas")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    res.json({ plantillas: data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/plantillas
 * body: { nombre, descripcion?, categoria?, nivel?, enfoque?, publicada?,
 *         archivoBase64, tipoMime }
 */
router.post("/plantillas", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, descripcion, categoria, nivel, enfoque, publicada, archivoBase64, tipoMime } = req.body || {};

    const nombreLimpio = String(nombre || "").trim();
    if (!nombreLimpio) return res.status(400).json({ error: "Ponle un nombre a la plantilla." });

    const archivo = leerArchivoSubido(archivoBase64, tipoMime, TIPOS_PLANTILLA);
    if (archivo.error) return res.status(400).json({ error: archivo.error });

    const { url, path } = await subirArchivo("plantillas", nombreLimpio, archivo.buffer, archivo.extension, tipoMime);

    const { data, error } = await supabase
      .from("plantillas")
      .insert({
        nombre: nombreLimpio.slice(0, 200),
        descripcion: String(descripcion || "").trim().slice(0, 800) || null,
        categoria: String(categoria || "otros").trim().slice(0, 60) || "otros",
        nivel: String(nivel || "").trim() || null,
        enfoque: enfoque === "escolar" || enfoque === "psicoeducativo" ? enfoque : null,
        archivo_url: url,
        storage_path: path,
        tipo_mime: tipoMime,
        tamano_bytes: archivo.buffer.length,
        publicada: !!publicada,
      })
      .select()
      .single();

    if (error) {
      await borrarArchivo(path);
      throw new Error(error.message);
    }

    res.status(201).json({ plantilla: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /api/admin/plantillas/:id */
router.patch("/plantillas/:id", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { nombre, descripcion, categoria, nivel, enfoque, publicada } = req.body || {};
    const cambios = {};

    if (nombre !== undefined) {
      const limpio = String(nombre).trim();
      if (!limpio) return res.status(400).json({ error: "El nombre no puede quedar vacío." });
      cambios.nombre = limpio.slice(0, 200);
    }
    if (descripcion !== undefined) cambios.descripcion = String(descripcion).trim().slice(0, 800) || null;
    if (categoria !== undefined) cambios.categoria = String(categoria).trim().slice(0, 60) || "otros";
    if (nivel !== undefined) cambios.nivel = String(nivel).trim() || null;
    if (enfoque !== undefined) cambios.enfoque = enfoque === "escolar" || enfoque === "psicoeducativo" ? enfoque : null;
    if (publicada !== undefined) cambios.publicada = !!publicada;

    if (Object.keys(cambios).length === 0) return res.status(400).json({ error: "No mandaste nada que cambiar." });
    cambios.actualizada_en = new Date().toISOString();

    const { data, error } = await supabase.from("plantillas").update(cambios).eq("id", req.params.id).select().single();
    if (error || !data) return res.status(404).json({ error: "No encontramos esa plantilla." });

    res.json({ plantilla: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/admin/plantillas/:id */
router.delete("/plantillas/:id", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data: fila } = await supabase.from("plantillas").select("id, storage_path").eq("id", req.params.id).single();
    if (!fila) return res.status(404).json({ error: "No encontramos esa plantilla." });

    const { error } = await supabase.from("plantillas").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    await borrarArchivo(fila.storage_path);

    res.json({ status: "borrada" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   Lista de lo que falta ilustrar
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * GET /api/admin/faltantes
 * Los temas que se generaron y no encontraron ninguna ilustración, de más
 * pedido a menos. Es la lista de la siguiente tanda, escrita sola.
 */
router.get("/faltantes", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase
      .from("ilustraciones_faltantes")
      .select("id, tema_ejemplo, nivel, veces, ultima_vez, resuelta")
      .eq("resuelta", false)
      .order("veces", { ascending: false })
      .limit(100);
    // La tabla puede no existir todavía si no se ha corrido schema_v38:
    // eso no es motivo para tumbar el panel entero.
    if (error) return res.json({ faltantes: [], aviso: "Todavía no corres db/schema_v38.sql." });
    res.json({ faltantes: data || [] });
  } catch (err) {
    res.json({ faltantes: [], aviso: "No se pudo leer la lista de faltantes." });
  }
});

/** PATCH /api/admin/faltantes/:id — marcar como ya resuelto. */
router.patch("/faltantes/:id", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { error } = await supabase
      .from("ilustraciones_faltantes")
      .update({ resuelta: req.body?.resuelta !== false })
      .eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
