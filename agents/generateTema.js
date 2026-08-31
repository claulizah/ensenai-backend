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
 * @param {"escolar"|"psicoeducativo"} enfoque - "escolar" (default): material
 * tipo clase, con ejercicios de práctica académica. "psicoeducativo": mismo
 * JSON de salida, pero la actividad y los "ejercicios" dejan de ser
 * dinámicas/tareas escolares y pasan a ser estrategias de afrontamiento,
 * regulación emocional o práctica para casa — pensado para uso en terapia,
 * orientación o consulta psicológica (ver liga de grupo para psicólogos).
 */
function buildPrompt(tema, nivel, perfilDominante, modo = "individual", detalles = "", tieneImagenes = false, enfoque = "escolar") {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";
  const esPsicoeducativo = enfoque === "psicoeducativo";

  const tiposAUsar = modo === "grupo" ? TIPOS_TODOS : perfilDominante && perfilDominante.length ? perfilDominante : ["linguistica"];
  const inteligenciasLabel = tiposAUsar.map((t) => ETIQUETAS_INTELIGENCIA[t] || t).join(", ");

  const instruccionActividad = esPsicoeducativo
    ? modo === "grupo"
      ? `Este material es para un GRUPO de pacientes/consultantes con perfiles mezclados — genera UNA actividad para CADA UNA de las 8 inteligencias (tabla completa), pero cada una debe ser una forma distinta de trabajar el tema desde lo emocional (afrontamiento, regulación, reflexión), no una dinámica escolar.`
      : `Adapta TODO el contenido a la edad e inteligencia(s) indicadas. La actividad debe ser UNA estrategia de afrontamiento, regulación emocional o práctica para casa relacionada con el tema — no una dinámica de tipo escolar. Si se indican varias inteligencias, combina sus técnicas de manera natural en esa única actividad.`
    : modo === "grupo"
      ? `Este material es para un GRUPO (salón de clase o grupo de pacientes) con perfiles de aprendizaje mezclados — genera UNA actividad para CADA UNA de las 8 inteligencias (tabla completa), no elijas solo una o dos. Así el profesional puede repartir la actividad adecuada según cada estudiante.`
      : `Adapta TODO el contenido a la edad, grupo escolar, e inteligencia(s) predominante(s) indicadas. Si se indican varias inteligencias, combina sus técnicas de manera natural en UNA sola actividad (no generes una tabla de las 8).`;

  const bloqueEnfoquePsicoeducativo = esPsicoeducativo
    ? `

ENFOQUE: APOYO PSICOEDUCATIVO (esto NO es material escolar)
Este material se usa en un contexto de acompañamiento psicológico o emocional (terapia, orientación, consulta), no en un salón de clase. Ajusta TODO el material a ese contexto, incluyendo el JSON de salida más abajo (los mismos campos, pero con este contenido):
- Tono cálido, validante y sin juzgar — nunca en tono de examen o evaluación académica. Evita palabras como "calificación", "error" o "incorrecto"; usa "vamos a explorar otra forma de verlo" en su lugar.
- No diagnostiques ni asumas que un ejemplo describe la vida real de quien lo usa. Plantea las situaciones como hipotéticas o generales ("imagina que...", "a veces pasa que...", "algunas personas sienten...").
- Sección 2 (actividad): en vez de una dinámica escolar, es UNA estrategia concreta de afrontamiento, regulación emocional o comunicación relacionada con el tema, para practicar en casa o entre sesiones.
- Sección 2B ("ejercicios" en el JSON): usa los mismos campos (\`enunciado\`, \`pista\`, \`pasos\`, \`respuesta\`) pero con contenido práctico, no académico — por ejemplo un registro de pensamientos/emociones, una práctica guiada paso a paso de una técnica (respiración, reestructuración cognitiva, comunicación asertiva) o un ejercicio para hacer en familia. \`pasos\` es el procedimiento concreto a seguir; \`respuesta\` es la reflexión o el resultado esperado, no "la solución correcta".
- Trivia y repaso: preguntas para recordar y aplicar lo trabajado en la sesión (evocación activa), nunca con formato ni tono de examen.
- Material extra: recursos para practicar en casa (tarjetas con frases de afrontamiento, registro de emociones, etc.), no material de estudio escolar.
- Si el tema no es de contexto escolar, usa "la persona" o "quien participa" en vez de "el estudiante" o "el alumno" en el material.`
    : "";

  const tecnicasNivel = TECNICAS_POR_NIVEL[nivel];
  const bloqueTecnicasNivel = tecnicasNivel
    ? `\n\nReferencia de qué tan concretas deben ser las técnicas para esta edad (${nivelLabel}, ${edadLabel} años) — adapta la IDEA al tema, no copies el ejemplo literal:\n${tecnicasNivel.map((t) => `- ${t}`).join("\n")}`
    : "";

  // Contexto opcional que aporta quien genera el tema: una nota escrita
  // ("solo van a ver la Segunda Guerra hasta 1942", "enfócate en la parte
  // de fracciones equivalentes") y/o la foto del resumen o apuntes que les
  // dieron en clase. Ambos ORIENTAN el material sin limitarlo: el generador
  // puede ampliar más allá de lo que traiga la foto, para que el material
  // siga siendo completo aunque el apunte esté incompleto o mal escrito.
  const bloqueContexto =
    detalles || tieneImagenes
      ? `

CONTEXTO ADICIONAL DE QUIEN PIDE EL MATERIAL
${detalles ? `- Indicaciones escritas: ${detalles}` : ""}${
          tieneImagenes
            ? `\n- Se adjunta(n) imagen(es) de un resumen, apuntes o material de clase. Léelas y úsalas como ORIENTACIÓN: respeta el enfoque, los términos y el alcance que traen, y prioriza esos puntos en el material. No te limites únicamente a lo que aparece ahí — puedes completar, corregir y ampliar lo necesario para que el material quede completo y correcto para el nivel indicado. Si la imagen no se alcanza a leer bien o no tiene que ver con el tema, ignórala y genera el material normalmente a partir del tema escrito.`
            : ""
        }
Toma este contexto en cuenta en todas las secciones (resumen, actividad, trivia y material extra), sin mencionarlo explícitamente en el material — el estudiante no debe leer frases como "según el resumen que subiste".`
      : "";

  return `Genera material educativo sobre el tema: ${tema}.${bloqueContexto}

PERFIL DEL ESTUDIANTE
- Grupo escolar: ${nivelLabel}
- Edad aproximada: ${edadLabel}
- Inteligencia(s) a considerar: ${inteligenciasLabel}
- Modo: ${modo === "grupo" ? "grupo (tabla de las 8 inteligencias)" : "individual (perfil dominante de una persona)"}

REGLA PRINCIPAL
Adapta TODO el contenido a la edad y grupo escolar indicados.
No uses vocabulario, actividades ni preguntas de un nivel superior al correspondiente.
${instruccionActividad}
${bloqueEnfoquePsicoeducativo}

IMPORTANTE:
Las inteligencias representan diferentes formas de acercarse y practicar el contenido, no "estilos fijos" de aprendizaje.

## 0. ¿ES UN TEMA DE PRÁCTICA O DE COMPRENSIÓN?

Antes que nada decide de qué tipo es el tema y ponlo en el campo \`es_de_practica\`:

- **De práctica (\`true\`)**: se domina RESOLVIENDO, no leyendo. Matemáticas, física, química, estadística, programación, reglas de ortografía y gramática, conversión de unidades, análisis sintáctico, contabilidad. En estos temas, media hora resolviendo vale más que dos horas leyendo teoría.
- **De comprensión (\`false\`)**: se domina entendiendo y relacionando ideas. Historia, biología, literatura, geografía, civismo, filosofía, psicología.

Esta decisión cambia el balance del material:

| | De práctica | De comprensión |
|---|---|---|
| Teoría | Mínima — solo lo indispensable para poder resolver | Desarrollada |
| Ejercicios | **6 a 8**, de dificultad creciente | 2 a 3, de aplicación o análisis |

**Regla dura para temas de práctica:** la teoría existe para habilitar la práctica, no al revés. No expliques de más antes de poner a la persona a resolver.

## 1. ESTUDIO — MATERIAL BASE

### Resumen (¡OJO CON EL FORMATO!)
El resumen **NO es un bloque de texto corrido**. Es un objeto con partes separadas, porque un párrafo largo hace que la gente pierda la atención y deje de leer. Cada parte va en su propio campo:

- **\`que_es\`**: 2 a 4 líneas, nada más. La idea central del tema, en lenguaje llano, como se la explicarías a alguien en la puerta del salón. Sin rodeos ni introducciones.
- **\`secciones\`**: de 2 a 4 bloques cortos, cada uno con su \`titulo\` (3-6 palabras, concreto: "Cuándo se usa", "El caso difícil", "De dónde viene") y su \`texto\` (máximo 4-5 líneas). Cada sección trata UNA cosa. Si una sección se te alarga, pártela en dos.
- **\`pasos\`**: SOLO si el tema es un procedimiento (resolver algo, aplicar un método, seguir una regla). Un arreglo de strings, un paso por elemento, cada uno de una línea y empezando con un verbo. **Nunca metas los pasos numerados dentro de un párrafo** — van aquí, separados.
- **\`ideas_clave\`**: de 3 a 7 frases sueltas, cada una de una sola línea. Lo que debe quedarse en la cabeza aunque se olvide todo lo demás.
- **\`ojo_aqui\`**: solo si aplica. La confusión típica de este tema, en una o dos líneas, con el formato "X no es lo mismo que Y: ...". Si no hay una confusión real y frecuente, deja el campo vacío — no inventes una.
- **\`truco\`**: solo si existe uno natural. Una mnemotecnia breve (asociación de sonido, palabra, imagen o gesto) para recordar lo esencial. Si no hay uno bueno, deja el campo vacío en vez de forzarlo.

Usa vocabulario apropiado para la edad e incluye ejemplos concretos dentro de las secciones.

### Diagrama (campo \`diagrama\`) — se dibuja de verdad, no es texto
Además del resumen, elige **un** diagrama que ayude a VER la estructura del tema. No lo dibujes con guiones ni con arte ASCII: solo entrega los datos, y la plataforma lo dibuja como gráfico real.

Elige el tipo según lo que el tema realmente es:

| Tipo | Cuándo usarlo | Qué poner en \`datos\` |
|---|---|---|
| \`mapa_mental\` | El tema tiene un concepto central que se abre en ramas | \`{ "centro": "...", "ramas": [ { "titulo": "...", "hijos": ["...", "..."] } ] }\` — de 3 a 5 ramas, con 0 a 3 hijos cada una |
| \`linea_tiempo\` | Hay una secuencia de hechos con fechas o etapas | \`{ "hitos": [ { "fecha": "1939", "titulo": "...", "detalle": "..." } ] }\` — de 4 a 7 hitos |
| \`comparativo\` | Se comparan 2 o 3 cosas que se confunden entre sí | \`{ "columnas": ["Narrativo", "Dramático"], "filas": [ { "criterio": "¿Quién cuenta?", "valores": ["Un narrador", "Los personajes"] } ] }\` — de 3 a 5 filas |
| \`proceso\` | Hay pasos que van en un orden fijo | \`{ "pasos": [ { "titulo": "Despejar", "detalle": "..." } ] }\` — de 3 a 6 pasos |
| \`ciclo\` | Las etapas se repiten en círculo (agua, vida, estaciones) | \`{ "etapas": [ { "titulo": "Evaporación", "detalle": "..." } ] }\` — de 3 a 6 etapas |
| \`jerarquia\` | Hay categorías que se subdividen (clasificaciones, taxonomías) | \`{ "raiz": "...", "niveles": [ { "titulo": "...", "hijos": ["...", "..."] } ] }\` |
| \`partes\` | Algo se descompone en partes que conviene etiquetar | \`{ "todo": "La célula", "partes": [ { "nombre": "Núcleo", "funcion": "..." } ] }\` — de 3 a 6 partes |

Reglas del diagrama:
- **Textos MUY cortos.** Cada etiqueta de 1 a 4 palabras; los campos \`detalle\` máximo una línea. Un diagrama con frases largas deja de ser diagrama.
- Elige el tipo que **de verdad corresponde** al tema. Si el tema es un procedimiento, \`proceso\`; si es una comparación, \`comparativo\`. No fuerces un mapa mental para todo.
- \`titulo\`: una frase corta que diga qué muestra el diagrama.
- Si de plano ningún tipo le queda al tema, pon \`"tipo": "ninguno"\` y deja \`datos\` como objeto vacío. Es preferible eso a un diagrama forzado que no aporta.

### Esquema visual (texto, complementario al diagrama)
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

## 2B. EJERCICIOS RESUELTOS — LA PARTE MÁS IMPORTANTE EN TEMAS DE PRÁCTICA

Genera ejercicios para resolver: **6 a 8 si \`es_de_practica\` es true, 2 a 3 si es false.**

Cada ejercicio lleva:
- **\`enunciado\`**: el problema concreto a resolver. En matemáticas, con números reales, no con "sea un número cualquiera". Que se pueda resolver con lápiz y papel.
- **\`pista\`**: una línea que empuja en la dirección correcta sin resolver nada ("despeja x en la segunda ecuación, que es la más fácil"). Es lo que diría un maestro al pasar junto al banco.
- **\`pasos\`**: el procedimiento completo, un paso por elemento del arreglo, mostrando las operaciones de verdad ("2(1 + y) + y = 11" y no "sustituimos y operamos"). Quien se equivocó tiene que poder ubicar EN QUÉ PASO se equivocó — ese es el propósito.
- **\`respuesta\`**: el resultado final, corto y sin ambigüedad.

Reglas:
- **Dificultad creciente.** El primero debe poder resolverse con lo que acaba de leer; el último debe exigir combinar cosas. Nunca empieces por el difícil.
- **Varía la forma.** No pongas seis veces el mismo ejercicio con distintos números. Cambia el tipo de caso: uno directo, uno con negativos, uno con fracciones, uno planteado como problema de la vida real, uno donde haya que darse cuenta de algo.
- **Al menos uno debe ser un problema en palabras**, no solo operaciones sueltas, para que se vea para qué sirve el tema.
- **Adapta la dificultad al nivel escolar** indicado, no al tema en abstracto.
- En temas de comprensión, los "ejercicios" son de aplicación o análisis (interpretar un caso, comparar dos situaciones, explicar por qué pasó algo), y \`pasos\` es el razonamiento que lleva a la respuesta.

## 3. REPASO — ACTIVIDAD LIGERA

El repaso debe funcionar como EVOCACIÓN ACTIVA (recordar sin ver el material), no como relectura — es lo que realmente fija el aprendizaje en la memoria de largo plazo. Cuando aplique, sugiere que se repita en más de una sesión corta separada en el tiempo, en vez de una sola vez.

Crea un repaso breve utilizando recuperación activa, adaptado al nivel:
- Preescolar: repetición oral, identificación de imágenes, memorama, verdadero/falso muy sencillo.
- Primaria baja: verdadero/falso, opción única, completar palabras, relacionar conceptos.
- Primaria alta: 3-4 opciones, comparaciones, causa-efecto, ordenar conceptos.
- Secundaria: preguntas con contexto, aplicación del conocimiento, problemas breves, explicar por qué una respuesta es correcta, autoevaluación en primera persona.
- Preparatoria: análisis, interpretación, aplicación, comparación de conceptos, resolución de casos.
- Universidad/autodidacta: preguntas tipo examen, casos prácticos, análisis crítico, transferencia del conocimiento, preguntas abiertas, referencias o fuentes confiables cuando sean útiles.

### Cómo redactar las preguntas de la trivia (muy importante)
El objetivo es que se entiendan de una sola leída, sin que nadie tenga que releer la pregunta para saber qué le están preguntando. Sigue estas reglas al escribir cada una:
- **Cortas y directas.** Máximo una o dos líneas. "¿Por qué empezó la guerra en 1939?" en vez de "¿Cuál de las siguientes opciones describe mejor las causas que detonaron el conflicto bélico de 1939?".
- **Nunca empieces con "¿Cuál de las siguientes opciones…?"**, "¿Cuál de los siguientes enunciados…?" ni fórmulas de examen parecidas. Pregunta la cosa directamente.
- **Una sola idea por pregunta.** Si necesitas preguntar dos cosas, haz dos preguntas.
- **Lenguaje de todos los días**, el que usaría alguien de esa edad al hablar. Usa el término técnico solo si es justo lo que se está evaluando; si aparece, que la pregunta deje claro por contexto de qué se trata.
- **Sin dobles negaciones** ni "todas las anteriores" / "ninguna de las anteriores".
- **Opciones cortas y parejas**: pocas palabras cada una, de largo parecido entre sí (que la correcta no se note por ser la más larga o la más detallada), y todas creíbles — nada de opciones absurdas de relleno.
- **Habla de tú**, en tono cercano y sin regañar. Puedes usar situaciones cotidianas o nombres de personas para aterrizar la pregunta, sobre todo en preescolar y primaria.
- En preescolar y primaria baja, frases muy cortas y concretas; nada de subordinadas ni de "según el texto".
- En preparatoria y universidad la pregunta puede exigir análisis, pero **la redacción sigue siendo simple**: la dificultad está en pensar la respuesta, no en descifrar el enunciado.

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
  "es_de_practica": true,
  "resumen": {
    "que_es": "...",
    "secciones": [ { "titulo": "...", "texto": "..." } ],
    "pasos": ["...", "..."],
    "ideas_clave": ["...", "...", "..."],
    "ojo_aqui": "...",
    "truco": "..."
  },
  "esquema_visual": "...",
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|ninguno", "titulo": "...", "datos": {} },
  "actividades": [ { "inteligencia": "linguistica|logico_matematica|espacial|musical|kinestesica|interpersonal|intrapersonal|naturalista", "titulo": "...", "instrucciones": "..." } ],
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["...", "..."], "respuesta": "..." } ],
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
  "es_de_practica": true,
  "resumen": {
    "que_es": "...",
    "secciones": [ { "titulo": "...", "texto": "..." } ],
    "pasos": ["...", "..."],
    "ideas_clave": ["...", "...", "..."],
    "ojo_aqui": "...",
    "truco": "..."
  },
  "esquema_visual": "...",
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|ninguno", "titulo": "...", "datos": {} },
  "actividad": { "titulo": "...", "instrucciones": "..." },
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["...", "..."], "respuesta": "..." } ],
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

RECORDATORIOS DE FORMATO (los errores más comunes):
- \`resumen\` es un OBJETO, nunca un string. Si escribes todo el resumen como un párrafo, el material se vuelve una pared de texto y la persona deja de leer — que es exactamente lo que estamos evitando.
- \`pasos\`, \`ideas_clave\` y \`ejercicios[].pasos\` son ARREGLOS. Un elemento por paso o por idea. Nunca metas "1. … 2. … 3. …" dentro de un solo string.
- \`ojo_aqui\` y \`truco\` pueden ir vacíos ("") si no aplican al tema. Es preferible dejarlos vacíos a inventar algo forzado.
- Deja \`pasos\` vacío ([]) si el tema no es un procedimiento.

Mantén un tono educativo, claro, positivo y adecuado para la edad.`;
}

/**
 * @param {string} tema
 * @param {"preescolar"|"primaria_baja"|"primaria_alta"|"secundaria"|"preparatoria"|"universidad"} nivel
 * @param {string[]} perfilDominante - ej. ["espacial","linguistica"], viene de calcularResultado() (ignorado si modo="grupo")
 * @param {"individual"|"grupo"} modo - "grupo" genera la tabla completa de 8 inteligencias (ver liga de grupo)
 */
// El material completo (resumen + actividad(es) + trivia + material extra +
// respuestas, y en modo grupo hasta 8 actividades) puede superar fácil los
// 4000 tokens de salida — con ese límite Claude a veces se quedaba a media
// cadena y el JSON llegaba truncado ("Unterminated string"). Subimos el
// límite y, si aun así llega mal formado (corte raro, red inestable, etc.),
// reintentamos la generación una vez antes de rendirnos.
const TIPOS_IMAGEN_VALIDOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGENES = 3; // un resumen normalmente cabe en 1-3 fotos

/**
 * Convierte lo que manda el frontend en bloques de imagen que entiende la
 * API de Claude. Acepta tanto un data URL completo
 * ("data:image/jpeg;base64,...") como { media_type, data }. Descarta en
 * silencio cualquier cosa que no sea una imagen válida — una foto mal
 * subida nunca debe tumbar la generación, solo se ignora.
 */
function normalizarImagenes(imagenes) {
  if (!Array.isArray(imagenes)) return [];

  return imagenes
    .map((img) => {
      if (typeof img === "string") {
        const match = img.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return null;
        return { media_type: match[1], data: match[2] };
      }
      if (img && typeof img === "object" && img.data) {
        return { media_type: img.media_type, data: String(img.data).replace(/^data:[^;]+;base64,/, "") };
      }
      return null;
    })
    .filter((img) => img && TIPOS_IMAGEN_VALIDOS.includes(img.media_type) && img.data.length > 100)
    .slice(0, MAX_IMAGENES)
    .map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.media_type, data: img.data },
    }));
}

/**
 * Deja el contenido siempre en la misma forma, venga como venga del modelo.
 * Dos motivos:
 *  - El modelo a veces regresa `resumen` como string suelto a pesar de las
 *    instrucciones; en ese caso lo metemos en `que_es` para no perderlo.
 *  - Los temas guardados ANTES de este cambio tienen `resumen` como string.
 *    Al normalizar aquí y en el frontend, el historial viejo se sigue viendo
 *    bien sin migrar la base de datos.
 */
function normalizarContenido(c) {
  if (!c || typeof c !== "object") return c;

  const arreglo = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== "") : []);

  let resumen = c.resumen;
  if (typeof resumen === "string") {
    resumen = { que_es: resumen, secciones: [], pasos: [], ideas_clave: [], ojo_aqui: "", truco: "" };
  } else if (resumen && typeof resumen === "object") {
    resumen = {
      que_es: String(resumen.que_es || ""),
      secciones: arreglo(resumen.secciones)
        .filter((s) => s && (s.titulo || s.texto))
        .map((s) => ({ titulo: String(s.titulo || ""), texto: String(s.texto || "") })),
      pasos: arreglo(resumen.pasos).map(String),
      ideas_clave: arreglo(resumen.ideas_clave).map(String),
      ojo_aqui: String(resumen.ojo_aqui || ""),
      truco: String(resumen.truco || ""),
    };
  } else {
    resumen = { que_es: "", secciones: [], pasos: [], ideas_clave: [], ojo_aqui: "", truco: "" };
  }

  const ejercicios = arreglo(c.ejercicios)
    .filter((e) => e && e.enunciado)
    .map((e) => ({
      enunciado: String(e.enunciado),
      pista: String(e.pista || ""),
      pasos: arreglo(e.pasos).map(String),
      respuesta: String(e.respuesta || ""),
    }));

  // El diagrama solo se acepta si el tipo es conocido Y trae datos; si no,
  // se descarta y el frontend simplemente no dibuja nada. Vale más no tener
  // diagrama que dibujar uno vacío o de un tipo que no sabemos pintar.
  const TIPOS_DIAGRAMA = ["mapa_mental", "linea_tiempo", "comparativo", "proceso", "ciclo", "jerarquia", "partes"];
  let diagrama = null;
  if (c.diagrama && typeof c.diagrama === "object" && TIPOS_DIAGRAMA.includes(c.diagrama.tipo)) {
    const datos = c.diagrama.datos && typeof c.diagrama.datos === "object" ? c.diagrama.datos : {};
    if (Object.keys(datos).length) {
      diagrama = { tipo: c.diagrama.tipo, titulo: String(c.diagrama.titulo || ""), datos };
    }
  }

  return { ...c, resumen, ejercicios, diagrama, es_de_practica: c.es_de_practica === true };
}

async function intentarGenerar(prompt, bloquesImagen = []) {
  // Las imágenes van ANTES del texto: la API de Claude recomienda ese orden
  // cuando el texto se refiere a las imágenes.
  const content = bloquesImagen.length ? [...bloquesImagen, { type: "text", text: prompt }] : prompt;

  // 12000: con la estructura nueva el material creció bastante (resumen por
  // secciones + 6-8 ejercicios con su procedimiento completo, y en modo grupo
  // además las 8 actividades). Con 8000 volvía a arriesgarse el corte a media
  // cadena que ya nos pasó una vez.
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 12000,
    messages: [{ role: "user", content }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";

  // Igual que en agents/generate.js: Claude a veces envuelve la respuesta
  // en un bloque ```json ... ``` aunque se le pida solo JSON.
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return normalizarContenido(JSON.parse(cleanedText));
}

/**
 * askClaude(systemPrompt, mensajeUsuario, maxTokens) — wrapper delgado sobre
 * el mismo cliente `anthropic` de arriba, con la firma que espera
 * utils/revisorCalidad.js para su paso de revisión con IA (revisarConIA).
 * No hace limpieza de ```json``` ni parseo: ese módulo espera texto plano
 * ("OK" o una lista "- problema"), no JSON.
 */
async function askClaude(systemPrompt, mensajeUsuario, maxTokens = 1000) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: mensajeUsuario }],
  });
  return response.content.find((b) => b.type === "text")?.text || "";
}

async function generarMaterialTema(tema, nivel, perfilDominante, modo = "individual", opciones = {}) {
  const detalles = String(opciones.detalles || "").trim().slice(0, 1500);
  const bloquesImagen = normalizarImagenes(opciones.imagenes);
  const enfoque = opciones.enfoque === "psicoeducativo" ? "psicoeducativo" : "escolar";
  const prompt = buildPrompt(tema, nivel, perfilDominante, modo, detalles, bloquesImagen.length > 0, enfoque);

  try {
    return await intentarGenerar(prompt, bloquesImagen);
  } catch (err) {
    try {
      return await intentarGenerar(prompt, bloquesImagen);
    } catch (err2) {
      throw new Error(
        `No se pudo generar el material — la respuesta llegó incompleta. Intenta de nuevo. (${err2.message})`
      );
    }
  }
}

module.exports = {
  generarMaterialTema,
  normalizarContenido,
  normalizarImagenes,
  askClaude,
  ETIQUETAS_NIVEL,
  EDAD_APROX,
  ETIQUETAS_INTELIGENCIA,
};
