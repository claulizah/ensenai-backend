const Anthropic = require("@anthropic-ai/sdk");
const { normalizarImagenes } = require("./generateTema");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Revisa la foto de un ejercicio YA RESUELTO A MANO y regresa, paso por
 * paso, en cuál se equivocó (si se equivocó) — pedido de piloto: "poder
 * mandar fotos de los ejercicios en las prácticas para ver en qué hay
 * falla". Es una función DISTINTA de generarMaterialTema: no genera
 * material nuevo, revisa uno que la persona ya resolvió por su cuenta.
 * Comparte `normalizarImagenes` con generateTema.js (misma validación de
 * fotos: tamaño, tipo, hasta 3).
 */

const PROMPT_SISTEMA = `Eres un maestro revisando el trabajo YA RESUELTO A MANO de un estudiante, a partir de una o más fotos. Tu trabajo es identificar el procedimiento que escribió el estudiante y decir, paso por paso, si cada paso es correcto o no — y si no lo es, en qué paso está exactamente el error y por qué, sin resolver el ejercicio completo por él (dale la pista de qué revisar, no la respuesta correcta de inmediato, salvo que el paso ya esté mal y sea necesario decir el valor correcto de ese paso para poder seguir revisando los siguientes).

Si la foto trae más de un ejercicio, revisa todos y sepáralos claramente en el campo "veredicto" (ej. "Ejercicio 1: bien. Ejercicio 2: error en el paso 3.").
Si la foto no se alcanza a leer bien, o no muestra un ejercicio resuelto, dilo en "veredicto" y deja "pasos" como un arreglo vacío.

Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta:
{
  "veredicto": "resumen breve de 1-2 líneas: ¿está bien o dónde está el error?",
  "pasos": [
    { "numero": 1, "correcto": true, "comentario": "qué hizo bien o mal en este paso, en una línea" }
  ]
}`;

async function intentarRevisar(bloquesImagen) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: PROMPT_SISTEMA,
    messages: [
      {
        role: "user",
        content: [...bloquesImagen, { type: "text", text: "Revisa este ejercicio resuelto y dime paso por paso si está bien." }],
      },
    ],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const data = JSON.parse(cleanedText);

  const pasos = Array.isArray(data.pasos)
    ? data.pasos
        .filter((p) => p && typeof p === "object")
        .map((p, i) => ({
          numero: Number.isFinite(Number(p.numero)) ? Number(p.numero) : i + 1,
          correcto: p.correcto === true,
          comentario: String(p.comentario || ""),
        }))
    : [];

  return { veredicto: String(data.veredicto || ""), pasos };
}

/**
 * @param {string[]} imagenes - data URLs o { media_type, data }, igual que
 * generarMaterialTema (ver normalizarImagenes en generateTema.js). Al menos
 * una imagen válida es obligatoria — no tiene sentido revisar sin foto.
 */
async function revisarEjercicio(imagenes) {
  const bloquesImagen = normalizarImagenes(imagenes);
  if (!bloquesImagen.length) {
    throw new Error("No se recibió ninguna foto válida del ejercicio.");
  }

  try {
    return await intentarRevisar(bloquesImagen);
  } catch (err) {
    try {
      return await intentarRevisar(bloquesImagen);
    } catch (err2) {
      throw new Error(`No se pudo revisar el ejercicio — la respuesta llegó incompleta. Intenta de nuevo. (${err2.message})`);
    }
  }
}

module.exports = { revisarEjercicio };
