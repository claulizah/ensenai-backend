/**
 * Trabajos de generación en segundo plano (sep-2026).
 *
 * El problema que resuelve: generar un tema tarda 40-90 segundos, y hasta
 * ahora eso era una sola petición HTTP abierta todo ese rato. En celular
 * basta con bloquear la pantalla o cambiarse de app para que el sistema
 * suspenda la pestaña y mate la conexión — el material se generaba y se
 * guardaba del lado del servidor, pero el usuario veía un error y creía
 * haber perdido su tema del mes.
 *
 * Ahora la generación no vive en la conexión: se encola un trabajo (tabla
 * trabajos_generacion, ver db/schema_v34.sql), el POST contesta al
 * instante, y el frontend pregunta por el resultado cada pocos segundos.
 *
 * Las FOTOS no se guardan en la tabla: viajan en base64 y pesan megas.
 * Se quedan en memoria de este proceso mientras dura el trabajo. La
 * consecuencia es que un reinicio del servidor a media generación pierde
 * ese trabajo — por eso existe barrerZombis(), que lo marca como fallido
 * en vez de dejar al celular preguntando para siempre.
 */
const supabase = require("../db/supabase");

const ESTADOS = { PENDIENTE: "pendiente", GENERANDO: "generando", LISTO: "listo", FALLIDO: "fallido" };

/** Fotos en base64 del trabajo en curso, por id de trabajo. */
const imagenesEnVuelo = new Map();

/**
 * Un trabajo lleva más de esto en pendiente/generando = nadie lo está
 * trabajando (el proceso que lo tomó se reinició). Generosamente por
 * encima del peor caso real (~90 s, o ~3 min si el revisor de calidad
 * regenera dos veces) para no matar trabajos vivos.
 */
const MS_ZOMBI = 10 * 60 * 1000;

function requiereSupabase() {
  if (!supabase) throw new Error("Supabase no está configurado.");
}

/** Trabajo ya encolado con esta misma clave de cliente, si existe. */
async function buscarPorClave(userId, claveCliente) {
  if (!claveCliente) return null;
  requiereSupabase();
  const { data } = await supabase
    .from("trabajos_generacion")
    .select("*")
    .eq("user_id", userId)
    .eq("clave_cliente", claveCliente)
    .maybeSingle();
  return data || null;
}

/** El trabajo sin terminar de este usuario, si tiene uno. */
async function trabajoSinTerminar(userId) {
  requiereSupabase();
  const { data } = await supabase
    .from("trabajos_generacion")
    .select("*")
    .eq("user_id", userId)
    .in("estado", [ESTADOS.PENDIENTE, ESTADOS.GENERANDO])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

/**
 * El último trabajo que le importa al usuario: sirve para que el frontend
 * se recupere aunque haya perdido el id (por ejemplo si el POST alcanzó a
 * encolar pero la respuesta no llegó). Solo mira la última media hora —
 * más atrás ya es historial, no algo que esté esperando.
 */
async function ultimoTrabajo(userId) {
  requiereSupabase();
  const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("trabajos_generacion")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function obtenerTrabajo(userId, id) {
  requiereSupabase();
  const { data } = await supabase
    .from("trabajos_generacion")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return data || null;
}

async function crearTrabajo(userId, { modo, titulo, claveCliente, parametros, imagenes }) {
  requiereSupabase();
  const { data, error } = await supabase
    .from("trabajos_generacion")
    .insert({
      user_id: userId,
      clave_cliente: claveCliente || null,
      modo: modo === "grupo" ? "grupo" : "individual",
      titulo,
      estado: ESTADOS.PENDIENTE,
      parametros: parametros || {},
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  if (imagenes && imagenes.length) imagenesEnVuelo.set(data.id, imagenes);
  return data;
}

function imagenesDe(trabajoId) {
  return imagenesEnVuelo.get(trabajoId) || [];
}

async function actualizar(id, campos) {
  requiereSupabase();
  const { error } = await supabase
    .from("trabajos_generacion")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn("[trabajos] no se pudo actualizar el trabajo:", error.message);
}

const marcarGenerando = (id) => actualizar(id, { estado: ESTADOS.GENERANDO });

async function marcarListo(id, resultado) {
  imagenesEnVuelo.delete(id);
  await actualizar(id, { estado: ESTADOS.LISTO, resultado, error: null });
}

async function marcarFallido(id, mensaje) {
  imagenesEnVuelo.delete(id);
  await actualizar(id, { estado: ESTADOS.FALLIDO, error: mensaje });
}

/**
 * Marca como fallidos los trabajos que quedaron colgados (el proceso que
 * los atendía se reinició). Sin esto, el frontend se queda preguntando
 * por un trabajo que nadie va a terminar nunca.
 *
 * El mensaje apunta al historial a propósito: si el reinicio ocurrió
 * DESPUÉS de que el modelo terminara, el tema sí quedó guardado en
 * mis_temas y decirle "falló" a secas haría que lo generara dos veces.
 */
async function barrerZombis() {
  if (!supabase) return;
  const limite = new Date(Date.now() - MS_ZOMBI).toISOString();
  const { error } = await supabase
    .from("trabajos_generacion")
    .update({
      estado: ESTADOS.FALLIDO,
      error: "La generación se interrumpió del lado del servidor. Revisa tu historial antes de volver a intentar — puede que el material sí haya alcanzado a guardarse.",
      updated_at: new Date().toISOString(),
    })
    .in("estado", [ESTADOS.PENDIENTE, ESTADOS.GENERANDO])
    .lt("updated_at", limite);
  if (error) console.warn("[trabajos] barrido de zombis:", error.message);
}

/** Arranca el barrido periódico. Se llama una vez desde server.js. */
function iniciarBarridoZombis(cadaMs = 5 * 60 * 1000) {
  barrerZombis();
  const t = setInterval(barrerZombis, cadaMs);
  if (t.unref) t.unref(); // que no mantenga vivo el proceso solo por esto
  return t;
}

module.exports = {
  ESTADOS,
  crearTrabajo,
  obtenerTrabajo,
  buscarPorClave,
  trabajoSinTerminar,
  ultimoTrabajo,
  imagenesDe,
  marcarGenerando,
  marcarListo,
  marcarFallido,
  barrerZombis,
  iniciarBarridoZombis,
};
