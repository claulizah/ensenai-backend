/**
 * Le pone nombre y datos a una plantilla mirándola (4-sep-2026).
 *
 * Nació de un problema concreto: los cuadernillos de Claudia salen
 * partidos en cientos de hojas sueltas, y llenar a mano nombre,
 * descripción, categoría, nivel y enfoque de cada una es lo que hace que
 * una biblioteca se quede sin subir para siempre.
 *
 * Usa Haiku a propósito: describir una hoja de trabajo no necesita el
 * modelo grande, y aquí el volumen sí importa (cientos de llamadas).
 *
 * Lo que devuelve es una PROPUESTA: el admin siempre la muestra en campos
 * editables antes de guardar. Nunca se sube nada a la biblioteca con lo
 * que la IA dijo sin que una persona lo haya visto.
 */

const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CATEGORIAS = [
  "emociones",
  "cuerpo_vida",
  "tierra_espacio",
  "matematicas",
  "mexico",
  "lenguaje",
  "convivencia",
  "planeacion",
  "evaluacion",
  "otros",
];
const NIVELES = ["preescolar", "primaria_baja", "primaria_alta", "secundaria", "preparatoria", "universidad"];

const PROMPT = `Estás catalogando una hoja imprimible para EnseñAI, una plataforma mexicana de material educativo. Vas a ver la hoja; descríbela para que un maestro la encuentre buscando.

Contesta SOLO un objeto JSON, sin texto alrededor y sin bloque de código:

{
  "nombre": "...",
  "descripcion": "...",
  "categoria": "una de: ${CATEGORIAS.join(" | ")}",
  "nivel": "una de: ${NIVELES.join(" | ")} — o null si sirve para cualquier edad",
  "enfoque": "escolar | psicoeducativo | null"
}

Reglas del NOMBRE (es lo más importante: con eso la buscan y con eso se engancha al tema que el maestro genera):
- De 3 a 8 palabras, concreto y en español de México.
- Di QUÉ ES y DE QUÉ, no cómo se ve: "Laberinto de la letra A", "Traza y escribe: círculo", "Tarjeta de emoción: enojado", "Colorea la figura diferente".
- Si la hoja trae una letra, un número, una figura o una emoción específica, ESO va en el nombre.
- Nunca pongas "hoja 1", "sin título", "actividad", ni el nombre de un archivo.

Reglas de la DESCRIPCIÓN:
- Una o dos líneas: qué hace el niño con esa hoja y para qué sirve.
- Escríbela para el maestro, no para el niño.

Reglas del ENFOQUE:
- "psicoeducativo" solo si es material de emociones, regulación, autoconocimiento o convivencia, del tipo que usaría un psicólogo en consulta.
- "escolar" para contenido de la escuela (matemáticas, lectoescritura, ciencias, motricidad).
- null si sirve igual en los dos.

Si la hoja está en otro idioma, el nombre y la descripción van en español de todas formas.`;

/** Convierte lo que manda el navegador en el bloque que espera la API. */
function bloqueArchivo(base64, tipoMime) {
  const datos = String(base64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!datos) return null;

  if (tipoMime === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: datos } };
  }
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(tipoMime)) {
    return { type: "image", source: { type: "base64", media_type: tipoMime, data: datos } };
  }
  // Un SVG no lo puede mirar el modelo: se le pasa como texto, que para un
  // ícono suele bastar (trae los <title>, los textos y los nombres de las
  // formas).
  if (tipoMime === "image/svg+xml") {
    const texto = Buffer.from(datos, "base64").toString("utf8").slice(0, 4000);
    return { type: "text", text: `Contenido del archivo SVG:\n${texto}` };
  }
  return null;
}

function limpiar(valor, permitidos) {
  const v = String(valor || "").trim().toLowerCase();
  return permitidos.includes(v) ? v : null;
}

/**
 * @returns {Promise<{nombre, descripcion, categoria, nivel, enfoque}|null>}
 * null cuando el archivo no se puede mirar o el modelo no contestó JSON.
 */
async function describirPlantilla(base64, tipoMime, pistaNombreArchivo = "") {
  const bloque = bloqueArchivo(base64, tipoMime);
  if (!bloque) return null;

  const pista = pistaNombreArchivo
    ? `\n\nEl archivo se llama "${pistaNombreArchivo}". Úsalo solo si ayuda; si el nombre del archivo no dice nada ("Diseño sin título 2"), ignóralo por completo.`
    : "";

  const respuesta = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
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
  if (!nombre) return null;

  return {
    nombre,
    descripcion: String(datos.descripcion || "").trim().slice(0, 800),
    categoria: limpiar(datos.categoria, CATEGORIAS) || "otros",
    nivel: limpiar(datos.nivel, NIVELES),
    enfoque: limpiar(datos.enfoque, ["escolar", "psicoeducativo"]),
  };
}

module.exports = { describirPlantilla, CATEGORIAS, NIVELES };
