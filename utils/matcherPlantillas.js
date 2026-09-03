/**
 * Engancha plantillas de la biblioteca a un tema recién generado
 * (3-sep-2026).
 *
 * Es hermano de utils/iconMatcher.js, pero con una diferencia importante:
 * las ilustraciones traen `palabras_clave` puestas a mano en el admin; las
 * plantillas NO tienen esa columna, así que aquí las palabras se sacan de
 * su nombre, su descripción y su categoría. Por eso el nombre de la
 * plantilla importa tanto: "Laberinto de la letra A" se engancha, "hoja 37"
 * no se engancha con nada nunca.
 *
 * Todo pasa en memoria sobre la lista de plantillas publicadas (son unos
 * cuantos cientos de filas de texto): no hay búsqueda de texto completo en
 * la base, y no hace falta.
 */

// Palabras que aparecen en cualquier tema y no distinguen nada.
const VACIAS = new Set([
  "para","con","los","las","del","que","una","uno","unas","unos","sobre","como","este","esta","estos","estas",
  "cada","por","desde","hasta","entre","donde","cuando","porque","pero","tambien","segun","muy","mas","menos",
  "material","tema","temas","clase","clases","alumno","alumnos","alumna","alumnas","nino","ninos","nina","ninas",
  "actividad","actividades","ejercicio","ejercicios","hoja","hojas","trabajo","escolar","primaria","secundaria",
  "preescolar","preparatoria","universidad","anos","edad",
]);

function normalizar(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function palabras(texto) {
  const vistas = new Set();

  // Caso especial de preescolar: "la letra M" — una letra suelta nunca
  // pasaría el corte de 4 caracteres, y sin esto TODOS los laberintos del
  // abecedario empatan y gana el de la A por orden alfabético. Se guarda
  // como un token propio ("letra_m") que existe igual en el nombre de la
  // plantilla ("Laberinto de la letra M") y en el tema.
  const conLetra = normalizar(texto).matchAll(/letra\s+([a-z0-9ñ])\b/g);
  for (const m of conLetra) vistas.add(`letra_${m[1]}`);

  for (const bruta of normalizar(texto).split(/[^a-z0-9]+/)) {
    // 4 letras es el corte: abajo de eso ("mar", "sol") hay demasiado ruido,
    // salvo números, que sí distinguen ("5 sentidos").
    if (!bruta) continue;
    if (bruta.length < 4 && !/^\d+$/.test(bruta)) continue;
    if (VACIAS.has(bruta)) continue;
    vistas.add(bruta);
    // singular tosco: "emociones" también cuenta como "emocion"
    if (bruta.endsWith("es") && bruta.length > 5) vistas.add(bruta.slice(0, -2));
    else if (bruta.endsWith("s") && bruta.length > 4) vistas.add(bruta.slice(0, -1));
  }
  return vistas;
}

/**
 * @param {string} texto  título del tema (+ resumen, si se quiere afinar)
 * @param {Array}  lista  plantillas publicadas
 * @param {object} opts   { nivel, enfoque, maximo }
 * @returns {Array} las mejores, con su `puntaje`
 */
function elegirPlantillas(texto, lista, opts = {}) {
  const { nivel = null, enfoque = null, maximo = 3 } = opts;
  const tokens = palabras(texto);
  if (!tokens.size) return [];

  const puntuadas = [];
  for (const p of lista || []) {
    // El enfoque sí descarta: una ficha psicoeducativa no tiene por qué
    // aparecer en un tema de matemáticas de la escuela. Una plantilla sin
    // enfoque sirve para los dos.
    if (enfoque && p.enfoque && p.enfoque !== enfoque) continue;

    const enNombre = palabras(p.nombre);
    const enDescripcion = palabras(p.descripcion);
    const enCategoria = palabras(p.categoria);

    let puntaje = 0;
    for (const t of tokens) {
      if (enNombre.has(t)) puntaje += 3;
      else if (enCategoria.has(t)) puntaje += 2;
      else if (enDescripcion.has(t)) puntaje += 1;
    }
    if (!puntaje) continue;

    // El nivel afina, no descarta: una hoja sin nivel sirve para todos, y
    // una de otro nivel puede seguir sirviendo (un repaso, un apoyo).
    if (nivel && p.nivel === nivel) puntaje += 2;
    else if (nivel && p.nivel && p.nivel !== nivel) puntaje -= 1;

    // Con puntaje 1 o 2 solo coincidió la descripción o la categoría, que
    // en la práctica engancha cualquier cosa. Se exige al menos una palabra
    // del NOMBRE (3 puntos) para no ofrecer material que no viene al caso.
    if (puntaje < 3) continue;

    puntuadas.push({ ...p, puntaje });
  }

  puntuadas.sort((a, b) => b.puntaje - a.puntaje || String(a.nombre).localeCompare(String(b.nombre)));
  return puntuadas.slice(0, maximo);
}

module.exports = { elegirPlantillas, palabras, normalizar };
