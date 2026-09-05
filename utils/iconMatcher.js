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
  // Además del puntaje se guarda CON QUÉ claves empató. Eso es lo que
  // después permite darse cuenta de que dos ilustraciones son la misma
  // lámina en dos versiones (ver agruparPorConcepto abajo).
  const empataron = [];
  for (const claveBruta of palabrasClave || []) {
    const clave = normalizarFrase(claveBruta);
    if (!clave) continue;

    if (clave.includes(" ")) {
      // Frase: tiene que aparecer completa, con límites de palabra.
      const patron = new RegExp(`(^|\\s)${clave.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
      if (patron.test(fraseTexto)) { puntaje += 3; empataron.push(clave); }
      continue;
    }

    if (palabrasTexto.some((p) => mismaPalabra(p, clave))) { puntaje += 1; empataron.push(clave); }
  }
  return { puntaje, empataron };
}

/**
 * ¿Estas dos ilustraciones son la misma lámina en dos versiones?
 *
 * Se comparan las claves CON LAS QUE EMPATARON, no todas las que tienen.
 * Si de las claves que las trajeron a esta búsqueda comparten la mitad o
 * más, para efectos de este tema son lo mismo y no tiene caso enseñar las
 * dos. Se usa Jaccard (compartidas ÷ total distintas).
 *
 * El 0.5 es a propósito flojo: cuando subes una versión mejorada, el agente
 * que la cataloga no le pone exactamente las mismas palabras que a la
 * vieja, así que exigir que sean idénticas no cacharía casi ningún par.
 */
function sonElMismoConcepto(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return false;
  let comunes = 0;
  for (const clave of A) if (B.has(clave)) comunes++;
  return comunes / (A.size + B.size - comunes) >= 0.5;
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
  const maximo = opciones.maximo || 2;
  const minimo = opciones.minimo === undefined ? 2 : opciones.minimo;
  if (!supabase) return [];

  const palabrasTexto = normalizar(textoBusqueda);
  if (palabrasTexto.length === 0) return [];
  const fraseTexto = palabrasTexto.join(" ");

  const { data: iconos, error } = await supabase
    .from("icon_library")
    .select("id, nombre, image_url, categoria, palabras_clave, licencia, autor, fuente_url, activa, prioridad, created_at");
  // Si la tabla no existe o la consulta falla, el tema simplemente sale sin
  // ilustración: nunca se le cae la generación al usuario por esto.
  if (error || !iconos || iconos.length === 0) return [];

  const puntuadas = [];
  for (const icono of iconos) {
    if (icono.activa === false) continue;
    const { puntaje, empataron } = puntuar(icono.palabras_clave, palabrasTexto, fraseTexto);
    if (puntaje >= minimo) puntuadas.push({ icono, puntaje, empataron });
  }

  // ── Orden ESTABLE (5-sep-2026)
  // Antes solo se ordenaba por puntaje, y el empate lo resolvía el orden en
  // que Postgres devolvió las filas — que no está garantizado. O sea que el
  // mismo tema podía salir con una lámina distinta cada vez que se
  // generaba. Ahora el desempate es explícito y siempre da lo mismo:
  //   1. puntaje       — qué tan bien le queda al tema
  //   2. prioridad     — "entre estas dos, gana esta" (schema_v43)
  //   3. más reciente  — al mejorar una lámina, la nueva gana sola
  //   4. id            — último recurso, para que nunca quede al azar
  puntuadas.sort((a, b) => {
    if (b.puntaje !== a.puntaje) return b.puntaje - a.puntaje;
    const pa = a.icono.prioridad || 0, pb = b.icono.prioridad || 0;
    if (pb !== pa) return pb - pa;
    const fa = Date.parse(a.icono.created_at || 0) || 0;
    const fb = Date.parse(b.icono.created_at || 0) || 0;
    if (fb !== fa) return fb - fa;
    return String(a.icono.id).localeCompare(String(b.icono.id));
  });

  // ── Una sola por concepto
  // Tres versiones del sistema solar empatan en todo y antes se mostraban
  // las tres. Como la lista ya viene ordenada de mejor a peor, basta con
  // recorrerla y descartar la que sea "la misma lámina" que alguna que ya
  // entró: la que se queda siempre es la ganadora del desempate de arriba.
  const elegidas = [];
  for (const candidata of puntuadas) {
    if (elegidas.some((e) => sonElMismoConcepto(e.empataron, candidata.empataron))) continue;
    elegidas.push(candidata);
    if (elegidas.length >= maximo) break;
  }

  return elegidas.map(({ icono }) => ({
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
  sonElMismoConcepto,
  buscarIlustraciones,
  buscarIconoRelevante,
  anotarFaltante,
  // exportadas para poder probarlas solas
  normalizar,
  normalizarFrase,
  puntuar,
};
