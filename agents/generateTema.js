const Anthropic = require("@anthropic-ai/sdk");
const EnsenaiFiguras = require("../utils/figuras");
const { conReintento, esDeSaturacion, OPCIONES_CLIENTE } = require("../utils/reintento");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...OPCIONES_CLIENTE });

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
 * mezclados, así que se genera UNA actividad diseñada para que le entre todo
 * el grupo ("inteligencia": "todas"). Las 8 de la tabla de Gardner ya no se
 * generan de entrada: se piden aparte con generarActividadesPorInteligencia()
 * (31-ago-2026) para que la generación de grupo no cargue siempre con eso.
 * @param {"escolar"|"psicoeducativo"} enfoque - "escolar" (default): material
 * tipo clase, con ejercicios de práctica académica. "psicoeducativo": mismo
 * JSON de salida, pero la actividad y los "ejercicios" dejan de ser
 * dinámicas/tareas escolares y pasan a ser estrategias de afrontamiento,
 * regulación emocional o práctica para casa — pensado para uso en terapia,
 * orientación o consulta psicológica (ver liga de grupo para psicólogos).
 */
/**
 * PARALELIZAR LA GENERACIÓN (8-sep-2026).
 *
 * Hasta ahora, un tema completo era UNA sola llamada a Claude pidiendo
 * hasta 12000 tokens de salida (resumen + diagrama + actividad(es) +
 * 6-8 ejercicios con procedimiento + trivia + material extra +
 * respuestas, todo junto) — eso es lo que hacía que el caso normal
 * tardara 40-90s: por más rápido que genere el modelo, generar 12000
 * tokens de un jalón toma lo que toma.
 *
 * La idea: partir esa única llamada en DOS que se mandan EN PARALELO
 * (Promise.all), cada una pidiendo aproximadamente la mitad del
 * material. El tiempo total pasa de "una llamada de 12000 tokens" a
 * "la más lenta de dos llamadas de ~6000" — que en la práctica corre en
 * bastante menos tiempo, no la mitad exacta (hay overhead fijo de red
 * por llamada), pero es la ganancia real de fondo, no solo percibida.
 *
 * Por qué el corte es donde es (ESTUDIO+ACTIVIDAD vs PRÁCTICA+REPASO+
 * EXTRA) y no otro: son las dos mitades que menos se necesitan entre sí
 * para tener sentido por separado. La única variable que las dos
 * llamadas necesitan de verdad es `es_de_practica` (afecta cuánta teoría
 * lleva el resumen Y cuántos ejercicios pedir) — en vez de encadenar las
 * llamadas (perdiendo el paralelismo) o mandar una llamada aparte solo
 * para decidirlo, CADA UNA la decide por su cuenta con la misma sección
 * "## 0" del prompt (idéntica en las dos). Si algún día no coinciden
 * (raro: el tema es ambiguo entre práctica/comprensión), el resultado
 * final se queda con la decisión de la llamada de ESTUDIO — y si eso deja
 * el número de ejercicios por debajo de lo que pide esa decisión, el
 * validador de estructura (utils/revisorCalidad.js) lo detecta gratis y
 * lo manda al parche barato (ver repararSecciones más abajo), NUNCA a
 * regenerar las dos mitades — el ocasional desacuerdo se autocorrige
 * solo y sale barato, no le cuesta nada a partir la generación en dos.
 *
 * Las imágenes (fotos de apuntes) se mandan a las DOS llamadas: son
 * opcionales y ligeras (máximo 3), y tanto el resumen como los
 * ejercicios pueden necesitar lo que traigan.
 */

/** Preámbulo compartido por las dos mitades — tema, perfil, reglas
 * generales y la decisión de si el tema es de práctica o de comprensión.
 * Ninguna de las dos mitades tiene sentido sin esto. */
function construirPreambulo(tema, nivel, perfilDominante, modo, detalles, tieneImagenes, enfoque) {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";
  const esPsicoeducativo = enfoque === "psicoeducativo";

  const tiposAUsar = modo === "grupo" ? TIPOS_TODOS : perfilDominante && perfilDominante.length ? perfilDominante : ["linguistica"];
  const inteligenciasLabel = tiposAUsar.map((t) => ETIQUETAS_INTELIGENCIA[t] || t).join(", ");

  const instruccionActividad = esPsicoeducativo
    ? modo === "grupo"
      ? `Este material es para un GRUPO de pacientes/consultantes con perfiles mezclados — genera UNA SOLA actividad que le funcione a todo el grupo: una estrategia de afrontamiento, regulación emocional o reflexión (no una dinámica escolar) que se pueda trabajar de varias formas a la vez (hablándolo, escribiéndolo, dibujándolo o con movimiento), para que nadie se quede fuera por su forma de participar. En "actividades" va ese único elemento, con "inteligencia": "todas".`
      : `Adapta TODO el contenido a la edad e inteligencia(s) indicadas. La actividad debe ser UNA estrategia de afrontamiento, regulación emocional o práctica para casa relacionada con el tema — no una dinámica de tipo escolar. Si se indican varias inteligencias, combina sus técnicas de manera natural en esa única actividad.`
    : modo === "grupo"
      ? `Este material es para un GRUPO (salón de clase o grupo de pacientes) con perfiles de aprendizaje mezclados — genera UNA SOLA actividad diseñada para que le entre TODO el grupo, sin importar cómo aprende cada quien: que la misma actividad se pueda resolver hablando, escribiendo, dibujando o moviéndose, y que quien participe pueda elegir cómo entrarle. En "actividades" va ese único elemento, con "inteligencia": "todas". No generes la tabla de las 8 inteligencias.`
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
- Modo: ${modo === "grupo" ? "grupo (perfiles mezclados: UNA actividad que le sirva a todo el grupo)" : "individual (perfil dominante de una persona)"}

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

**Regla dura para temas de práctica:** la teoría existe para habilitar la práctica, no al revés. No expliques de más antes de poner a la persona a resolver.`;
}

/** "## REGLAS ESPECIALES" — aplica al tono de TODO el material, así que va
 * en las dos mitades (es corto, no vale la pena partirlo). */
function bloqueReglasEspeciales() {
  return `

## REGLAS ESPECIALES

### Menores de 6 años
Usa palabras muy simples, frases de 3-4 palabras cuando sea posible, canciones cortas, juegos de imitación, dibujos y actividades visuales, repaso oral y memorama con imágenes. Evita explicaciones largas.

### Adultos autodidactas
Puedes usar vocabulario técnico, lecturas guiadas, proyectos prácticos, investigación autónoma, casos reales, fuentes y referencias confiables. Prioriza profundidad, aplicación y pensamiento crítico.

### Temas de psicología para adolescentes y adultos
Usa lenguaje claro, respetuoso y empático. Evita diagnosticar al estudiante. No presentes conceptos psicológicos como diagnósticos personales. Explica la terminología clínica solo cuando sea necesaria. Puedes usar reflexión, autoobservación, dinámicas de grupo y situaciones hipotéticas (ej. "¿Qué harías en esta situación?"). Evita asumir que una situación hipotética describe la vida real del estudiante.`;
}

/** Mitad 1: resumen + diagrama + esquema visual + actividad(es). */
function buildPromptEstudio(tema, nivel, perfilDominante, modo, detalles, tieneImagenes, enfoque) {
  const tecnicasNivel = TECNICAS_POR_NIVEL[nivel];
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";
  const bloqueTecnicasNivel = tecnicasNivel
    ? `\n\nReferencia de qué tan concretas deben ser las técnicas para esta edad (${nivelLabel}, ${edadLabel} años) — adapta la IDEA al tema, no copies el ejemplo literal:\n${tecnicasNivel.map((t) => `- ${t}`).join("\n")}`
    : "";

  const formatoSalida = modo === "grupo"
    ? `{
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
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|figura|grafica|ninguno", "titulo": "...", "datos": {} },
  "actividades": [ { "inteligencia": "todas", "titulo": "...", "instrucciones": "..." } ]
}
"actividades" debe traer EXACTAMENTE 1 elemento, con "inteligencia": "todas" — la actividad para todo el grupo.`
    : `{
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
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|figura|grafica|ninguno", "titulo": "...", "datos": {} },
  "actividad": { "titulo": "...", "instrucciones": "..." }
}`;

  return `${construirPreambulo(tema, nivel, perfilDominante, modo, detalles, tieneImagenes, enfoque)}

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
| \`figura\` | El tema es de geometría o medición y hay una figura concreta que ver | \`{ "forma": "rectangulo", "base": 8, "altura": 5, "unidad": "cm" }\` — ver la lista de formas abajo |
| \`grafica\` | Hay datos que se entienden mejor comparados | \`{ "forma": "barras", "etiquetas": ["Lunes","Martes"], "valores": [4, 8] }\` — \`barras\`, \`pastel\` o \`linea\`, de 2 a 8 datos |

#### Formas para \`figura\` — TÚ SOLO DAS LOS NÚMEROS, la plataforma dibuja
Nunca escribas SVG ni describas el dibujo con palabras: entrega medidas y ya. El dibujo se hace a escala con esos números, así que **siempre cuadra con la cuenta** que le pidas al alumno.

| \`forma\` | Campos que necesita |
|---|---|
| \`rectangulo\` | \`base\`, \`altura\` — agrega \`"cuadricula": true\` si quieres que se vean los cuadritos para contarlos (solo con medidas enteras y hasta 144 cuadros) |
| \`cuadrado\` | \`lado\` |
| \`triangulo\` | \`base\`, \`altura\` (la altura sale marcada con línea punteada y ángulo recto) |
| \`circulo\` | \`radio\` o \`diametro\` |
| \`trapecio\` | \`base_mayor\`, \`base_menor\`, \`altura\` |
| \`romboide\` | \`base\`, \`altura\` |
| \`poligono\` | \`lados\` (3 a 12), \`lado\` |
| \`compuesta\` | \`a\` ancho total, \`b\` alto total, \`c\` ancho del pedazo de abajo, \`d\` alto del pedazo de arriba — es la figura en "L" clásica de área; \`c\` debe ser menor que \`a\` y \`d\` menor que \`b\` |
| \`prisma\` | \`largo\`, \`ancho\`, \`alto\` — para volumen |
| \`fraccion\` | \`partes\` (2 a 12), \`sombreadas\`; agrega \`"estilo": "circulo"\` si la quieres redonda en vez de barra |
| \`recta_numerica\` | \`desde\`, \`hasta\` (máximo 24 de diferencia); opcional \`marca\` con el número o números a señalar |

Todas aceptan \`unidad\` (\`"cm"\`, \`"m"\`, \`"km"\`…). Si no la pones, se usa cm.

**Cuándo NO usar \`figura\`:** si el tema no es de geometría ni de medición. Un tema de historia con un rectángulo dibujado no ayuda a nadie.

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
    ? "Genera UNA SOLA actividad concreta que le funcione a todo el grupo: que la misma se pueda resolver de varias de estas formas a la vez (hablando, escribiendo, dibujando o con movimiento), para que cada quien le entre por donde se le acomode. Usa estos tipos de técnica como menú de referencia, NO generes una por cada uno:"
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
${bloqueReglasEspeciales()}

## FORMATO DE SALIDA — IMPORTANTE
Esto es SOLO LA MITAD del material de este tema (la otra mitad — ejercicios, trivia, material extra y respuestas — se pide aparte). Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta, SIN agregar más claves que estas:

${formatoSalida}

RECORDATORIOS DE FORMATO (los errores más comunes):
- \`resumen\` es un OBJETO, nunca un string. Si escribes todo el resumen como un párrafo, el material se vuelve una pared de texto y la persona deja de leer — que es exactamente lo que estamos evitando.
- \`pasos\` e \`ideas_clave\` son ARREGLOS. Un elemento por paso o por idea. Nunca metas "1. … 2. … 3. …" dentro de un solo string.
- \`ojo_aqui\` y \`truco\` pueden ir vacíos ("") si no aplican al tema. Es preferible dejarlos vacíos a inventar algo forzado.
- Deja \`pasos\` vacío ([]) si el tema no es un procedimiento.

Mantén un tono educativo, claro, positivo y adecuado para la edad.`;
}

/** Mitad 2: ejercicios + trivia + material extra + respuestas. */
function buildPromptPractica(tema, nivel, perfilDominante, modo, detalles, tieneImagenes, enfoque) {
  return `${construirPreambulo(tema, nivel, perfilDominante, modo, detalles, tieneImagenes, enfoque)}

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
Si eliges flashcards, memorama, relacionar columnas o tarjetas de preguntas (recursos que son literalmente tarjetas para recortar), NO los redactes como un párrafo: llena el arreglo "tarjetas" con cada tarjeta por separado (ver FORMATO DE SALIDA) — una tarjeta por cada par término/definición o pregunta/respuesta, completos y listos para imprimir y recortar. Dentro de "contenido" deja solo una instrucción de una línea sobre cómo usarlas (ej. "Recorta cada tarjeta y júntalas en pares." o "Recorta y repasa una por una."), nunca el contenido de las tarjetas mismo.
Para crucigrama, mini-glosario o línea del tiempo (no son tarjetas para recortar), sigue describiéndolos en "contenido" como texto y deja "tarjetas" vacío ([]).
Si el tema lo amerita, agrega al final del material extra un mini "repaso relámpago" de tipo "tarjetas": 3 a 6 tarjetas con lo esencial para repasar justo antes de un examen o evaluación. TODAS las tarjetas de tipo flashcards y tarjetas deben traer SIEMPRE "frente" Y "reverso" con texto — se imprimen en una sola pieza que se dobla a la mitad, así que una tarjeta sin reverso sale con la mitad de atrás en blanco. En el repaso relámpago pon en "frente" la pregunta, el término o el disparador (muy breve) y en "reverso" la respuesta, la definición o el dato que hay que recordar. Solo memorama y relacionar columnas usan frente/reverso como los DOS lados de un par que se separan al recortar.

## 5. RESPUESTAS
Incluye: respuestas de la trivia, solución o resultado esperado de la actividad, 3 conceptos que el estudiante debería recordar, y una pregunta final de autoevaluación.
Si el tema tiene errores típicos o confusiones frecuentes entre estudiantes de ese nivel, menciónalos brevemente como parte de los conceptos clave (ej. "Recuerda: X no es lo mismo que Y").
Cuando el tono lo permita, enmarca el reconocimiento hacia el esfuerzo y el proceso (cómo se llegó a la respuesta) en vez de solo hacia el resultado o la inteligencia de la persona — ayuda a construir una mentalidad de crecimiento.

NOTA: la SOLUCIÓN de la actividad (\`solucion_actividad\`) es la de la actividad de la sección 2, que se pidió por separado y que aquí no ves el texto exacto — descríbela en términos generales de qué se espera lograr con ella, sin inventar detalles que contradigan una actividad que no tienes enfrente.
${bloqueReglasEspeciales()}

## FORMATO DE SALIDA — IMPORTANTE
Esto es SOLO LA MITAD del material de este tema (la otra mitad — resumen, diagrama y actividad — se pidió aparte). Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después), con esta forma exacta, SIN agregar más claves que estas:

{
  "es_de_practica": true,
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["...", "..."], "respuesta": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "...", "tarjetas": [ { "frente": "...", "reverso": "..." } ] } ],
  "respuestas": {
    "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ],
    "solucion_actividad": "...",
    "conceptos_clave": ["...", "...", "..."],
    "autoevaluacion": "..."
  }
}

RECORDATORIOS DE FORMATO (los errores más comunes):
- \`ejercicios[].pasos\` es un ARREGLO. Un elemento por paso. Nunca metas "1. … 2. … 3. …" dentro de un solo string.
- En \`material_extra\`, si el tipo es flashcards, memorama, relacionar o tarjetas, llena \`tarjetas\` con una tarjeta por elemento (frente/reverso) — NUNCA metas los pares o las tarjetas como texto corrido dentro de \`contenido\`. Para crucigrama, glosario o línea del tiempo, deja \`tarjetas\` en [] y sigue usando \`contenido\` como texto.

Mantén un tono educativo, claro, positivo y adecuado para la edad.`;
}

/**
 * ⚠️ YA NO SE USA — generarMaterialTema() de aquí en adelante llama a
 * buildPromptEstudio()/buildPromptPractica() en paralelo (ver el bloque de
 * arriba). Se deja completa a propósito, sin usarse, como plan B fácil de
 * los primeros días: si al probar en producción el material partido en
 * dos sale con menos calidad o consistencia que antes (por ejemplo, que
 * las dos mitades no queden tan cohesivas como cuando las escribía un
 * solo modelo de un jalón), se puede volver a este camino de una sola
 * llamada cambiando solo generarMaterialTema() sin tener que reescribir
 * el prompt de memoria. Una vez que la versión partida esté probada,
 * conviene borrar esto (y intentarGenerar() más abajo) para no dejar dos
 * prompts iguales de mantener.
 */
function buildPrompt(tema, nivel, perfilDominante, modo = "individual", detalles = "", tieneImagenes = false, enfoque = "escolar") {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";
  const esPsicoeducativo = enfoque === "psicoeducativo";

  const tiposAUsar = modo === "grupo" ? TIPOS_TODOS : perfilDominante && perfilDominante.length ? perfilDominante : ["linguistica"];
  const inteligenciasLabel = tiposAUsar.map((t) => ETIQUETAS_INTELIGENCIA[t] || t).join(", ");

  // Modo grupo: UNA actividad "para todo el grupo" (31-ago-2026). Antes se
  // generaban las 8 de la tabla de Gardner en cada generación — era lo más
  // pesado que producía el sistema (y lo que hacía que el modo grupo se
  // sintiera lento o se cayera por tardanza), y en la práctica el maestro
  // termina usando una. Las 8 siguen existiendo, pero ahora bajo demanda:
  // ver generarActividadesPorInteligencia() más abajo y el botón "Adaptar
  // por inteligencia" en grupo.html.
  const instruccionActividad = esPsicoeducativo
    ? modo === "grupo"
      ? `Este material es para un GRUPO de pacientes/consultantes con perfiles mezclados — genera UNA SOLA actividad que le funcione a todo el grupo: una estrategia de afrontamiento, regulación emocional o reflexión (no una dinámica escolar) que se pueda trabajar de varias formas a la vez (hablándolo, escribiéndolo, dibujándolo o con movimiento), para que nadie se quede fuera por su forma de participar. En "actividades" va ese único elemento, con "inteligencia": "todas".`
      : `Adapta TODO el contenido a la edad e inteligencia(s) indicadas. La actividad debe ser UNA estrategia de afrontamiento, regulación emocional o práctica para casa relacionada con el tema — no una dinámica de tipo escolar. Si se indican varias inteligencias, combina sus técnicas de manera natural en esa única actividad.`
    : modo === "grupo"
      ? `Este material es para un GRUPO (salón de clase o grupo de pacientes) con perfiles de aprendizaje mezclados — genera UNA SOLA actividad diseñada para que le entre TODO el grupo, sin importar cómo aprende cada quien: que la misma actividad se pueda resolver hablando, escribiendo, dibujando o moviéndose, y que quien participe pueda elegir cómo entrarle. En "actividades" va ese único elemento, con "inteligencia": "todas". No generes la tabla de las 8 inteligencias.`
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
- Modo: ${modo === "grupo" ? "grupo (perfiles mezclados: UNA actividad que le sirva a todo el grupo)" : "individual (perfil dominante de una persona)"}

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
| \`figura\` | El tema es de geometría o medición y hay una figura concreta que ver | \`{ "forma": "rectangulo", "base": 8, "altura": 5, "unidad": "cm" }\` — ver la lista de formas abajo |
| \`grafica\` | Hay datos que se entienden mejor comparados | \`{ "forma": "barras", "etiquetas": ["Lunes","Martes"], "valores": [4, 8] }\` — \`barras\`, \`pastel\` o \`linea\`, de 2 a 8 datos |

#### Formas para \`figura\` — TÚ SOLO DAS LOS NÚMEROS, la plataforma dibuja
Nunca escribas SVG ni describas el dibujo con palabras: entrega medidas y ya. El dibujo se hace a escala con esos números, así que **siempre cuadra con la cuenta** que le pidas al alumno.

| \`forma\` | Campos que necesita |
|---|---|
| \`rectangulo\` | \`base\`, \`altura\` — agrega \`"cuadricula": true\` si quieres que se vean los cuadritos para contarlos (solo con medidas enteras y hasta 144 cuadros) |
| \`cuadrado\` | \`lado\` |
| \`triangulo\` | \`base\`, \`altura\` (la altura sale marcada con línea punteada y ángulo recto) |
| \`circulo\` | \`radio\` o \`diametro\` |
| \`trapecio\` | \`base_mayor\`, \`base_menor\`, \`altura\` |
| \`romboide\` | \`base\`, \`altura\` |
| \`poligono\` | \`lados\` (3 a 12), \`lado\` |
| \`compuesta\` | \`a\` ancho total, \`b\` alto total, \`c\` ancho del pedazo de abajo, \`d\` alto del pedazo de arriba — es la figura en "L" clásica de área; \`c\` debe ser menor que \`a\` y \`d\` menor que \`b\` |
| \`prisma\` | \`largo\`, \`ancho\`, \`alto\` — para volumen |
| \`fraccion\` | \`partes\` (2 a 12), \`sombreadas\`; agrega \`"estilo": "circulo"\` si la quieres redonda en vez de barra |
| \`recta_numerica\` | \`desde\`, \`hasta\` (máximo 24 de diferencia); opcional \`marca\` con el número o números a señalar |

Todas aceptan \`unidad\` (\`"cm"\`, \`"m"\`, \`"km"\`…). Si no la pones, se usa cm.

**Cuándo NO usar \`figura\`:** si el tema no es de geometría ni de medición. Un tema de historia con un rectángulo dibujado no ayuda a nadie.

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
    ? "Genera UNA SOLA actividad concreta que le funcione a todo el grupo: que la misma se pueda resolver de varias de estas formas a la vez (hablando, escribiendo, dibujando o con movimiento), para que cada quien le entre por donde se le acomode. Usa estos tipos de técnica como menú de referencia, NO generes una por cada uno:"
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
Si eliges flashcards, memorama, relacionar columnas o tarjetas de preguntas (recursos que son literalmente tarjetas para recortar), NO los redactes como un párrafo: llena el arreglo "tarjetas" con cada tarjeta por separado (ver FORMATO DE SALIDA) — una tarjeta por cada par término/definición o pregunta/respuesta, completos y listos para imprimir y recortar. Dentro de "contenido" deja solo una instrucción de una línea sobre cómo usarlas (ej. "Recorta cada tarjeta y júntalas en pares." o "Recorta y repasa una por una."), nunca el contenido de las tarjetas mismo.
Para crucigrama, mini-glosario o línea del tiempo (no son tarjetas para recortar), sigue describiéndolos en "contenido" como texto y deja "tarjetas" vacío ([]).
Si el tema lo amerita, agrega al final del material extra un mini "repaso relámpago" de tipo "tarjetas": 3 a 6 tarjetas con lo esencial para repasar justo antes de un examen o evaluación. TODAS las tarjetas de tipo flashcards y tarjetas deben traer SIEMPRE "frente" Y "reverso" con texto — se imprimen en una sola pieza que se dobla a la mitad, así que una tarjeta sin reverso sale con la mitad de atrás en blanco. En el repaso relámpago pon en "frente" la pregunta, el término o el disparador (muy breve) y en "reverso" la respuesta, la definición o el dato que hay que recordar. Solo memorama y relacionar columnas usan frente/reverso como los DOS lados de un par que se separan al recortar.

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
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|figura|grafica|ninguno", "titulo": "...", "datos": {} },
  "actividades": [ { "inteligencia": "todas", "titulo": "...", "instrucciones": "..." } ],
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["...", "..."], "respuesta": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "...", "tarjetas": [ { "frente": "...", "reverso": "..." } ] } ],
  "respuestas": {
    "trivia_resuelta": [ { "pregunta": "...", "respuesta": "..." } ],
    "solucion_actividad": "...",
    "conceptos_clave": ["...", "...", "..."],
    "autoevaluacion": "..."
  }
}
"actividades" debe traer EXACTAMENTE 1 elemento, con "inteligencia": "todas" — la actividad para todo el grupo.`
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
  "diagrama": { "tipo": "mapa_mental|linea_tiempo|comparativo|proceso|ciclo|jerarquia|partes|figura|grafica|ninguno", "titulo": "...", "datos": {} },
  "actividad": { "titulo": "...", "instrucciones": "..." },
  "ejercicios": [ { "enunciado": "...", "pista": "...", "pasos": ["...", "..."], "respuesta": "..." } ],
  "trivia": [ { "pregunta": "...", "tipo": "vf|opcion|abierta|caso", "opciones": ["...","..."], "respuesta_correcta": "..." } ],
  "material_extra": [ { "tipo": "flashcards|memorama|crucigrama|glosario|relacionar|linea_tiempo|tarjetas", "contenido": "...", "tarjetas": [ { "frente": "...", "reverso": "..." } ] } ],
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
- En \`material_extra\`, si el tipo es flashcards, memorama, relacionar o tarjetas, llena \`tarjetas\` con una tarjeta por elemento (frente/reverso) — NUNCA metas los pares o las tarjetas como texto corrido dentro de \`contenido\`. Para crucigrama, glosario o línea del tiempo, deja \`tarjetas\` en [] y sigue usando \`contenido\` como texto.

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
  if (c.diagrama && typeof c.diagrama === "object") {
    const tipo = c.diagrama.tipo;
    const datos = c.diagrama.datos && typeof c.diagrama.datos === "object" ? c.diagrama.datos : {};

    if (TIPOS_DIAGRAMA.includes(tipo) && Object.keys(datos).length) {
      diagrama = { tipo, titulo: String(c.diagrama.titulo || ""), datos };
    } else if (tipo === "figura" || tipo === "grafica") {
      // Las figuras se validan DIBUJÁNDOLAS aquí mismo (utils/figuras.js).
      // No basta con revisar que el tipo exista: un rectángulo sin altura,
      // una "L" cuyo corte no cabe o una gráfica con un solo dato pasan
      // cualquier revisión de campos y salen como un dibujo roto. Si el
      // dibujante devuelve "", el tema sale sin figura y ya — que es
      // muchísimo mejor que una figura que contradice el ejercicio.
      const svg = tipo === "figura"
        ? EnsenaiFiguras.figura(datos)
        : EnsenaiFiguras.grafica(datos);
      if (svg) {
        diagrama = { tipo, titulo: String(c.diagrama.titulo || ""), datos };
      }
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
 *
 * Usa Haiku (31-ago-2026, pedido de la usuaria: "que no se sienta tan
 * tardado" al generar un tema) en vez del modelo grande que usa
 * intentarGenerar(): este paso solo revisa reglas contra el material ya
 * generado ("¿el nivel de lectura es el correcto? ¿faltan campos?"), no
 * necesita creatividad — un modelo más chico y rápido aquí no baja la
 * calidad del tema en sí (eso lo sigue generando claude-sonnet-5), solo
 * acelera el paso de revisión.
 */
async function askClaude(systemPrompt, mensajeUsuario, maxTokens = 1000) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: mensajeUsuario }],
  });
  return response.content.find((b) => b.type === "text")?.text || "";
}

/** Igual que intentarGenerar(), pero sin normalizarContenido (eso se hace
 * hasta fusionar las dos mitades) y con el límite de tokens ajustable —
 * cada mitad pide bastante menos que el material completo. */
async function pedirMitad(prompt, bloquesImagen, maxTokens) {
  const content = bloquesImagen.length ? [...bloquesImagen, { type: "text", text: prompt }] : prompt;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });

  const rawText = response.content.find((b) => b.type === "text")?.text || "{}";
  const cleanedText = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleanedText);
}

async function generarMaterialTema(tema, nivel, perfilDominante, modo = "individual", opciones = {}) {
  const detalles = String(opciones.detalles || "").trim().slice(0, 1500);
  const bloquesImagen = normalizarImagenes(opciones.imagenes);
  const enfoque = opciones.enfoque === "psicoeducativo" ? "psicoeducativo" : "escolar";

  const promptEstudio = buildPromptEstudio(tema, nivel, perfilDominante, modo, detalles, bloquesImagen.length > 0, enfoque);
  const promptPractica = buildPromptPractica(tema, nivel, perfilDominante, modo, detalles, bloquesImagen.length > 0, enfoque);

  try {
    // Las dos mitades se piden EN PARALELO (8-sep-2026, ver el comentario
    // grande arriba de construirPreambulo) — cada una con sus propios 3
    // intentos con espera (utils/reintento.js), independiente de la otra:
    // si una se satura o llega truncada, reintenta sin tirar la mitad que
    // sí salió bien a la primera.
    // 7000 tokens por mitad: cada una pide bastante menos que el material
    // completo (6-8 ejercicios con procedimiento por un lado; resumen +
    // diagrama + actividad por el otro), con margen sobre lo que de verdad
    // ocupan para no arriesgar el mismo corte a media cadena que ya pasó
    // una vez con el material completo.
    const [estudio, practica] = await Promise.all([
      conReintento(() => pedirMitad(promptEstudio, bloquesImagen, 7000), { intentos: 3, etiqueta: "generarMaterialTema:estudio" }),
      conReintento(() => pedirMitad(promptPractica, bloquesImagen, 7000), { intentos: 3, etiqueta: "generarMaterialTema:practica" }),
    ]);

    // Si las dos mitades no coinciden en es_de_practica (raro — el tema
    // resultó ambiguo entre práctica/comprensión), gana la de ESTUDIO: es
    // la que más pesa en el resumen (cuánta teoría lleva). Si eso deja los
    // ejercicios por debajo de lo que esa decisión exige, el validador de
    // estructura (utils/revisorCalidad.js) lo detecta gratis y lo manda al
    // parche barato — nunca hay que regenerar las dos mitades por esto.
    return normalizarContenido({
      tema,
      ...practica,
      ...estudio,
      es_de_practica: estudio.es_de_practica === true,
    });
  } catch (err) {
    // Dos fallas distintas, dos mensajes distintos: decirle "la respuesta
    // llegó incompleta" a alguien que solo cayó en un momento saturado lo
    // manda a revisar su tema, que no tiene nada malo.
    if (esDeSaturacion(err)) {
      throw new Error(
        "El servicio de IA está saturado en este momento. Ya lo intentamos 3 veces — espera un minuto y vuelve a darle, tu tema no se gastó."
      );
    }
    throw new Error(
      `No se pudo generar el material — la respuesta llegó incompleta. Intenta de nuevo. (${err.message})`
    );
  }
}

/**
 * Genera las 8 actividades de la tabla de Gardner PARA UN TEMA YA GENERADO
 * (31-ago-2026). Antes esto venía dentro de cada generación de grupo y era
 * lo más pesado del material; ahora el tema sale con una sola actividad
 * "para todo el grupo" y estas 8 se piden aparte, solo si el maestro o
 * psicólogo las quiere (botón "Adaptar por inteligencia" en grupo.html).
 *
 * Es una llamada mucho más chica que generar un tema completo: solo recibe
 * el resumen del tema ya hecho y devuelve las 8 actividades, nada más.
 */
async function generarActividadesPorInteligencia(contenido, nivel, enfoque = "escolar") {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const edadLabel = EDAD_APROX[nivel] || "9-12";
  const esPsicoeducativo = enfoque === "psicoeducativo";
  const r = contenido?.resumen || {};
  const resumenCorto = [r.que_es, ...(Array.isArray(r.ideas_clave) ? r.ideas_clave : [])]
    .filter(Boolean)
    .join(" — ")
    .slice(0, 900);

  const prompt = `Tema: "${contenido?.tema || ""}" (${nivelLabel}, ${edadLabel} años)
De qué trata: ${resumenCorto || "(sin resumen)"}

Genera UNA actividad para CADA UNA de las 8 inteligencias múltiples de Gardner, todas sobre ESTE tema — la misma idea trabajada de 8 formas distintas, para que quien enseña reparta a cada estudiante la que mejor le acomode.

Reglas:
- Cada actividad debe poder hacerse en clase o en casa con materiales comunes, y aterrizada al tema (nada genérico tipo "haz un dibujo del tema").
- Instrucciones concretas y cortas (2-4 oraciones), en segunda persona y adecuadas a la edad.
- Que de verdad se distingan entre sí: la kinestésica implica movimiento real, la musical sonido o ritmo, la espacial algo visual, etc.${
    esPsicoeducativo
      ? `
- CONTEXTO PSICOEDUCATIVO: esto NO es material escolar, es acompañamiento emocional (terapia, orientación, consulta). Cada actividad es una estrategia de afrontamiento, regulación o reflexión trabajada desde esa inteligencia. Tono cálido y validante, sin evaluar ni diagnosticar, y sin asumir que los ejemplos describen la vida real de quien participa.`
      : ""
  }

Responde SOLO en JSON válido (sin bloque de código, sin texto antes o después):
{ "actividades": [ { "inteligencia": "linguistica|logico_matematica|espacial|musical|kinestesica|interpersonal|intrapersonal|naturalista", "titulo": "...", "instrucciones": "..." } ] }

Deben ser exactamente 8 elementos, uno por cada inteligencia de la lista, sin repetir ninguna.`;

  const pedir = async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    const rawText = response.content.find((b) => b.type === "text")?.text || "{}";
    const limpio = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parseado = JSON.parse(limpio);
    const actividades = (Array.isArray(parseado.actividades) ? parseado.actividades : [])
      .filter((a) => a && TIPOS_TODOS.includes(a.inteligencia) && a.titulo && a.instrucciones)
      .map((a) => ({
        inteligencia: a.inteligencia,
        titulo: String(a.titulo),
        instrucciones: String(a.instrucciones),
      }));
    // Una sola por inteligencia, en el orden canónico de TIPOS_TODOS.
    const porTipo = new Map();
    actividades.forEach((a) => { if (!porTipo.has(a.inteligencia)) porTipo.set(a.inteligencia, a); });
    const ordenadas = TIPOS_TODOS.map((t) => porTipo.get(t)).filter(Boolean);
    if (ordenadas.length < 8) throw new Error(`Llegaron ${ordenadas.length} actividades de 8.`);
    return ordenadas;
  };

  // Mismo criterio que generarMaterialTema: 3 intentos con espera.
  return await conReintento(pedir, { intentos: 3, etiqueta: "actividadesPorInteligencia" });
}

/**
 * PARCHE EN VEZ DE REGENERAR TODO (8-sep-2026).
 *
 * Hasta ahora, cuando el revisor de calidad (utils/revisorCalidad.js)
 * encontraba un problema — una pregunta ambigua, un dato flojo, lo que
 * sea — la corrección era volver a generar el material COMPLETO desde
 * cero: otra llamada de hasta 12000 tokens de salida, aunque el problema
 * fuera una sola trivia. Eso es lo que hacía que el caso malo tardara
 * ~3 minutos en vez de los 40-90s normales.
 *
 * La idea de aquí: casi siempre el reporte del revisor apunta a UNA
 * sección (la trivia, un ejercicio, la actividad...). Si se puede ubicar
 * con confianza en qué sección(es) cae cada problema, se le manda al
 * modelo el material ya generado + la lista de problemas, y se le pide
 * que devuelva SOLO esas secciones corregidas — una llamada mucho más
 * chica (menos tokens de salida) que arreglar sin repetir todo lo que ya
 * estaba bien.
 *
 * Es a propósito conservador: si algún problema no se puede ubicar en
 * ninguna sección conocida, o suena a algo transversal ("el contenido no
 * es del tema pedido"), NO se intenta parchar — clasificarNotasReparables
 * regresa null y quien llama debe regenerar todo, como antes. Preferimos
 * gastar los 90s completos a entregar un parche que dejó el material a
 * medias por adivinar mal dónde estaba el problema.
 */

// Cada clave es un campo real del JSON de salida (o "actividad"/"actividades"
// según el modo). El valor es una expresión regular que detecta si una nota
// de problema (texto libre del revisor) habla de esa sección.
const PISTAS_SECCION = {
  resumen: /resumen|nivel de lectura|que_es|ideas clave|ojo_aqui|truco/i,
  diagrama: /diagrama/i,
  actividad: /\bactividad(es)?\b/i,
  ejercicios: /ejercicio/i,
  trivia: /trivia/i,
  material_extra: /material extra|tarjeta|flashcard|memorama|crucigrama|glosario/i,
  // A propósito NO incluye "respuesta(s)" a secas: un problema típico de
  // ejercicios o trivia se reporta como "falta la respuesta" o "la
  // respuesta correcta no aparece entre las opciones" — eso es del
  // ejercicio/trivia, no de la sección `respuestas` (el resumen final).
  // Con "respuesta" suelta, casi cualquier nota de trivia también marcaba
  // `respuestas`, pidiendo un parche más grande del que hacía falta.
  respuestas: /solucion_actividad|autoevaluaci[oó]n|conceptos clave|trivia_resuelta/i,
};

/**
 * ¿Con qué campo del JSON se corresponde cada sección, según el modo?
 * (en modo grupo la actividad vive en `actividades`, no `actividad`).
 */
function campoDe(seccion, modo) {
  if (seccion === "actividad") return modo === "grupo" ? "actividades" : "actividad";
  return seccion;
}

/**
 * Decide qué secciones alcanzan a arreglar las notas de un intento fallido.
 * @param {string[]} notas
 * @returns {Set<string>|null} conjunto de secciones (resumen/diagrama/
 *   actividad/ejercicios/trivia/material_extra/respuestas), o null si más
 *   vale regenerar todo el material.
 */
function clasificarNotasReparables(notas) {
  if (!Array.isArray(notas) || notas.length === 0) return null;
  const secciones = new Set();
  for (const nota of notas) {
    const texto = String(nota || "");
    // Señal de que el problema es transversal (no vive en una sección):
    // el revisor de IA dice explícitamente que el tema está desviado.
    if (/no (es|trata|habla).{0,25}(del )?tema|tema (pedido|distinto|equivocado)/i.test(texto)) return null;

    let ubicada = false;
    for (const [seccion, patron] of Object.entries(PISTAS_SECCION)) {
      if (patron.test(texto)) { secciones.add(seccion); ubicada = true; }
    }
    if (!ubicada) return null; // no sabemos dónde cae — más seguro regenerar todo
  }
  return secciones;
}

/**
 * Pide solo las secciones marcadas, dándole el material completo como
 * contexto (para que lo que corrija siga encajando con el resto) pero
 * limitando la salida a esas claves — mucho más rápido que regenerar todo.
 */
async function repararSecciones(material, secciones, tema, nivel, modo, notas) {
  const nivelLabel = ETIQUETAS_NIVEL[nivel] || "Primaria alta";
  const campos = [...secciones].map((s) => campoDe(s, modo));

  const prompt = `Este es el material educativo YA GENERADO para el tema "${tema}" (${nivelLabel}):

${JSON.stringify(material, null, 2)}

Un revisor de calidad encontró estos problemas:
${notas.map((n) => `- ${n}`).join("\n")}

Corrige ÚNICAMENTE ${campos.map((c) => `"${c}"`).join(", ")} para resolver esos problemas — no cambies nada más, ni el tono ni el resto de las secciones. Responde SOLO con un objeto JSON que traiga nada más ${campos.length === 1 ? "esa clave" : "esas claves"}, en el mismo formato exacto que ya tienen arriba (sin bloque de código, sin texto alrededor). Ejemplo de forma: { ${campos.map((c) => `"${c}": ...`).join(", ")} }`;

  const pedir = async () => {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4000, // solo 1-3 secciones, nunca el material completo (12000)
      messages: [{ role: "user", content: prompt }],
    });
    const rawText = response.content.find((b) => b.type === "text")?.text || "{}";
    const limpio = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parcial = JSON.parse(limpio);
    // Nunca se aceptan claves fuera de las pedidas — así un desliz del
    // modelo no puede pisar una sección que no se mandó a revisar.
    const filtrado = {};
    for (const c of campos) if (c in parcial) filtrado[c] = parcial[c];
    if (Object.keys(filtrado).length === 0) throw new Error("El parche llegó sin ninguna de las claves pedidas.");
    return normalizarContenido({ ...material, ...filtrado });
  };

  return await conReintento(pedir, { intentos: 2, etiqueta: "repararSecciones" });
}

module.exports = {
  generarMaterialTema,
  generarActividadesPorInteligencia,
  normalizarContenido,
  normalizarImagenes,
  askClaude,
  clasificarNotasReparables,
  repararSecciones,
  ETIQUETAS_NIVEL,
  EDAD_APROX,
  ETIQUETAS_INTELIGENCIA,
};
