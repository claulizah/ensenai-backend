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
 * Técnicas concretas por nivel, basadas en investigación propia de Claudia
 * sobre tipos de ejercicios por etapa de desarrollo cognitivo (documento
 * "Sistema Cognitivo Integral" — mapea edad × inteligencia con pasos para
 * aprender y para repasar, más el marco de repaso espaciado/evocación activa
 * de Ebbinghaus). Sirve como referencia de qué tan concretas y de qué tipo
 * deben ser las actividades en cada etapa, no como plantilla literal —
 * el generador debe adaptar la técnica al tema, no copiar los ejemplos.
 */
const TECNICAS_POR_NIVEL = {
  preescolar: [
    "Corporal-kinestésica: asociar el concepto con texturas o materiales físicos distintos (suave/áspero/viscoso) mientras se repite en voz alta la palabra clave; clasificar objetos físicos corriendo hacia la canasta o zona correcta.",
    "Musical: contar o explicar el tema como un cuento corto con una onomatopeya o sonido repetitivo asociado a la idea principal, acompañado de un instrumento simple o palmadas.",
    "Visual-espacial: trazar la forma o el símbolo del concepto en grande (con el dedo, en arena, pintura o aire) guiando la mano del niño y luego dejándolo intentarlo solo.",
    "Lógico-matemática: usar objetos físicos tangibles (bloques, botones, pasos) para representar cantidades o para completar un patrón simple que se repite (ej. color-color-forma-___).",
    "Verbal-lingüística: narrar y dejar que el niño complete la frase o la rima en el momento clave, celebrando cuando acierta.",
  ],
  primaria_baja: [
    "Lógico-matemática: convertir el tema en un juego de mesa o de puntos sencillo con reglas propias que el estudiante ayude a diseñar.",
    "Visual-espacial: dividir una hoja en 3-4 cuadrantes y dibujar (no escribir) la secuencia o las partes clave del tema, una por cuadrante.",
    "Corporal-kinestésica: representar el concepto con una escena corta actuada, o moverse físicamente entre \"estaciones\" que representan cada parte del tema.",
    "Interpersonal: un juego de roles breve (ej. cliente/vendedor, alumno/maestro) donde se practica el concepto en una situación cotidiana, y luego se invierten los papeles.",
  ],
  primaria_alta: [
    "Lógico-matemática: organizar la información en una tabla o matriz de clasificación con una pregunta filtro que el estudiante deba responder para cada elemento.",
    "Visual-espacial: construir un storyboard (dibujos en secuencia, con muy pocas palabras) o un diorama simple que represente el tema.",
    "Corporal-kinestésica: un reto físico de repaso (correr a anotar una respuesta, formar palabras o conceptos con el cuerpo o moviéndose por el espacio).",
    "Interpersonal: explicarle el tema a otra persona (un peluche, un hermano, un adulto) como si esa persona no supiera nada del tema.",
  ],
  secundaria: [
    "Visual-espacial: mapa mental con dos colores (uno para ideas principales, otro para ejemplos/detalles) y un ícono o dibujo simple junto a cada idea clave.",
    "Musical/auditiva: grabar una nota de voz de 2-3 minutos explicando el tema con tono conversacional, para escucharla después mientras camina.",
    "Verbal-lingüística: tomar notas en formato Cornell (columna de palabras clave a la izquierda, notas normales a la derecha, resumen de máximo 4 líneas al pie) y condensar el tema en tarjetas de repaso de máximo 3 oraciones.",
    "Sugerir que el repaso se distribuya en varias sesiones cortas (ej. a las 8 horas, a los 3 días, a los 7 días) en vez de una sola sesión larga — la evocación activa espaciada fija mejor la memoria que la relectura.",
  ],
  preparatoria: [
    "Lógico-matemática: construir un árbol de decisión o diagrama de flujo que muestre las relaciones de causa-efecto del tema, en vez de solo memorizar datos sueltos.",
    "Verbal/intrapersonal: redactar una explicación breve del tema como si fuera para alguien que no sabe nada, sin usar tecnicismos (o explicándolos de inmediato con una analogía simple) — es la base de la Técnica Feynman.",
    "Corporal-kinestésica: repasar de pie o caminando, recitando el esquema del tema en voz alta sin mirar los apuntes.",
    "Sugerir llevar un registro breve de los errores más frecuentes (qué se falló y por qué) para enfocar el repaso ahí, en vez de repasar todo por igual.",
  ],
  universidad: [
    "Interpersonal/verbal: debatir el tema defendiendo una postura asignada (no necesariamente la propia opinión), o intercambiar trabajos de forma anónima para revisarlos con una rúbrica.",
    "Visual-espacial/kinestésica: asociar los datos o pasos del tema a lugares o rutas físicas conocidas (\"palacio de la memoria\"), o traducir un texto denso en un diagrama.",
    "Sugerir, antes de una evaluación de alta presión, un ejercicio breve de \"descarga mental\": escribir en unos minutos todo lo que genera ansiedad de olvidar, sin preocuparse por el orden — libera memoria de trabajo para la prueba real.",
  ],
};

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

  const tecnicasNivel = TECNICAS_POR_NIVEL[nivel];
  const bloqueTecnicasNivel = tecnicasNivel
    ? `\n\nReferencia de qué tan concretas deben ser las técnicas para esta edad (${nivelLabel}, ${edadLabel} años) — adapta la IDEA al tema, no copies el ejemplo literal:\n${tecnicasNivel.map((t) => `- ${t}`).join("\n")}`
    : "";

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
- Cuando el tema tenga dos conceptos que se confunden fácilmente entre sí (por ejemplo, dos términos parecidos o una regla con excepción), acláralo explícitamente con una nota breve tipo "Ojo aquí, no se confundan: ..." en vez de solo definir cada uno por separado.
- Si existe un truco mnemotécnico simple y natural para recordar el tema (una asociación de sonido, imagen, palabra o gesto), inclúyelo como un tip breve dentro del resumen.

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
${bloqueTecnicasNivel}

### Estilo de las instrucciones (muy importante)
- Escribe las instrucciones como PASOS numerados, muy concretos y accionables — algo que un adulto pueda leer una vez y ejecutar de inmediato con el estudiante, sin interpretar nada (ej. "1. Digan el verso en voz alta y den un paso por cada sílaba. 2. Cuenten los pasos al final..." en vez de "practiquen el conteo de sílabas").
- Favorece actividades que el estudiante pueda VIVIR con el cuerpo o con roles activos (caminar, aplaudir, actuar una escena corta, moverse por estaciones, ser el/la "maestro/a" que revisa la respuesta de otra persona) en lugar de actividades puramente de lectura o de responder por escrito, especialmente en preescolar y primaria.
- Cuando tenga sentido, incluye una variante de "roles invertidos" (el estudiante le explica o le toma el examen a un adulto) — enseñar algo en voz alta ayuda a fijar el aprendizaje.

## 3. REPASO — ACTIVIDAD LIGERA

El repaso debe funcionar como EVOCACIÓN ACTIVA (recordar sin ver el material), no como relectura — es lo que realmente fija el aprendizaje en la memoria de largo plazo. Cuando aplique, sugiere que se repita en más de una sesión corta separada en el tiempo, en vez de una sola vez.

Crea un repaso breve utilizando recuperación activa, adaptado al nivel:
- Preescolar: repetición oral, identificación de imágenes, memorama, verdadero/falso muy sencillo.
- Primaria baja: verdadero/falso, opción única, completar palabras, relacionar conceptos.
- Primaria alta: 3-4 opciones, comparaciones, causa-efecto, ordenar conceptos.
- Secundaria: preguntas con contexto, aplicación del conocimiento, problemas breves, explicar por qué una respuesta es correcta, autoevaluación en primera persona.
- Preparatoria: análisis, interpretación, aplicación, comparación de conceptos, resolución de casos.
- Universidad/autodidacta: preguntas tipo examen, casos prácticos, análisis crítico, transferencia del conocimiento, preguntas abiertas, referencias o fuentes confiables cuando sean útiles.

## 4. MATERIAL EXTRA
Elige 1 o 2 recursos adecuados para la edad: flashcards, memorama, crucigrama, mini-glosario, relacionar columnas, completar conceptos, línea del tiempo, o tarjetas de preguntas. No incluyas recursos innecesarios.
Si eliges memorama, relacionar columnas o flashcards, genera directamente el contenido real de las tarjetas (los pares término/definición o pregunta/respuesta completos y listos para recortar), no solo la instrucción de "hagan tarjetas".
Si el tema lo amerita, agrega al final del material extra un mini "repaso relámpago": una lista muy breve (3-6 líneas) con lo esencial para repasar justo antes de un examen o evaluación, en formato de chuleta rápida.

## 5. RESPUESTAS
Incluye: respuestas de la trivia, solución o resultado esperado de la actividad, 3 conceptos que el estudiante debería recordar, y una pregunta final de autoevaluación.
Si el tema tiene errores típicos o confusiones frecuentes entre estudiantes de ese nivel, menciónalos brevemente como parte de los conceptos clave (ej. "Recuerda: X no es lo mismo que Y").
Cuando el tono lo permita, enmarca el reconocimiento hacia el esfuerzo y el proceso (cómo se llegó a la respuesta) en vez de solo hacia el resultado o la inteligencia de la persona — ayuda a construir una mentalidad de crecimiento.

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
