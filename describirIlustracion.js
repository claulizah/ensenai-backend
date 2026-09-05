/**
 * Mira una ilustración y propone su ficha (5-sep-2026).
 *
 * Hermano de agents/describirPlantilla.js, pero con un objetivo distinto y
 * más importante: las PALABRAS CLAVE. Una ilustración no se busca — se
 * engancha sola al material de un tema por esas palabras (ver
 * utils/iconMatcher.js). Una lámina del sistema solar sin palabras clave
 * no aparece nunca, por buena que sea.
 *
 * Poner 10 palabras clave a mano por cada ícono es justo el trabajo que
 * hace que una biblioteca de ilustraciones se quede sin llenar. Eso sí
 * vale una llamada a la IA; el nombre y la categoría vienen de pilón.
 *
 * Usa Haiku: describir un dibujo no necesita el modelo grande y aquí el
 * volumen importa.
 */

const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Las mismas ocho de db/schema_v38.sql — si cambian allá, cambian aquí.
const CATEGORIAS = [
  "emociones",
  "cuerpo_vida",
  "tierra_espacio",
  "matematicas",
  "mexico",
  "lenguaje",
  "convivencia",
  "otros",
];

const PROMPT = `Estás catalogando una ilustración para EnseñAI, una plataforma mexicana de material educativo. Estas ilustraciones NO se buscan: se enganchan solas al material de un tema cuando las palabras del tema coinciden con las palabras clave de la imagen. Por eso las palabras clave son lo más importante de todo.

Contesta SOLO un objeto JSON, sin texto alrededor y sin bloque de código:

{
  "nombre": "...",
  "descripcion": "...",
  "categoria": "una de: ${CATEGORIAS.join(" | ")}",
  "palabras_clave": ["...", "..."]
}

PALABRAS CLAVE (lo más importante)
- De 8 a 15, en español de México, en minúsculas y en SINGULAR.
- Piensa: "¿qué tema escribiría un maestro para que esta imagen le sirva?".
- Incluye el nombre de lo que se ve, sus partes visibles, el tema escolar al que pertenece y cómo se le dice también en la escuela.
- Si el concepto es de dos palabras, ponlo completo como una sola clave: "sistema solar", "ciclo del agua", "cuerpo humano". Valen más que las sueltas.
- NADA de palabras que sirven para todo: dibujo, imagen, ilustración, educativo, niños, escuela, colores, aprendizaje.
- Nada de la marca ni del estilo ("caricatura", "vector", "kawaii").

NOMBRE
- De 2 a 6 palabras, concreto: "El sistema solar", "Partes de la célula", "Caras de emociones".
- Nunca "ilustración 1", "icono", ni el nombre del archivo.

DESCRIPCIÓN
- Una línea: qué se ve en la imagen. Sirve para que la persona la reconozca en el panel.

CATEGORÍA
- emociones: caras, termómetro de emociones, semáforo de conducta.
- cuerpo_vida: cuerpo humano, célula, animales, plantas, ciclos de vida.
- tierra_espacio: sistema solar, Luna, clima, agua, materia, geografía física.
- matematicas: figuras, fracciones, recta numérica, reloj, dinero.
- mexico: mapas de México, símbolos patrios, historia y cultura de México.
- lenguaje: abecedario, sílabas, cuento, gramática.
- convivencia: reglas del salón, turnos, acuerdos, trabajo en equipo.
- otros: solo si de verdad no cae en ninguna.`;

function bloqueArchivo(base64, tipoMime) {
  const datos = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!datos) return null;

  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(tipoMime)) {
    return { type: "image", source: { type: "base64", media_type: tipoMime, data: datos } };
  }
  // El modelo no puede MIRAR un SVG, pero sí leerlo: los <title>, los textos
  // y hasta los nombres de las capas suelen decir qué es.
  if (tipoMime === "image/svg+xml") {
    const texto = Buffer.from(datos, "base64").toString("utf8").slice(0, 6000);
    return { type: "text", text: `Contenido del archivo SVG (no puedes verlo, dedúcelo del código):\n${texto}` };
  }
  return null;
}

function limpiarClaves(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || "").split(",");
  const vistas = new Set();
  const salida = [];
  for (const c of bruto) {
    const clave = String(c)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    if (!clave || clave.length < 3 || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(clave);
    if (salida.length >= 20) break;
  }
  return salida;
}

/**
 * @returns {Promise<{nombre, descripcion, categoria, palabras_clave}|null>}
 * null si el archivo no se puede leer o si el modelo no contestó JSON con
 * lo mínimo (nombre y al menos una palabra clave).
 */
async function describirIlustracion(base64, tipoMime, pistaNombreArchivo = "") {
  const bloque = bloqueArchivo(base64, tipoMime);
  if (!bloque) return null;

  const pista = pistaNombreArchivo
    ? `\n\nEl archivo se llama "${pistaNombreArchivo}". Úsalo solo si ayuda; si no dice nada, ignóralo.`
    : "";

  const respuesta = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{ role: "user", content: [bloque, { type: "text", text: PROMPT + pista }] }],
  });

  const crudo = respuesta.content.find((b) => b.type === "text")?.text || "";
  const limpio = crudo
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let datos;
  try {
    datos = JSON.parse(limpio);
  } catch (err) {
    return null;
  }

  const nombre = String(datos.nombre || "").trim().slice(0, 200);
  const claves = limpiarClaves(datos.palabras_clave);
  // Sin nombre o sin claves la ficha no sirve: mejor que la llene una
  // persona que guardar una ilustración que nunca se va a enganchar.
  if (!nombre || !claves.length) return null;

  const categoria = String(datos.categoria || "").trim().toLowerCase();

  return {
    nombre,
    descripcion: String(datos.descripcion || "").trim().slice(0, 500),
    categoria: CATEGORIAS.includes(categoria) ? categoria : "otros",
    palabras_clave: claves,
  };
}

module.exports = { describirIlustracion, CATEGORIAS };
