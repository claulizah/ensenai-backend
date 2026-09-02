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

El trabajo del estudiante te puede llegar de dos formas, y a veces las dos juntas: como FOTO de su cuaderno, o ESCRITO por él en un cuadro de texto ("así lo resolví"). Revísalo igual en los dos casos.

Cuando venga el enunciado y la solución de referencia del ejercicio, úsalos para comparar — pero NO copies la solución de referencia en tu respuesta si el estudiante todavía puede corregir solo: señala el primer paso donde se desvió y qué revisar ahí.

Si la foto trae más de un ejercicio, revisa todos y sepáralos claramente en el campo "veredicto" (ej. "Ejercicio 1: bien. Ejercicio 2: error en el paso 3.").
Si la foto no se alcanza a leer bien, o no muestra un ejercicio resuelto, dilo en "veredicto" y deja "pasos" como un arreglo vacío.
Si el estudiante escribió solo el resultado, sin procedimiento, dilo con amabilidad en "veredicto" (si el resultado es correcto, felicítalo y pídele que escriba cómo llegó; si no, dile que anote sus pasos para poder ubicar dónde se atoró).
Habla SIEMPRE de tú, en español de México, en tono de maestro que anima. Nada de regaños.

Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta:
{
  "veredicto": "resumen breve de 1-2 líneas: ¿está bien o dónde está el error?",
  "pasos": [
    { "numero": 1, "correcto": true, "comentario": "qué hizo bien o mal en este paso, en una línea" }
  ],
  "sugerencia": "una sola frase: qué hacer ahora (repetir el paso 3, checar el signo, intentar otro parecido...). Vacío si todo salió bien."
}`;

async function intentarRevisar(contenidoUsuario) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: PROMPT_SISTEMA,
    messages: [{ role: "user", content: contenidoUsuario }],
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

  return { veredicto: String(data.veredicto || ""), pasos, sugerencia: String(data.sugerencia || "") };
}

/**
 * @param {string[]} imagenes - data URLs o { media_type, data }, igual que
 * generarMaterialTema (ver normalizarImagenes en generateTema.js).
 * @param {object} [contexto] - opcional, para la revisión POR EJERCICIO que
 * se hace desde la pestaña "Practicar" de un tema (2-sep-2026: "que lo
 * puedas resolver y la IA te diga cómo lo resolviste"):
 *   - enunciado: el ejercicio tal como se lo pusimos
 *   - solucion: la solución que ya venía guardada en el tema (referencia
 *     para el revisor; el prompt le prohíbe soltarla si el alumno todavía
 *     puede corregir solo)
 *   - procedimiento: lo que el estudiante escribió de su puño
 *   - nivel: para ajustar el lenguaje a su edad
 *
 * Hace falta AL MENOS una de las dos cosas: una foto legible o un
 * procedimiento escrito. Sin nada que revisar no se llama a la IA.
 */
async function revisarEjercicio(imagenes, contexto = {}) {
  const bloquesImagen = normalizarImagenes(imagenes);
  const procedimiento = String(contexto.procedimiento || "").trim();

  if (!bloquesImagen.length && !procedimiento) {
    throw new Error("No se recibió ni foto ni procedimiento escrito del ejercicio.");
  }

  const partes = [];
  if (contexto.enunciado) partes.push(`EJERCICIO:\n${contexto.enunciado}`);
  if (contexto.solucion) partes.push(`SOLUCIÓN DE REFERENCIA (no la copies tal cual):\n${contexto.solucion}`);
  if (contexto.nivel) partes.push(`NIVEL DEL ESTUDIANTE: ${contexto.nivel}`);
  if (procedimiento) partes.push(`ASÍ LO RESOLVIÓ EL ESTUDIANTE:\n${procedimiento}`);
  partes.push(
    bloquesImagen.length
      ? "Revisa el ejercicio resuelto de la(s) foto(s) y dime paso por paso si está bien."
      : "Revisa el procedimiento de arriba y dime paso por paso si está bien."
  );

  const contenidoUsuario = [...bloquesImagen, { type: "text", text: partes.join("\n\n") }];

  try {
    return await intentarRevisar(contenidoUsuario);
  } catch (err) {
    try {
      return await intentarRevisar(contenidoUsuario);
    } catch (err2) {
      throw new Error(`No se pudo revisar el ejercicio — la respuesta llegó incompleta. Intenta de nuevo. (${err2.message})`);
    }
  }
}

module.exports = { revisarEjercicio };
