const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Prompt para audiencia "ninos" — estructura rediseñada:
 * 1. Documento de estudio: resumen + glosario + pregunta de reflexión
 * 2. Trivia fija de 5 preguntas (mezcla de verdadero/falso y relacionar
 *    concepto-definición)
 * 3. Repaso — SOLO el tipo que el creador eligió (memorama, flashcards, o rima)
 */
function buildPromptNinos(transcript, tutorAnswers, repasoTipo, incluirEjercicios) {
  const guiaTutor = tutorAnswers
    ? `\n\nEl creador dio estas indicaciones adicionales, tómalas en cuenta:\n${JSON.stringify(tutorAnswers, null, 2)}`
    : "";

  let bloqueRepaso = "";
  let campoRepasoJson = "";

  if (repasoTipo === "memorama") {
    bloqueRepaso = `Un memorama de 6 pares de tarjetas (concepto - definición corta) relacionados al tema.`;
    campoRepasoJson = `, "memorama": [{"a":"...", "b":"..."}]`;
  } else if (repasoTipo === "flashcards") {
    bloqueRepaso = `6 flashcards digitales (frente: pregunta o concepto corto / reverso: respuesta o explicación breve).`;
    campoRepasoJson = `, "flashcards": [{"frente":"...", "reverso":"..."}]`;
  } else if (repasoTipo === "rima") {
    bloqueRepaso = `Una rima o canción corta (4-8 líneas) que resuma el tema de forma pegajosa y fácil de recordar para un niño.`;
    campoRepasoJson = `, "rima": "..."`;
  }

  let bloqueEjercicios = "";
  let campoEjerciciosJson = "";
  if (incluirEjercicios) {
    bloqueEjercicios = `Además, genera 5 ejercicios imprimibles para practicar el mismo tipo de problema explicado en el video — NO repitas el ejemplo del video, genera ejercicios NUEVOS pero del mismo estilo y nivel de dificultad (ej. si el video explicó una suma de 2 dígitos, genera 5 sumas de 2 dígitos distintas). Cada ejercicio necesita su respuesta correcta para la hoja de respuestas.`;
    campoEjerciciosJson = `, "ejercicios": [{"enunciado":"...", "respuesta":"..."}]`;
  }

  const partes = [
    "1. Un resumen breve (3-4 líneas, lenguaje simple y cálido).",
    "2. Un glosario de 4-5 términos clave del video, cada uno con una definición muy corta y simple.",
    '3. Una pregunta de reflexión corta relacionada al tema (ej. "¿Qué fue lo que más te gustó de las sumas?"), pensada para que el niño responda con un dibujo o unas palabras.',
  ];
  let numero = 4;
  if (bloqueRepaso) partes.push(`${numero++}. ${bloqueRepaso}`);
  if (bloqueEjercicios) partes.push(`${numero++}. ${bloqueEjercicios}`);
  partes.push(
    `${numero}. Una trivia de 5 preguntas, mezclando dos tipos:\n   - tipo "vf": una afirmación relacionada al tema, con respuesta_correcta true o false.\n   - tipo "relacionar": un concepto del tema con 3 opciones de definición (solo una correcta), con respuesta_correcta como el índice (0,1,2) de la opción correcta.`
  );

  return `Eres un asistente educativo. A partir de esta transcripción de un video para niños, genera:
${partes.join("\n")}

Responde SOLO en JSON con esta forma exacta:
{"resumen": "...", "glosario": [{"termino":"...", "definicion":"..."}], "reflexion_prompt": "..."${campoRepasoJson}${campoEjerciciosJson}, "trivia": [{"tipo":"vf", "enunciado":"...", "respuesta_correcta": true}, {"tipo":"relacionar", "concepto":"...", "opciones":["...","...","..."], "respuesta_correcta": 0}]}

Transcripción:
${transcript}${guiaTutor}`;
}

/** Sin cambios — resumen + tips para padres/profesionales. */
function buildPromptOtros(transcript, audience, tutorAnswers) {
  const guiaTutor = tutorAnswers
    ? `\n\nEl creador dio estas indicaciones adicionales, tómalas en cuenta:\n${JSON.stringify(tutorAnswers, null, 2)}`
    : "";

  return `Eres un asistente educativo. A partir de esta transcripción de un video dirigido a ${audience === "padres" ? "padres y cuidadores" : "profesionales"}, genera:
1. Un resumen breve (4-6 líneas).
2. Una lista de 4-5 tips prácticos y accionables relacionados al tema.

Responde SOLO en JSON con esta forma exacta:
{"resumen": "...", "tips": ["...", "..."]}

Transcripción:
${transcript}${guiaTutor}`;
}

/**
 * @param {string} transcript
 * @param {"ninos"|"padres"|"profesionales"} audience
 * @param {object|null} tutorAnswers - modo "con ayuda del tutor" (null = automático)
 * @param {"memorama"|"flashcards"|"rima"|"ninguno"} repasoTipo - solo aplica si audience === "ninos"
 * @param {boolean} incluirEjercicios - solo aplica si audience === "ninos"
 */
async function generateMaterials(transcript, audience, tutorAnswers = null, repasoTipo = "memorama", incluirEjercicios = false) {
  const prompt =
    audience === "ninos"
      ? buildPromptNinos(transcript, tutorAnswers, repasoTipo, incluirEjercicios)
      : buildPromptOtros(transcript, audience, tutorAnswers);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2500,
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
