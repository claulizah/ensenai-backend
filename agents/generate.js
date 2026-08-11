const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Construye el prompt según la audiencia y el modo de generación.
 * audience: "ninos" | "padres" | "profesionales"
 * tutorAnswers: opcional — respuestas del creador cuando usa el modo "con ayuda del tutor"
 *   ej. { nivel: "principiante", enfasis: "vocabulario básico" }
 */
function buildPrompt(transcript, audience, tutorAnswers) {
  const guiaTutor = tutorAnswers
    ? `\n\nEl creador dio estas indicaciones adicionales, tómalas en cuenta:\n${JSON.stringify(tutorAnswers, null, 2)}`
    : "";

  if (audience === "ninos") {
    return `Eres un asistente educativo. A partir de esta transcripción de un video para niños, genera:
1. Un resumen breve (3-4 líneas, lenguaje simple y cálido).
2. Una trivia de 5 preguntas de opción múltiple con respuesta correcta marcada.
3. Un memorama de 6 pares de tarjetas (concepto - definición corta) relacionados al tema.

Responde SOLO en JSON con esta forma exacta:
{"resumen": "...", "trivia": [{"pregunta":"...", "opciones":["...","...","..."], "respuesta_correcta": 0}], "memorama": [{"a":"...", "b":"..."}]}

Transcripción:
${transcript}${guiaTutor}`;
  }

  // padres o profesionales: resumen + tips prácticos, sin trivia/memorama
  return `Eres un asistente educativo. A partir de esta transcripción de un video dirigido a ${audience === "padres" ? "padres y cuidadores" : "profesionales"}, genera:
1. Un resumen breve (4-6 líneas).
2. Una lista de 4-5 tips prácticos y accionables relacionados al tema.

Responde SOLO en JSON con esta forma exacta:
{"resumen": "...", "tips": ["...", "..."]}

Transcripción:
${transcript}${guiaTutor}`;
}

/**
 * Genera materiales educativos a partir de una transcripción.
 *
 * @param {string} transcript - texto transcrito del video
 * @param {"ninos"|"padres"|"profesionales"} audience - etiqueta de audiencia
 * @param {object|null} tutorAnswers - respuestas del modo "con ayuda del tutor" (null = modo automático)
 */
async function generateMaterials(transcript, audience, tutorAnswers = null) {
  const prompt = buildPrompt(transcript, audience, tutorAnswers);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";

  // Claude a veces envuelve la respuesta en un bloque de código markdown
  // (```json ... ```) aunque se le pida solo JSON — lo limpiamos antes de parsear.
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleanedText);
  } catch (err) {
    throw new Error(`No se pudo parsear la respuesta del generador como JSON: ${err.message}`);
  }
}

module.exports = { generateMaterials };
