const supabase = require("../db/supabase");

/**
 * Empata ilustraciones de `icon_library` con el texto de un tema, por
 * palabras clave. No usa IA: es comparación de palabras, así que es gratis,
 * instantáneo y nunca se inventa una imagen que no existe.
 *
 * Reescrito el 2-sep-2026, junto con el panel de admin. Lo de antes tenía
 * tres problemas:
 *
 *   1. `normalizar(p)[0]` se quedaba con la PRIMERA palabra de cada clave:
 *      "sistema solar" se convertía en "sistema" y empataba con cualquier
 *      tema que dijera esa palabra. Ahora una clave de varias palabras se
 *      busca completa dentro del texto.
 *   2. Devolvía una sola imagen (venía de ponerle portada a un curso). Un
 *      tema puede querer dos o tres láminas.
 *   3. `startsWith` en las dos direcciones daba empates absurdos: "a" con
 *      "agua", "sol" con "solamente". Ahora se empata la palabra completa
 *      o su plural.
 */

/** Minúsculas, sin acentos, sin puntuación → arreglo de palabras. */
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Igual, pero conservando los espacios: sirve para buscar frases. */
function normalizarFrase(texto) {
  return normalizar(texto).join(" ");
}

/**
 * ¿La palabra del tema es la misma que la de la clave? Se acepta el plural
 * y nada más — nunca prefijos sueltos, que es lo que hacía que "sol"
 * empatara con "solamente".
 */
function mismaPalabra(a, b) {
  if (a === b) return true;
  if (a.length < 4 && b.length < 4) return false;
  return a === b + "s" || b === a + "s" || a === b + "es" || b === a + "es";
}

/**
 * Puntaje de una ilustración contra el texto del tema.
 * Una clave de varias palabras vale más que una suelta: si el tema dice
 * "sistema solar" completo, eso es mucha mejor señal que solo "sistema".
 */
function puntuar(palabrasClave, palabrasTexto, fraseTexto) {
  let puntaje = 0;
  for (const claveBruta of palabrasClave || []) {
    const clave = normalizarFrase(claveBruta);
    if (!clave) continue;

    if (clave.includes(" ")) {
      // Frase: tiene que aparecer completa, con límites de palabra.
      const patron = new RegExp(`(^|\\s)${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (patron.test(fraseTexto)) puntaje += 3;
      continue;
    }

    if (palabrasTexto.some((p) => mismaPalabra(p, clave))) puntaje += 1;
  }
  return puntaje;
}

/**
 * Busca las ilustraciones más relevantes para un texto (normalmente el
 * título del tema más su resumen).
 *
 * @param {string} textoBusqueda
 * @param {object} [opciones]
 * @param {number} [opciones.maximo=3] - cuántas devolver como mucho
 * @param {number} [opciones.minimo=2] - puntaje mínimo para considerarla
 *   relevante. Con 2 hace falta o una clave de frase, o dos palabras
 *   sueltas: una sola coincidencia produce demasiados falsos positivos
 *   ("agua" en un tema de historia).
 * @returns {Promise<Array<{id, nombre, image_url, categoria, licencia, autor, fuente_url}>>}
 */
async function buscarIlustraciones(textoBusqueda, opciones = {}) {
  const maximo = opciones.maximo || 3;
  const minimo = opciones.minimo === undefined ? 2 : opciones.minimo;
  if (!supabase) return [];

  const palabrasTexto = normalizar(textoBusqueda);
  if (palabrasTexto.length === 0) return [];
  const fraseTexto = palabrasTexto.join(" ");

  const { data: iconos, error } = await supabase
    .from("icon_library")
    .select("id, nombre, image_url, categoria, palabras_clave, licencia, autor, fuente_url, activa");
  // Si la tabla no existe o la consulta falla, el tema simplemente sale sin
  // ilustración: nunca se le cae la generación al usuario por esto.
  if (error || !iconos || iconos.length === 0) return [];

  const puntuadas = [];
  for (const icono of iconos) {
    if (icono.activa === false) continue;
    const puntaje = puntuar(icono.palabras_clave, palabrasTexto, fraseTexto);
    if (puntaje >= minimo) puntuadas.push({ icono, puntaje });
  }

  puntuadas.sort((a, b) => b.puntaje - a.puntaje);

  return puntuadas.slice(0, maximo).map(({ icono }) => ({
    id: icono.id,
    nombre: icono.nombre,
    image_url: icono.image_url,
    categoria: icono.categoria,
    licencia: icono.licencia || null,
    autor: icono.autor || null,
    fuente_url: icono.fuente_url || null,
  }));
}

/**
 * Compatibilidad con el flujo viejo de cursos (routes/courses.js), que
 * pedía UNA imagen de portada. Ahí sí conviene bajar el mínimo: una
 * portada aproximada es mejor que ninguna.
 */
async function buscarIconoRelevante(textoBusqueda) {
  const lista = await buscarIlustraciones(textoBusqueda, { maximo: 1, minimo: 1 });
  if (!lista.length) return null;
  return { image_url: lista[0].image_url, nombre: lista[0].nombre };
}

/**
 * Anota un tema que no encontró ninguna ilustración, para que el panel de
 * admin muestre la lista de lo que falta ordenada por demanda (ver
 * ilustraciones_faltantes en db/schema_v38.sql).
 *
 * Nunca lanza: esto es telemetría de producto, no puede costarle a nadie
 * su material.
 */
async function anotarFaltante(tema, nivel) {
  if (!supabase) return;
  const normalizado = normalizarFrase(tema).slice(0, 200);
  if (!normalizado) return;
  try {
    const { data } = await supabase
      .from("ilustraciones_faltantes")
      .select("id, veces")
      .eq("tema_normalizado", normalizado)
      .maybeSingle();

    if (data) {
      await supabase
        .from("ilustraciones_faltantes")
        .update({ veces: (data.veces || 0) + 1, ultima_vez: new Date().toISOString() })
        .eq("id", data.id);
    } else {
      await supabase.from("ilustraciones_faltantes").insert({
        tema_normalizado: normalizado,
        tema_ejemplo: String(tema || "").slice(0, 300),
        nivel: nivel || null,
      });
    }
  } catch (err) {
    /* si la migración todavía no se corre, aquí no pasa nada */
  }
}

module.exports = {
  buscarIlustraciones,
  buscarIconoRelevante,
  anotarFaltante,
  // exportadas para poder probarlas solas
  normalizar,
  normalizarFrase,
  puntuar,
};
