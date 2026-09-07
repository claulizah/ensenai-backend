/**
 * Armador de paquetes para vender (7-sep-2026).
 *
 * Convierte hojas que ya están en la biblioteca en un producto vendible:
 * un PDF con portada y términos de uso, más los textos del anuncio.
 *
 * Va en su propio archivo en vez de crecer routes/admin.js (que ya pasa
 * de 800 líneas) por una razón práctica: ella sube archivos por la web de
 * GitHub, y reemplazar un archivo grande por un cambio chico es justo
 * donde se pierden cosas. Aquí solo hay que subir un archivo nuevo y
 * agregar una línea a server.js.
 *
 * Se monta bajo /api/admin/paquetes y hereda el mismo candado que el
 * resto del admin: requireBuyer + requireAdmin (ADMIN_EMAILS en Render).
 *
 * Lo que este archivo NO hace: la foto del anuncio. Rasterizar páginas
 * necesita poppler, que Render no tiene, así que la foto se arma en el
 * navegador del admin con pdf.js sobre un canvas — mismo camino que la
 * homologación de imágenes, por la misma razón.
 */

const express = require("express");
const { requireBuyer } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/admin");
const supabase = require("../db/supabase");
const { armarPaquete, MAX_HOJAS } = require("../utils/paquetes");
const { listaDePlataformas, plataforma } = require("../utils/plataformasVenta");
const { generarTextosVenta } = require("../agents/textosVenta");

const router = express.Router();

const BUCKET_PLANTILLAS = "plantillas";
// Los paquetes armados van al MISMO bucket privado que las hojas. No son
// para el público: son archivos que ella baja y sube a Etsy a mano.
const CARPETA_PAQUETES = "paquetes";

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Supabase no está configurado." });
    return false;
  }
  return true;
}

/** El path real dentro del bucket, venga como venga guardado. */
function pathDe(plantilla) {
  return plantilla.storage_path || String(plantilla.archivo_url || "").replace(/^privado:/, "");
}

/**
 * Baja las hojas del bucket privado. En serie a propósito: son archivos
 * de ~100 KB y bajarlos de golpe con Promise.all sobre 60 hojas es la
 * forma más fácil de que Supabase empiece a cortar conexiones.
 */
async function bajarHojas(plantillas) {
  const hojas = [];
  for (const p of plantillas) {
    const path = pathDe(p);
    if (!path) {
      hojas.push({ nombre: p.nombre, bytes: null });
      continue;
    }
    try {
      const { data, error } = await supabase.storage.from(BUCKET_PLANTILLAS).download(path);
      if (error) throw new Error(error.message);
      const bytes = Buffer.from(await data.arrayBuffer());
      hojas.push({ nombre: p.nombre, bytes });
    } catch (err) {
      // Una hoja que no baja no tumba el paquete: armarPaquete() la
      // reporta en `avisos` y sigue con las demás.
      hojas.push({ nombre: p.nombre, bytes: null });
    }
  }
  return hojas;
}

/**
 * GET /api/admin/paquetes/plataformas
 * Las reglas de cada plataforma, para pintar el selector y saber qué
 * tamaño de foto toca. Sin esto el frontend tendría los números
 * duplicados y se desincronizarían al primer cambio.
 */
router.get("/plataformas", requireBuyer, requireAdmin, (req, res) => {
  res.json({ plataformas: listaDePlataformas(), max_hojas: MAX_HOJAS });
});

/**
 * POST /api/admin/paquetes/armar
 * body: { plantillaIds: [], titulo, subtitulo?, nivel?, plataformaId?, notas?, conTextos? }
 *
 * Arma el PDF, lo guarda en el bucket privado y devuelve una liga
 * firmada de una hora para bajarlo. Si `conTextos` no viene en false,
 * además pide los textos del anuncio.
 */
router.post("/armar", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { plantillaIds, titulo, subtitulo, nivel, plataformaId, notas } = req.body || {};

    if (!Array.isArray(plantillaIds) || plantillaIds.length === 0) {
      return res.status(400).json({ error: "Elige al menos una hoja." });
    }
    if (plantillaIds.length > MAX_HOJAS) {
      return res.status(400).json({ error: `Son ${plantillaIds.length} hojas y el tope es ${MAX_HOJAS}. Arma dos paquetes.` });
    }
    if (!titulo || !String(titulo).trim()) {
      return res.status(400).json({ error: "Ponle un nombre al paquete." });
    }

    const { data: filas, error } = await supabase
      .from("plantillas")
      .select("id, nombre, categoria, nivel, descripcion, storage_path, archivo_url")
      .in("id", plantillaIds);
    if (error) throw new Error(error.message);
    if (!filas || filas.length === 0) {
      return res.status(404).json({ error: "No encontré esas hojas en la biblioteca." });
    }

    // El orden que ella eligió en la pantalla manda sobre el que devuelva
    // la base: en un cuadernillo el orden de las hojas ES el producto.
    const porId = new Map(filas.map((f) => [String(f.id), f]));
    const ordenadas = plantillaIds.map((id) => porId.get(String(id))).filter(Boolean);

    const hojas = await bajarHojas(ordenadas);
    const paquete = await armarPaquete(hojas, {
      titulo: String(titulo).trim(),
      subtitulo: subtitulo ? String(subtitulo).trim() : "",
      nivel: nivel ? String(nivel).trim() : "",
    });

    // Nombre de archivo predecible y sin acentos: es el que ella va a ver
    // en su carpeta de descargas y el que sube a la plataforma.
    const limpio = String(titulo)
      // NFD separa la letra de su acento, y el filtro de abajo se lleva el
      // acento por no ser a-zA-Z0-9. Así "Práctica" queda "practica" sin
      // necesidad de escribir la clase de combinantes, que se corrompe al
      // pasar por editores y deja bytes basura en el repo.
      .normalize("NFD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "paquete";
    const path = `${CARPETA_PAQUETES}/${limpio}-${Date.now()}.pdf`;

    const { error: subirError } = await supabase.storage
      .from(BUCKET_PLANTILLAS)
      .upload(path, paquete.bytes, { contentType: "application/pdf", upsert: false });
    if (subirError) throw new Error(`No se pudo guardar el paquete: ${subirError.message}`);

    const { data: liga } = await supabase.storage
      .from(BUCKET_PLANTILLAS)
      .createSignedUrl(path, 3600);

    // Los textos son un extra: si la IA falla, el PDF ya está hecho y se
    // entrega igual con el motivo dentro de `textos_error`.
    let textos = null;
    let textosError = null;
    if (req.body?.conTextos !== false) {
      try {
        textos = await generarTextosVenta(ordenadas, {
          plataformaId,
          nombrePaquete: String(titulo).trim(),
          notas,
        });
      } catch (err) {
        textosError = err.message;
      }
    }

    res.json({
      status: "paquete_armado",
      pdf_url: liga?.signedUrl || null,
      storage_path: path,
      paginas: paquete.paginas,
      hojas_usadas: paquete.hojasUsadas,
      hojas_pedidas: ordenadas.length,
      peso_kb: Math.round(paquete.bytes.length / 1024),
      avisos: paquete.avisos,
      plataforma: plataforma(plataformaId),
      textos,
      textos_error: textosError,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/paquetes/textos
 * body: { plantillaIds: [], nombrePaquete, plataformaId?, notas? }
 *
 * Solo los textos, sin volver a armar el PDF. Sirve para pedir la
 * versión de otra plataforma del mismo paquete sin pagar el armado otra
 * vez — que es justo lo que se hace al publicar en Etsy y en TPT.
 */
router.post("/textos", requireBuyer, requireAdmin, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { plantillaIds, nombrePaquete, plataformaId, notas } = req.body || {};
    if (!Array.isArray(plantillaIds) || plantillaIds.length === 0) {
      return res.status(400).json({ error: "Elige al menos una hoja." });
    }

    const { data: filas, error } = await supabase
      .from("plantillas")
      .select("id, nombre, categoria, nivel, descripcion")
      .in("id", plantillaIds);
    if (error) throw new Error(error.message);

    const textos = await generarTextosVenta(filas || [], {
      plataformaId,
      nombrePaquete,
      notas,
    });
    res.json({ textos, plataforma: plataforma(plataformaId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
