const supabase = require("../db/supabase");

/**
 * Normaliza texto para comparar: minúsculas, sin acentos, sin puntuación.
 */
function normalizar(texto) {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Busca el ícono más relevante en icon_library según coincidencia de
 * palabras clave contra un texto (normalmente título + resumen del curso).
 *
 * No usa IA — es comparación directa de palabras, así que es gratis e
 * instantáneo. Si tu biblioteca de íconos está vacía, o ninguno coincide,
 * regresa null sin romper nada (el curso simplemente no tiene portada).
 *
 * @param {string} textoBusqueda
 * @returns {Promise<{image_url: string, nombre: string} | null>}
 */
async function buscarIconoRelevante(textoBusqueda) {
  if (!supabase) return null;

  const palabrasTexto = new Set(normalizar(textoBusqueda));
  if (palabrasTexto.size === 0) return null;

  const { data: iconos, error } = await supabase.from("icon_library").select("image_url, nombre, palabras_clave");
  if (error || !iconos || iconos.length === 0) return null;

  let mejorIcono = null;
  let mejorPuntaje = 0;

  for (const icono of iconos) {
    const palabrasClave = (icono.palabras_clave || []).map((p) => normalizar(p)[0]).filter(Boolean);

    // Coincidencia flexible: cuenta tanto igualdad exacta como que una
    // contenga a la otra (así "gato" sí coincide con "gatos" en el texto).
    let coincidencias = 0;
    for (const clave of palabrasClave) {
      const hayCoincidencia = [...palabrasTexto].some(
        (palabra) => palabra === clave || palabra.startsWith(clave) || clave.startsWith(palabra)
      );
      if (hayCoincidencia) coincidencias++;
    }

    if (coincidencias > mejorPuntaje) {
      mejorPuntaje = coincidencias;
      mejorIcono = icono;
    }
  }

  if (!mejorIcono) return null;
  return { image_url: mejorIcono.image_url, nombre: mejorIcono.nombre };
}

module.exports = { buscarIconoRelevante };
