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
 * Dónde vive cada archivo (db/schema_v38.sql y v40):
 *   * ilustraciones → bucket PÚBLICO `biblioteca`: se pintan dentro del
 *     material del alumno en g.html, que no tiene sesión, y se incrustan
 *     en el PDF. Tienen que poder abrirse sin credenciales.
 *   * plantillas → bucket PRIVADO `plantillas`: son lo que se vende. No
 *     tienen URL pública; el backend firma una liga corta después de
 *     revisar el plan (ver routes/recursos.js).
 *
 * Los SVG se limpian ANTES de guardarse — ver utils/archivosBiblioteca.js.
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
const crypto = require("crypto");
const supabase = require("../db/supabase");
const { describirPlantilla } = require("../agents/describirPlantilla");
const { describirIlustracion } = require("../agents/describirIlustracion");
const { ponerMarca } = require("../utils/marcaAgua");

const router = express.Router();
const BUCKET = "biblioteca";           // público: ilustraciones
const BUCKET_PLANTILLAS = "plantillas"; // privado: plantillas (schema_v40)

/**
 * El bucket se decide por la carpeta, no por un parámetro extra, para que
 * sea imposible guardar una plantilla en el bucket público por descuido.
 */
function bucketDe(carpetaOPath) {
  return String(carpetaOPath || "").startsWith("plantillas") ? BUCKET_PLANTILLAS : BUCKET;
}

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

/**
 * Sube el buffer al bucket que le toca y devuelve { url, path }.
 *
 * Para lo público, `url` es la URL de siempre. Para el bucket privado no
 * existe tal cosa, así que se guarda el marcador "privado:<path>": la
 * columna archivo_url es NOT NULL y así, si alguna vez se filtrara una
 * fila completa, lo que se ve no es una liga descargable sino un texto que
 * no lleva a ningún lado.
 */
async function subirArchivo(carpeta, nombre, buffer, extension, tipoMime) {
  const bucket = bucketDe(carpeta);
  const path = rutaEnBucket(carpeta, nombre, extension);
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: tipoMime,
    upsert: false,
  });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);

  if (bucket === BUCKET_PLANTILLAS) return { url: `privado:${path}`, path };

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Borra del bucket sin tumbar la petición si el archivo ya no está. */
async function borrarArchivo(path) {
  if (!path) return;
  try {
    await supabase.storage.from(bucketDe(path)).remove([path]);
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
 * ¿Ya está esta misma imagen? (schema_v42)
 *
 * Si la columna todavía no existe la consulta falla y devuelve null: sin
 * huella no hay chequeo, pero tampoco se cae la subida.
 */
async function buscarIlustracionPorHuella(huella) {
  try {
    const { data, error } = await supabase
      .from("icon_library")
      .select("id, nombre")
      .eq("hash_archivo", huella)
      .limit(1);
    if (error) return null;
    return (data || [])[0] || null;
  } catch (err) {
    return null;
  }
}

/**
 * POST /api/admin/ilustraciones/analizar
 * body: { archivoBase64, tipoMime, nombreArchivo? }
 *
 * Mira el dibujo y PROPONE nombre, descripción, categoría y —sobre todo—
 * palabras clave (5-sep-2026, ver agents/describirIlustracion.js). No
 * guarda nada.
 *
 * Aquí la IA pesa más que en plantillas: una plantilla sin buenos datos
 * igual se puede buscar por nombre, pero una ilustración sin palabras
 * clave NO SE ENGANCHA A NADA — es un archivo muerto en el bucket. Por eso
 * también avisa si esa imagen ya está subida, antes de que la persona
 * llene el formulario de algo que va a rebotar.
 */
router.post("/ilustraciones/analizar", requireBuyer, requireAdmin, async (req, res) => {
  try {
    const { archivoBase64, tipoMime, nombreArchivo } = req.body || {};

    const archivo = leerArchivoSubido(archivoBase64, tipoMime, TIPOS_ILUSTRACION);
    if (archivo.error) return res.status(400).json({ error: archivo.error });

    // El aviso de repetida va aparte de la propuesta: que la IA falle no
    // debe tapar el dato de que ya la tienes, ni al revés.
    let repetida = null;
    if (supabase) {
      const huella = crypto.createHash("sha256").update(archivo.buffer).digest("hex");
      const encontrada = await buscarIlustracionPorHuella(huella);
      if (encontrada) repetida = { id: encontrada.id, nombre: encontrada.nombre };
    }

    let propuesta = null;
    try {
      propuesta = await describirIlustracion(archivoBase64, tipoMime, nombreArchivo || "");
    } catch (err) {
      propuesta = null;
    }

    if (!propuesta && !repetida) {
      return res.status(422).json({ error: "No pude leer esa imagen. Llena los campos a mano." });
    }
    res.json({ propuesta, repetida });
  } catch (err) {
    res.status(422).json({ error: "No pude proponer los datos ahorita. Llénalos a mano y súbela igual." });
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
    // `activa` por omisión es true: subir una ilustración y que no se
    // enganche a nada sería la sorpresa, no lo contrario.
    const activa = req.body?.activa !== false;

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

    // ── ¿Ya está? (schema_v42)
    // Una ilustración repetida no solo estorba en el panel: se engancha dos
    // veces al mismo tema y el material sale con el dibujo duplicado.
    const huella = crypto.createHash("sha256").update(archivo.buffer).digest("hex");
    const repetida = await buscarIlustracionPorHuella(huella);
    if (repetida) {
      return res.status(409).json({
        error: `Esa imagen ya está en la biblioteca como "${repetida.nombre}".`,
        motivo: "repetida",
        repetida: { id: repetida.id, nombre: repetida.nombre },
      });
    }

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
        activa,
        hash_archivo: huella,
      })
      .select()
      .single();

    if (error) {
      // El archivo se borra hasta saber que no hay reintento — si no, la
      // fila del reintento apuntaría a un archivo ya borrado.
      // Si todavía no se corre schema_v42 la columna no existe (42703) y el
      // insert falla entero. La huella es un extra; la ilustración es lo
      // importante, así que se reintenta sin ella.
      if (/hash_archivo|42703/.test(error.message || "")) {
        const reintento = await supabase
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
            activa,
          })
          .select()
          .single();
        if (reintento.error) {
          await borrarArchivo(path);
          throw new Error(reintento.error.message);
        }
        return res.status(201).json({
          ilustracion: reintento.data,
          aviso: "Corre db/schema_v42.sql para que el admin pueda detectar imágenes repetidas.",
        });
      }
      await borrarArchivo(path);
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

    // Desde schema_v40 las plantillas viven en un bucket PRIVADO, así que
    // archivo_url ya no sirve para verlas ni para la miniatura: se firma
    // una liga de una hora para el propio panel. Sin esto, el admin se
    // quedaba con imágenes rotas y el botón "Ver" no abría nada.
    const conVista = await Promise.all(
      (data || []).map(async (p) => ({ ...p, vista_url: await ligaDeVista(p) }))
    );

    res.json({ plantillas: conVista });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * ¿Ya hay una plantilla con esta huella? (schema_v41)
 * Si la columna no existe todavía, se contesta null: sin migración no hay
 * detección de repetidas, pero tampoco se rompe la subida.
 */
async function buscarPorHuella(huella) {
  try {
    const { data, error } = await supabase
      .from("plantillas")
      .select("id, nombre")
      .eq("hash_archivo", huella)
      .limit(1);
    if (error) return null;
    return (data || [])[0] || null;
  } catch (err) {
    return null;
  }
}

/** Normaliza para comparar nombres: sin acentos, sin signos, en minúsculas. */
function clavearNombre(nombre) {
  return String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** ¿Hay otra que se llame prácticamente igual? Solo para avisar. */
async function buscarPorNombre(nombre) {
  try {
    const clave = clavearNombre(nombre);
    if (!clave) return null;
    const { data } = await supabase.from("plantillas").select("id, nombre");
    return (data || []).find((p) => clavearNombre(p.nombre) === clave) || null;
  } catch (err) {
    return null;
  }
}

/** Liga para VER una plantilla desde el panel. null si no se pudo firmar. */
async function ligaDeVista(plantilla) {
  const guardada = String(plantilla?.archivo_url || "");
  if (guardada.startsWith("http")) return guardada; // subida antes de v40
  const path = plantilla?.storage_path || guardada.replace(/^privado:/, "");
  if (!path) return null;
  try {
    const { data } = await supabase.storage.from(BUCKET_PLANTILLAS).createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  } catch (err) {
    return null;
  }
}

/**
 * POST /api/admin/plantillas/analizar
 * body: { archivoBase64, tipoMime, nombreArchivo? }
 *
 * Mira la hoja y PROPONE nombre, descripción, categoría, nivel y enfoque
 * (4-sep-2026, ver agents/describirPlantilla.js). No guarda nada: la
 * respuesta se pinta en los campos del formulario para que la persona los
 * revise y corrija antes de subir.
 *
 * Va ANTES de POST /plantillas en el archivo por orden de lectura, no
 * porque Express lo necesite: son rutas distintas, no hay conflicto.
 */
router.post("/plantillas/analizar", requireBuyer, requireAdmin, async (req, res) => {
  try {
    const { archivoBase64, tipoMime, nombreArchivo } = req.body || {};

    // Se valida igual que al subir: mismo tope de peso y mismos tipos, para
    // no mandarle a la IA algo que después el guardado va a rechazar.
    const archivo = leerArchivoSubido(archivoBase64, tipoMime, TIPOS_PLANTILLA);
    if (archivo.error) return res.status(400).json({ error: archivo.error });

    const propuesta = await describirPlantilla(archivoBase64, tipoMime, nombreArchivo || "");
    if (!propuesta) {
      return res.status(422).json({ error: "No pude leer esa hoja. Llena los campos a mano." });
    }
    res.json({ propuesta });
  } catch (err) {
    // Que la IA falle nunca puede impedir subir una plantilla a mano.
    res.status(422).json({ error: "No pude proponer los datos ahorita. Llénalos a mano y súbela igual." });
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
    // La marca se pone salvo que se pida explícitamente que no.
    const marcar = req.body?.marcar !== false;

    const nombreLimpio = String(nombre || "").trim();
    if (!nombreLimpio) return res.status(400).json({ error: "Ponle un nombre a la plantilla." });

    const archivo = leerArchivoSubido(archivoBase64, tipoMime, TIPOS_PLANTILLA);
    if (archivo.error) return res.status(400).json({ error: archivo.error });

    // ── ¿Ya está? (schema_v41)
    // La huella se saca del archivo COMO LLEGÓ, antes de la marca: si no,
    // subir dos veces el mismo archivo daría huellas distintas y el
    // chequeo no serviría de nada.
    const huella = crypto.createHash("sha256").update(archivo.buffer).digest("hex");
    const repetida = await buscarPorHuella(huella);
    if (repetida) {
      return res.status(409).json({
        error: `Esa hoja ya está en la biblioteca como "${repetida.nombre}".`,
        motivo: "repetida",
        repetida: { id: repetida.id, nombre: repetida.nombre },
      });
    }

    // ── La marca de EnseñAI (utils/marcaAgua.js). No la pone la IA: es un
    // sello en una esquina, trabajo de código.
    let marcada = false;
    let avisoMarca = null;
    if (marcar) {
      const resultado = await ponerMarca(archivo.buffer, tipoMime);
      archivo.buffer = resultado.buffer;
      marcada = resultado.marcada;
      avisoMarca = resultado.motivo;
    }

    // ── ¿Hay otra que se llame casi igual? Esto NO bloquea: avisa.
    const parecida = await buscarPorNombre(nombreLimpio);

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
        hash_archivo: huella,
        marcada,
      })
      .select()
      .single();

    if (error) {
      // Ojo con el orden: el archivo NO se borra todavía. Si el fallo es
      // solo por las columnas nuevas, el reintento se queda con este mismo
      // archivo; borrarlo aquí dejaría la fila apuntando a la nada.
      // Si todavía no se corre schema_v41, las columnas nuevas no existen
      // (42703) y el insert falla entero. Antes que dejarla sin subir, se
      // reintenta sin ellas: la marca y la huella son extras, la plantilla
      // es lo importante.
      if (/hash_archivo|marcada|42703/.test(error.message || "")) {
        const reintento = await supabase
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
        if (reintento.error) {
          await borrarArchivo(path);
          throw new Error(reintento.error.message);
        }
        return res.status(201).json({
          plantilla: reintento.data,
          marcada,
          aviso: "Corre db/schema_v41.sql para que el admin pueda detectar hojas repetidas.",
        });
      }
      await borrarArchivo(path);
      throw new Error(error.message);
    }

    res.status(201).json({
      plantilla: data,
      marcada,
      aviso:
        (parecida ? `Ojo: ya tienes otra que se llama "${parecida.nombre}". No es el mismo archivo, pero revisa que no sobre.` : null) ||
        (marcar && !marcada && avisoMarca ? `Se subió sin marca: ${avisoMarca}.` : null),
    });
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
