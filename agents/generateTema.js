const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generador de material por TEMA (pivote sin video) — reemplaza a
 * agents/generate.js (que generaba a partir de una transcripción de video)
 * para el flujo nuevo: tema + nivel + perfil de inteligencia → material
 * completo. Misma arquitectura (llamada a Claude + limpieza de JSON) que
 * ya estaba probada en generate.js.
 */

const ETIQUETAS_NIVEL = {
  preescolar: "Preescolar",
  primaria_baja: "Primaria baja",
  primaria_alta: "Primaria alta",
  secundaria: "Secundaria",
  preparatoria: "Preparatoria",
  universidad: "Universidad / autodidacta",
};

const EDAD_APROX = {
  preescolar: "3-5",
  primaria_baja: "6-8",
  primaria_alta: "9-12",
  secundaria: "12-15",
  preparatoria: "15-18",
  universidad: "18+",
};

const ETIQUETAS_INTELIGENCIA = {
  linguistica: "Lingüística",
  logico_matematica: "Lógico-matemática",
  espacial: "Espacial",
  musical: "Musical",
  kinestesica: "Corporal-kinestésica",
  interpersonal: "Interpersonal",
  intrapersonal: "Intrapersonal",
  naturalista: "Naturalista",
};

const TIPOS_TODOS = [
  "linguistica",
  "logico_matematica",
  "espacial",
  "musical",
  "kinestesica",
  "interpersonal",
  "intrapersonal",
  "naturalista",
];

/**
 * @param {"individual"|"grupo"} modo - "individual": una persona con su
 * perfil dominante ya calculado (1-2 inteligencias). "grupo": pensado para
 * la liga de grupo de maestros/psicólogos — un salón tiene perfiles
 * mezclados, así que se genera UNA actividad por cada una de las 8
 * inteligencias (tabla completa), no solo la(s) dominante(s) de una persona.
 */
function buildPrompt(tema, nivel, perfilDominante, modo = "individual") {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";

  const tiposAUsar = modo === "grupo" ? TIPOS_TODOS : perfilDominante && perfilDominante.length ? perfilDominante : ["linguistica"];
  const inteligenciasLabel = tiposAUsar.map((t) => ETIQUETAS_INTELIGENCIA[t] || t).join(", ");

  const instruccionActividad =
    modo === "grupo"
      ? `Este material es para un GRUPO (salón de clase o grupo de pacientes) con perfiles de aprendizaje mezclados — genera UNA actividad para CADA UNA de las 8 inteligencias (tabla completa), no elijas solo una o dos. Así el profesional puede repartir la actividad adecuada según cada estudiante.`
      : `Adapta TODO el contenido a la edad, grupo escolar, e inteligencia(s) predominante(s) indicadas. Si se indican varias inteligencias, combina sus técnicas de manera natural en UNA sola actividad (no generes una tabla de las 8).`;

  return `Genera material educativo sobre el tema: ${tema}.

PERFIL DEL ESTUDIANTE
- Grupo escolar: ${nivelLabel}
- Edad aproximada: ${edadLabel}
- Inteligencia(s) a considerar: ${inteligenciasLabel}
- Modo: ${modo === "grupo" ? "grupo (tabla de las 8 inteligencias)" : "individual (perfil dominante de una persona)"}

REGLA PRINCIPAL
Adapta TODO el contenido a la edad y grupo escolar indicados.
No uses vocabulario, actividades ni preguntas de un nivel superior al correspondiente.
${instruccionActividad}

IMPORTANTE:
Las inteligencias representan diferentes formas de acercarse y practicar el contenido, no "estilos fijos" de aprendizaje.

## 1. ESTUDIO — MATERIAL BASE

### Resumen
- Explica el tema con la profundidad adecuada para la edad.
- Usa vocabulario apropiado para el grupo.
- Divide la explicación en pequeñas secciones.
- Incluye ejemplos concretos.
- Destaca entre 3 y 7 ideas clave según la dificultad del tema.

### Esquema visual
Elige el formato más adecuado:
- Preescolar → asociación imagen-palabra.
- Primaria baja → esquema sencillo o mapa visual.
- Primaria alta → mapa mental o cuadro comparativo.
- Secundaria → mapa conceptual, cuadro comparativo o línea del tiempo.
- Preparatoria → esquema jerárquico, mapa conceptual o línea del tiempo.
- Universidad/autodidacta → mapa conceptual avanzado, modelo, cuadro comparativo o esquema especializado.
Representa el esquema con texto claro y fácil de visualizar (usa indentación/guiones, no imágenes).

## 2. APRENDIZAJE — DINÁMICA ACTIVA

${
  modo === "grupo"
    ? "Genera UNA actividad concreta por cada una de las 8 inteligencias (tabla completa), siguiendo estos tipos de técnica para cada una:"
    : "Crea UNA actividad relacionada directamente con el tema, combinando de forma natural la(s) inteligencia(s) indicada(s), usando estos tipos de técnica como referencia:"
}
- Lingüística: mini cuento, explicar con palabras propias, completar frases, crear preguntas, relacionar conceptos.
- Lógico-matemática: problemas, patrones, clasificaciones, causa-efecto, comparaciones, resolución de situaciones.
- Espacial: dibujos, diagramas, mapas, ordenar imágenes, completar esquemas.
- Corporal-kinestésica: experimento sencillo, dramatización, simulación, construcción de modelos, reto práctico.
- Musical: rima, ritmo, asociación sonora, canción corta original.
- Interpersonal: actividad en parejas, debate adaptado, juego colaborativo, enseñar el concepto a otra persona.
- Intrapersonal: reflexión, autoevaluación, diario de aprendizaje, relación con experiencias propias.
- Naturalista: clasificar, observar, comparar, identificar patrones, relacionar con elementos del entorno.
Cada actividad debe ser concreta, realizable y divertida. No debe limitarse a pedir que el estudiante "lea y responda".

## 3. REPASO — ACTIVIDAD LIGERA

Crea un repaso breve utilizando recuperación activa, adaptado al nivel:
- Preescolar: repetición oral, identificación de imágenes, memorama, verdadero/falso muy sencillo.
- Primaria baja: verdadero/falso, opción única, completar palabras, relacionar conceptos.
- Primaria alta: 3-4 opciones, comparaciones, causa-efecto, ordenar conceptos.
- Secundaria: preguntas con contexto, aplicación del conocimiento, problemas breves, explicar por qué una respuesta es correcta, autoevaluación en primera persona.
- Preparatoria: análisis, interpretación, aplicación, comparación de conceptos, resolución de casos.
- Universidad/autodidacta: preguntas tipo examen, casos prácticos, análisis crítico, transferencia del conocimiento, preguntas abiertas, referencias o fuentes confiables cuando sean útiles.

## 4. MATERIAL EXTRA
Elige 1 o 2 recursos adecuados para la edad: flashcards, memorama, crucigrama, mini-glosario, relacionar columnas, completar conceptos, línea del tiempo, o tarjetas de preguntas. No incluyas recursos innecesarios.

## 5. RESPUESTAS
Incluye: respuestas de la trivia, solución o resultado esperado de la actividad, 3 conceptos que el estudiante debería recordar, y una pregunta final de autoevaluación.

## REGLAS ESPECIALES

### Menores de 6 años
Usa palabras muy simples, frases de 3-4 palabras cuando sea posible, canciones cortas, juegos de imitación, dibujos y actividades visuales, repaso oral y memorama con imágenes. Evita explicaciones largas.

### Adultos autodidactas
Puedes usar vocabulario técnico, lecturas guiadas, proyectos prácticos, investigación autónoma, casos reales, fuentes y referencias confiables. Prioriza profundidad, aplicación y pensamiento crítico.

### Temas de psicología para adolescentes y adultos
Usa lenguaje claro, respetuoso y empático. Evita diagnosticar al estudiante. No presentes conceptos psicológicos como diagnósticos personales. Explica la terminología clínica solo cuando sea necesaria. Puedes usar reflexión, autoobservación, dinámicas de grupo y situaciones hipotéticas (ej. "¿Qué harías en esta situación?"). Evita asumir que una situación hipotética describe la vida real del estudiante.

## FORMATO DE SALIDA — IMPORTANTE
Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta:

${
  modo === "grupo"
    ? `{
  "tema": "...",
  "resumen": "...",
  "esquema_visual": "...",
  "actividades": [ { "inteligencia": "linguistica|logico_matematica|espacial|musical|kinestesica|interpersonal|intrapersonal|naturalista", "titulo": "...", "instrucciones": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "..." } ],
  "respuestas": {
    "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ],
    "solucion_actividad": "...",
    "conceptos_clave": ["...", "...", "..."],
    "autoevaluacion": "..."
  }
}
"actividades" debe traer exactamente 8 elementos, uno por cada inteligencia.`
    : `{
  "tema": "...",
  "resumen": "...",
  "esquema_visual": "...",
  "actividad": { "titulo": "...", "instrucciones": "..." },
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "..." } ],
  "respuestas": {
    "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ],
    "solucion_actividad": "...",
    "conceptos_clave": ["...", "...", "..."],
    "autoevaluacion": "..."
  }
}`
}

Mantén un tono educativo, claro, positivo y adecuado para la edad.`;
}

/**
 * @param {string} tema
 * @param {"preescolar"|"primaria_baja"|"primaria_alta"|"secundaria"|"preparatoria"|"universidad"} nivel
 * @param {string[]} perfilDominante - ej. ["espacial","linguistica"], viene de calcularResultado() (ignorado si modo="grupo")
 * @param {"individual"|"grupo"} modo - "grupo" genera la tabla completa de 8 inteligencias (ver liga de grupo)
 */
async function generarMaterialTema(tema, nivel, perfilDominante, modo = "individual") {
  const prompt = buildPrompt(tema, nivel, perfilDominante, modo);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";

  // Igual que en agents/generate.js: Claude a veces envuelve la respuesta
  // en un bloque ```json ... ``` aunque se le pida solo JSON.
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

module.exports = { generarMaterialTema, ETIQUETAS_NIVEL, EDAD_APROX, ETIQUETAS_INTELIGENCIA };
