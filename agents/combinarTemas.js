const Anthropic = require("@anthropic-ai/sdk");
const { normalizarContenido, ETIQUETAS_NIVEL } = require("./generateTema");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Genera un material de REPASO que combina varios temas ya generados (de
 * `mis_temas` o `grupo_temas`) en un solo material — pedido de piloto:
 * "juntar temas para poder estudiar exámenes y cosas así". Reutiliza el
 * mismo formato de salida que agents/generateTema.js (resumen/actividad(es)/
 * ejercicios/trivia/material_extra/respuestas) para que el frontend lo
 * pueda mostrar y guardar exactamente igual que un tema generado normal.
 *
 * `enfoque` (nuevo, "Modo Examen") decide qué tan expositivo o práctico
 * sale el resultado:
 *  - "estudio" (default): el repaso de siempre — resumen integrado normal,
 *    cantidades parecidas a un tema normal. Sigue gastando el límite
 *    mensual de TEMAS de siempre (ver resolverAccesoIndividual en
 *    routes/temas.js) — sin cambios de comportamiento.
 *  - "examen": resumen reducido al mínimo, muchos más ejercicios, y la
 *    trivia se vuelve un SIMULADOR (más preguntas, pensadas para resolverse
 *    contra reloj mezclando los temas). Gasta un contador MENSUAL APARTE
 *    (limite_examenes_mes, ver utils/planes.js y schema_v28.sql) — no toca
 *    el límite de temas normales.
 */

function resumenTextoCorto(contenido) {
  if (!contenido || typeof contenido !== "object") return "";
  const r = contenido.resumen;
  if (!r) return "";
  if (typeof r === "string") return r.slice(0, 500);
  const partes = [r.que_es, ...(Array.isArray(r.ideas_clave) ? r.ideas_clave : [])];
  return partes.filter(Boolean).join(" — ").slice(0, 500);
}

function buildPromptCombinar(temasFuente, modo, enfoque, instruccionesCorrectivas = "") {
  const listaTemas = temasFuente
    .map(
      (t, i) =>
        `${i + 1}. "${t.tema}" (${ETIQUETAS_NIVEL[t.nivel] || "nivel no especificado"})\n   Resumen: ${
          resumenTextoCorto(t.contenido) || "(sin resumen disponible)"
        }`
    )
    .join("\n");

  // Igual que buildPrompt en generateTema.js: si la capa de QA
  // (utils/revisorCalidad.js) detectó un problema en un intento anterior,
  // aquí se le pide a Claude que lo corrija en la regeneración.
  const bloqueCorreccion = instruccionesCorrectivas
    ? `\n\nEl intento anterior tuvo estos problemas — corrígelos en esta versión: ${instruccionesCorrectivas}`
    : "";

  const nivelPredominante = temasFuente.find((t) => t.nivel)?.nivel || "primaria_alta";
  const nivelLabel = ETIQUETAS_NIVEL[nivelPredominante] || "Primaria alta";

  const esExamen = enfoque === "examen";

  const instruccionActividad =
    modo === "grupo"
      ? `Este repaso es para un GRUPO con perfiles de aprendizaje mezclados — genera UNA actividad ${
          esExamen ? "breve de repaso cronometrado" : "de repaso"
        } para CADA UNA de las 8 inteligencias (tabla completa).`
      : esExamen
      ? "Genera UNA sola actividad — breve, de repaso cronometrado, no una dinámica larga."
      : "Genera UNA sola actividad de repaso que combine los temas de forma natural.";

  const proposito = esExamen
    ? `Vas a armar un SIMULACRO DE EXAMEN que junta varios temas que la persona ya estudió por separado, para practicar contra reloj antes de una evaluación que los incluye a todos. Aquí lo que importa es PRACTICAR, no releer — nada de exposición larga.`
    : `Vas a armar un material de REPASO PARA EXAMEN que junta varios temas que la persona ya estudió por separado. El objetivo es ayudarle a repasar todo junto antes de una evaluación que los incluye a todos, encontrando las conexiones entre ellos cuando existan (no solo pegar los temas uno tras otro).`;

  const instruccionesEnfoque = esExamen
    ? `- El resumen va MUY reducido — nada de secciones largas. Deja "secciones" vacío ([]) y usa solo "que_es" (2-3 líneas, el hilo conductor entre los temas) e "ideas_clave" (5 a 8 frases sueltas, una por cada cosa que no se puede olvidar el día del examen). Si hay una confusión típica entre los temas combinados, va en "ojo_aqui" — es más importante aquí que en un repaso normal.
- Ejercicios: 10 a 15 si algún tema combinado es de práctica, 6 a 8 si todos son de comprensión — más que un repaso normal, porque la meta es practicar, no leer. Dificultad mezclada (no solo fáciles), y varios que solo se resuelven combinando más de un tema.
- La trivia es un SIMULADOR: 15 a 20 preguntas que mezclan los temas entre sí, pensadas para resolverse una tras otra contra reloj — igual de cortas y directas que siempre, pero sin agrupar por tema (que no se note "aquí empiezan las de matemáticas").
- "material_extra" debe incluir SIEMPRE un "repaso relámpago" (la chuleta rápida de 3-6 líneas que ya soporta el formato) con lo esencial de todos los temas — es lo primero que alguien relee minutos antes de entrar al examen.`
    : `- El resumen debe ser un repaso INTEGRADO: qué comparten los temas, en qué se diferencian o pueden confundirse, y las ideas clave de cada uno — no un resumen nuevo de cero de cada tema por separado.
- La trivia y los ejercicios deben MEZCLAR los temas (algunas preguntas que solo se pueden responder si se entendieron varios de los temas a la vez), no ser un bloque de preguntas por tema.
- Usa 8 a 12 preguntas de trivia (más que un tema normal, porque cubre más terreno) y 6 a 10 ejercicios si algún tema de los combinados es de práctica.`;

  return `${proposito}${bloqueCorreccion}

TEMAS A COMBINAR (nivel de referencia: ${nivelLabel}):
${listaTemas}

${instruccionActividad}

INSTRUCCIONES:
- El campo "tema" del resultado debe ser un título corto que junte los temas (ej. "${esExamen ? "Simulacro: Fracciones y Números decimales" : "Repaso: Fracciones y Números decimales"}"), no una lista con comas.
${instruccionesEnfoque}
- Sigue exactamente el mismo formato JSON de salida que un material de tema normal.

FORMATO DE SALIDA — responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta:
${
  modo === "grupo"
    ? `{
  "tema": "...",
  "es_de_practica": true,
  "resumen": { "que_es": "...", "secciones": [ { "titulo": "...", "texto": "..." } ], "pasos": [], "ideas_clave": ["...", "..."], "ojo_aqui": "...", "truco": "..." },
  "esquema_visual": "...",
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|ninguno", "titulo": "...", "datos": {} },
  "actividades": [ { "inteligencia": "linguistica|logico_matematica|espacial|musical|kinestesica|interpersonal|intrapersonal|naturalista", "titulo": "...", "instrucciones": "..." } ],
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["..."], "respuesta": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "..." } ],
  "respuestas": { "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ], "solucion_actividad": "...", "conceptos_clave": ["...", "..."], "autoevaluacion": "..." }
}
"actividades" debe traer exactamente 8 elementos, uno por cada inteligencia.`
    : `{
  "tema": "...",
  "es_de_practica": true,
  "resumen": { "que_es": "...", "secciones": [ { "titulo": "...", "texto": "..." } ], "pasos": [], "ideas_clave": ["...", "..."], "ojo_aqui": "...", "truco": "..." },
  "esquema_visual": "...",
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|ninguno", "titulo": "...", "datos": {} },
  "actividad": { "titulo": "...", "instrucciones": "..." },
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["..."], "respuesta": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "..." } ],
  "respuestas": { "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ], "solucion_actividad": "...", "conceptos_clave": ["...", "..."], "autoevaluacion": "..." }
}`
}

Mantén un tono educativo, claro y positivo, adecuado para el nivel ${nivelLabel}.`;
}

async function intentarCombinar(prompt) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 12000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return normalizarContenido(JSON.parse(cleanedText));
}

/**
 * @param {Array<{tema:string, nivel:string|null, contenido:object}>} temasFuente - 2 a 6 temas ya generados
 * @param {"individual"|"grupo"} modo
 * @param {"estudio"|"examen"} [enfoque] - "estudio" (default, repaso de siempre)
 * o "examen" (Modo Examen: menos resumen, más ejercicios, trivia como simulador).
 * @param {string} [instruccionesCorrectivas] - notas de una ronda anterior de
 * utils/revisorCalidad.js (ver routes/temas.js), para pedir una regeneración
 * corregida en vez de repetir el mismo resultado.
 */
async function combinarTemas(temasFuente, modo = "individual", enfoque = "estudio", instruccionesCorrectivas = "") {
  const enfoqueFinal = enfoque === "examen" ? "examen" : "estudio";
  const prompt = buildPromptCombinar(temasFuente, modo, enfoqueFinal, instruccionesCorrectivas);

  try {
    return await intentarCombinar(prompt);
  } catch (err) {
    try {
      return await intentarCombinar(prompt);
    } catch (err2) {
      throw new Error(`No se pudo armar el repaso combinado — la respuesta llegó incompleta. Intenta de nuevo. (${err2.message})`);
    }
  }
}

module.exports = { combinarTemas };
