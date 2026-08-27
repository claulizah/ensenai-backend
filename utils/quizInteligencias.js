/**
 * Quiz de inteligencias múltiples (teoría de Gardner) — ayuda a identificar
 * cómo aprende mejor una persona, para personalizar la explicación, la
 * trivia y el material de refuerzo que genera la IA para cada tema.
 *
 * IMPORTANTE — esto es una guía orientativa de "estilo de aprendizaje
 * preferido", no un diagnóstico clínico ni psicológico.
 *
 * v2 (26 ago): de 5 a 12 preguntas (mejor señal por categoría), se agrega
 * versión en primera persona para adolescentes/adultos (la v1 solo tenía
 * la versión en la que el papá describe a su hijo), y calcularResultado
 * ahora regresa porcentaje por categoría además del top 2 dominante.
 */

const TIPOS = [
  "linguistica",
  "logico_matematica",
  "espacial",
  "musical",
  "kinestesica",
  "interpersonal",
  "intrapersonal",
  "naturalista",
];

const ETIQUETAS = {
  linguistica: "Lingüística (palabras, historias)",
  logico_matematica: "Lógico-matemática (números, lógica)",
  espacial: "Espacial (imágenes, dibujos)",
  musical: "Musical (ritmo, canciones)",
  kinestesica: "Kinestésica (movimiento, cuerpo)",
  interpersonal: "Interpersonal (con otros, en equipo)",
  intrapersonal: "Intrapersonal (reflexión, a su ritmo)",
  naturalista: "Naturalista (plantas, animales)",
};

// Cada pregunta tiene 8 opciones, EN EL MISMO ORDEN que TIPOS — el índice
// (0-7) de la opción elegida indica qué inteligencia sumó un punto.

const PREGUNTAS_NINOS = [
  {
    id: 1,
    pregunta: "Cuando tiene tiempo libre, prefiere…",
    opciones: [
      "Leer cuentos o inventar historias",
      "Resolver rompecabezas o juegos de lógica",
      "Dibujar, construir o hacer maquetas",
      "Cantar, bailar o seguir ritmos",
      "Correr, brincar o manipular objetos",
      "Jugar con otros niños y liderar actividades",
      "Estar tranquilo, pensar o escribir lo que siente",
      "Explorar plantas, animales o insectos",
    ],
  },
  {
    id: 2,
    pregunta: "Aprende algo nuevo mejor si…",
    opciones: [
      "Se lo explican con palabras o ejemplos",
      "Le muestran pasos lógicos o reglas",
      "Ve imágenes, dibujos o esquemas",
      "Lo escucha en una canción o ritmo",
      "Lo practica con el cuerpo",
      "Lo conversa con otros",
      "Lo piensa solo, con calma",
      "Lo relaciona con la naturaleza",
    ],
  },
  {
    id: 3,
    pregunta: "En la escuela destaca más cuando…",
    opciones: [
      "Explica ideas con claridad",
      "Resuelve problemas numéricos",
      "Hace proyectos visuales",
      "Participa en actividades musicales",
      "Hace actividades físicas",
      "Trabaja en equipo",
      "Maneja bien sus emociones",
      "Observa fenómenos naturales",
    ],
  },
  {
    id: 4,
    pregunta: "Si algo le cuesta trabajo, suele…",
    opciones: [
      "Hablarlo con alguien",
      "Analizarlo paso a paso",
      "Dibujarlo o visualizarlo",
      "Tararear o moverse mientras piensa",
      "Intentarlo una y otra vez con las manos",
      "Pedir ayuda a otros niños",
      "Pensarlo en silencio, solo",
      "Buscar un ejemplo parecido en la naturaleza",
    ],
  },
  {
    id: 5,
    pregunta: "Le gusta más jugar…",
    opciones: [
      "Juegos de palabras o adivinanzas",
      "Juegos de estrategia o números",
      "Armar rompecabezas o dibujar",
      "Con música o instrumentos",
      "Juegos activos, de correr y saltar",
      "En grupo, con amigos",
      "Solo, a su propio ritmo",
      "Al aire libre, con animales o plantas",
    ],
  },
  {
    id: 6,
    pregunta: "Al elegir un libro o cuento, prefiere uno que…",
    opciones: [
      "Tenga muchas palabras e historias",
      "Tenga acertijos o números",
      "Tenga muchos dibujos e ilustraciones",
      "Venga con una canción o rima",
      "Lo invite a actuar la historia",
      "Lo pueda leer y comentar con alguien más",
      "Lo pueda leer solo y tranquilo",
      "Hable de animales o de la naturaleza",
    ],
  },
  {
    id: 7,
    pregunta: "Cuando resuelve un problema difícil, primero…",
    opciones: [
      "Lo platica en voz alta",
      "Busca el patrón o la lógica",
      "Lo dibuja o lo imagina",
      "Tararea algo mientras piensa",
      "Lo intenta con las manos",
      "Le pregunta a alguien más",
      "Lo piensa solo, en silencio",
      "Piensa en un ejemplo de la naturaleza",
    ],
  },
  {
    id: 8,
    pregunta: "En una fiesta o reunión, lo que más disfruta es…",
    opciones: [
      "Platicar y contar historias",
      "Organizar un juego con reglas",
      "Ver o hacer algo visual (decoración, dibujos)",
      "La música y el baile",
      "Los juegos activos",
      "Estar rodeado de gente",
      "Tener un momento tranquilo aparte",
      "Estar afuera, en el jardín o con mascotas",
    ],
  },
  {
    id: 9,
    pregunta: "Si tuviera que explicarle algo a un amigo, lo haría…",
    opciones: [
      "Con palabras y ejemplos",
      "Con pasos ordenados y lógicos",
      "Con un dibujo o esquema",
      "Inventando una canción sobre el tema",
      "Haciendo una demostración con el cuerpo o las manos",
      "Platicando y preguntándole qué entendió",
      "Dejándolo que lo piense a su ritmo",
      "Comparándolo con algo de la naturaleza",
    ],
  },
  {
    id: 10,
    pregunta: "Lo que más lo frustra en la escuela es…",
    opciones: [
      "Que no lo dejen platicar o escribir sobre el tema",
      "Que no le den tiempo de pensarlo con lógica",
      "Que no haya apoyo visual (solo texto)",
      "Que sea aburrido y sin ritmo",
      "Que tenga que estar quieto mucho tiempo",
      "Que tenga que trabajar solo",
      "Que lo interrumpan cuando está concentrado",
      "Que no se relacione con nada real o natural",
    ],
  },
  {
    id: 11,
    pregunta: "Un día ideal de fin de semana incluye…",
    opciones: [
      "Leer o escribir algo",
      "Resolver un reto o rompecabezas",
      "Visitar un museo o hacer arte",
      "Ir a un concierto o cantar",
      "Hacer deporte o actividad física",
      "Salir con amigos",
      "Tener tiempo a solas para sus cosas",
      "Estar en un parque o con animales",
    ],
  },
  {
    id: 12,
    pregunta: "Cuando algo le sale mal, lo que más le ayuda es…",
    opciones: [
      "Hablarlo con alguien que lo escuche",
      "Entender por qué pasó, paso a paso",
      "Verlo desde otra perspectiva (dibujarlo, visualizarlo)",
      "Distraerse con música",
      "Moverse o hacer algo físico",
      "Que un amigo lo acompañe",
      "Procesarlo solo antes de hablarlo",
      "Dar un paseo al aire libre",
    ],
  },
];

// Misma estructura y mismo orden de opciones que PREGUNTAS_NINOS, en
// primera persona, para adolescentes/adultos que se autoevalúan.
const PREGUNTAS_ADULTO = [
  {
    id: 1,
    pregunta: "Cuando tengo tiempo libre, prefiero…",
    opciones: [
      "Leer o inventar historias",
      "Resolver rompecabezas o juegos de lógica",
      "Dibujar, diseñar o armar cosas",
      "Escuchar o hacer música",
      "Hacer ejercicio o actividad manual",
      "Salir con amigos y socializar",
      "Estar tranquilo, reflexionando o escribiendo",
      "Estar en la naturaleza o con animales",
    ],
  },
  {
    id: 2,
    pregunta: "Aprendo algo nuevo mejor si…",
    opciones: [
      "Me lo explican con palabras o ejemplos",
      "Me muestran los pasos lógicos o las reglas",
      "Lo veo en imágenes, diagramas o esquemas",
      "Lo escucho en forma de canción o ritmo",
      "Lo practico con el cuerpo o las manos",
      "Lo discuto con otras personas",
      "Lo pienso por mi cuenta, con calma",
      "Lo relaciono con la naturaleza",
    ],
  },
  {
    id: 3,
    pregunta: "En el trabajo o la escuela destaco más cuando…",
    opciones: [
      "Explico ideas con claridad",
      "Resuelvo problemas numéricos o lógicos",
      "Hago proyectos visuales",
      "Participo en actividades musicales o creativas",
      "Hago actividades físicas o manuales",
      "Trabajo en equipo",
      "Manejo bien mis emociones y reflexiono",
      "Observo y analizo fenómenos naturales",
    ],
  },
  {
    id: 4,
    pregunta: "Si algo se me dificulta, suelo…",
    opciones: [
      "Hablarlo con alguien",
      "Analizarlo paso a paso",
      "Dibujarlo o visualizarlo",
      "Tararear o moverme mientras pienso",
      "Intentarlo una y otra vez con las manos",
      "Pedir ayuda a otros",
      "Pensarlo en silencio, solo",
      "Buscar un ejemplo parecido en la naturaleza",
    ],
  },
  {
    id: 5,
    pregunta: "Prefiero jugar o entretenerme con…",
    opciones: [
      "Juegos de palabras o adivinanzas",
      "Juegos de estrategia o números",
      "Rompecabezas o actividades de dibujo",
      "Música o instrumentos",
      "Juegos activos o deportivos",
      "Juegos en grupo, con amigos",
      "Actividades solitarias, a mi ritmo",
      "Actividades al aire libre, con animales o plantas",
    ],
  },
  {
    id: 6,
    pregunta: "Al elegir un libro, prefiero uno que…",
    opciones: [
      "Tenga muchas palabras e historias",
      "Tenga acertijos o esté basado en lógica",
      "Tenga muchas imágenes o ilustraciones",
      "Tenga que ver con música o ritmo",
      "Me invite a hacer algo activo",
      "Lo pueda comentar con alguien más",
      "Lo pueda leer solo y tranquilo",
      "Hable de naturaleza o animales",
    ],
  },
  {
    id: 7,
    pregunta: "Cuando resuelvo un problema difícil, primero…",
    opciones: [
      "Lo platico en voz alta",
      "Busco el patrón o la lógica",
      "Lo dibujo o lo imagino",
      "Tarareo algo mientras pienso",
      "Lo intento con las manos",
      "Le pregunto a alguien más",
      "Lo pienso solo, en silencio",
      "Pienso en un ejemplo de la naturaleza",
    ],
  },
  {
    id: 8,
    pregunta: "En una fiesta o reunión, lo que más disfruto es…",
    opciones: [
      "Platicar y contar historias",
      "Organizar un juego con reglas",
      "Ver o hacer algo visual (decoración, dibujos)",
      "La música y el baile",
      "Los juegos activos",
      "Estar rodeado de gente",
      "Tener un momento tranquilo aparte",
      "Estar afuera, en el jardín o con mascotas",
    ],
  },
  {
    id: 9,
    pregunta: "Si tuviera que explicarle algo a alguien, lo haría…",
    opciones: [
      "Con palabras y ejemplos",
      "Con pasos ordenados y lógicos",
      "Con un dibujo o esquema",
      "Inventando una canción sobre el tema",
      "Haciendo una demostración física",
      "Platicando y preguntándole qué entendió",
      "Dejándolo que lo piense a su ritmo",
      "Comparándolo con algo de la naturaleza",
    ],
  },
  {
    id: 10,
    pregunta: "Lo que más me frustra al aprender es…",
    opciones: [
      "Que no me dejen platicar o escribir sobre el tema",
      "Que no me den tiempo de pensarlo con lógica",
      "Que no haya apoyo visual",
      "Que sea aburrido y sin ritmo",
      "Que tenga que estar quieto mucho tiempo",
      "Que tenga que trabajar solo",
      "Que me interrumpan cuando estoy concentrado",
      "Que no se relacione con nada real o natural",
    ],
  },
  {
    id: 11,
    pregunta: "Un día ideal de descanso incluye…",
    opciones: [
      "Leer o escribir algo",
      "Resolver un reto o rompecabezas",
      "Visitar un museo o hacer arte",
      "Ir a un concierto o cantar",
      "Hacer deporte o actividad física",
      "Salir con amigos",
      "Tener tiempo a solas para mis cosas",
      "Estar en un parque o con animales",
    ],
  },
  {
    id: 12,
    pregunta: "Cuando algo me sale mal, lo que más me ayuda es…",
    opciones: [
      "Hablarlo con alguien que me escuche",
      "Entender por qué pasó, paso a paso",
      "Verlo desde otra perspectiva",
      "Distraerme con música",
      "Moverme o hacer algo físico",
      "Que un amigo me acompañe",
      "Procesarlo solo antes de hablarlo",
      "Dar un paseo al aire libre",
    ],
  },
];

// Se mantiene para no romper el uso anterior (tipo de repaso para audiencia
// "niños" en el flujo de video) — el flujo nuevo usa ACTIVIDADES_SUGERIDAS.
const REPASO_SUGERIDO = {
  linguistica: ["flashcards", "rima"],
  logico_matematica: ["memorama", "flashcards"],
  espacial: ["memorama"],
  musical: ["rima"],
  kinestesica: ["memorama"],
  interpersonal: ["memorama"],
  intrapersonal: ["flashcards"],
  naturalista: ["memorama"],
};

// Tabla completa usada por el prompt nuevo de generación (tema + perfil):
// qué tipo de actividad priorizar en la explicación, la trivia y el refuerzo.
const ACTIVIDADES_SUGERIDAS = {
  linguistica: "Explicación narrativa, preguntas de opción múltiple con texto, explicar con tus propias palabras.",
  logico_matematica: "Explicación por pasos/causa-efecto, secuencias lógicas, mini-problema relacionado al tema.",
  espacial: "Explicación apoyada en descripción de diagramas, preguntas visuales, mapa mental como refuerzo.",
  musical: "Mnemotecnias, rimas o asociaciones sonoras, tanto en la explicación como en el refuerzo.",
  kinestesica: "Explicación ligada a actividad física/manipulable, ejercicio práctico con objetos cotidianos.",
  interpersonal: "Actividad de explicarle el tema a alguien más, preguntas de discusión.",
  intrapersonal: "Preguntas de reflexión personal, relacionar el tema con la propia experiencia.",
  naturalista: "Preguntas de clasificación/categorías, relación con el mundo natural.",
};

/**
 * Baraja una copia del arreglo (Fisher-Yates). No modifica el original.
 */
function barajar(arreglo) {
  const copia = arreglo.slice();
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/**
 * @param {"ninos"|"adulto"} version
 *
 * Cada pregunta regresa sus 8 opciones como objetos `{ tipo, texto }` y
 * **en orden barajado**, distinto en cada pregunta y en cada intento.
 *
 * Antes las opciones salían siempre en el mismo orden fijo (lingüística
 * primero, naturalista al final). Eso introducía un sesgo de posición real:
 * la gente tiende a elegir de las primeras opciones que lee, así que las
 * inteligencias del inicio del arreglo salían dominantes más seguido sin
 * que nadie las prefiriera de verdad. Barajar lo elimina.
 *
 * Como el orden ya no es predecible, el frontend regresa el `tipo` (string)
 * de lo que eligió la persona, no el índice de la opción.
 */
function preguntasPublicas(version = "ninos") {
  const preguntas = version === "adulto" ? PREGUNTAS_ADULTO : PREGUNTAS_NINOS;
  return preguntas.map(({ id, pregunta, opciones }) => ({
    id,
    pregunta,
    opciones: barajar(opciones.map((texto, i) => ({ tipo: TIPOS[i], texto }))),
  }));
}

const PESO_PRIMARIA = 1;
const PESO_SECUNDARIA = 0.5;

/**
 * Normaliza una respuesta a `{ primaria, secundaria }` con tipos (strings).
 * Acepta tres formas, para no romper perfiles ya guardados:
 *  - number  → índice 0-7 del formato viejo (orden fijo de TIPOS)
 *  - string  → el tipo directamente (formato nuevo, sin segunda opción)
 *  - object  → { primaria, secundaria } (formato nuevo con segunda opción);
 *              también acepta índices numéricos dentro del objeto.
 */
function normalizarRespuesta(resp) {
  const aTipo = (v) => {
    if (typeof v === "number") return TIPOS[v] || null;
    if (typeof v === "string" && TIPOS.includes(v)) return v;
    return null;
  };

  if (resp && typeof resp === "object" && !Array.isArray(resp)) {
    const primaria = aTipo(resp.primaria);
    const secundaria = aTipo(resp.secundaria);
    return { primaria, secundaria: secundaria === primaria ? null : secundaria };
  }
  return { primaria: aTipo(resp), secundaria: null };
}

/**
 * Revisa si el patrón de respuestas da para un resultado creíble. No juzga
 * a la persona — solo detecta los casos en que claramente no se contestó
 * pensando (todo igual, o casi todo igual), donde darle un "perfil
 * dominante" sería inventarle algo.
 */
function evaluarConfiabilidad(normalizadas) {
  const primarias = normalizadas.map((r) => r.primaria).filter(Boolean);
  const distintos = new Set(primarias).size;

  if (primarias.length < 8) {
    return { confiable: false, motivo: "pocas_respuestas" };
  }
  if (distintos === 1) {
    return { confiable: false, motivo: "siempre_lo_mismo" };
  }
  if (distintos === 2 && primarias.length >= 10) {
    return { confiable: false, motivo: "muy_poca_variedad" };
  }
  return { confiable: true, motivo: null };
}

/**
 * @param {Array<number|string|{primaria:string, secundaria?:string}>} respuestas
 *
 * Calcula el perfil de inteligencias. Dos correcciones importantes frente
 * a la versión anterior:
 *
 * 1. **Segunda opción con medio punto.** Antes cada pregunta aportaba un
 *    solo dato; con 12 preguntas repartidas entre 8 categorías los empates
 *    eran constantes (en simulación, el 56% de los tests empataba justo en
 *    el corte del top 2). Permitir una segunda opción casi duplica la señal
 *    sin alargar el test.
 *
 * 2. **Desempate justo.** Antes se ordenaba con un sort estable sobre el
 *    arreglo TIPOS, así que ante un empate SIEMPRE ganaba el tipo que
 *    apareciera primero en ese arreglo — lingüística salía dominante 2.2
 *    veces más seguido que naturalista con respuestas puramente al azar.
 *    Ahora los empates se rompen por señal real: primero quien tenga más
 *    elecciones como primera opción, y si sigue empatado, quien haya sido
 *    elegido antes en el test (una preferencia temprana y espontánea pesa
 *    más que una tardía). Nunca por el orden del arreglo.
 */
function calcularResultado(respuestas) {
  const normalizadas = (respuestas || []).map(normalizarRespuesta);

  const peso = {};
  const vecesPrimaria = {};
  const primeraAparicion = {};
  TIPOS.forEach((t) => {
    peso[t] = 0;
    vecesPrimaria[t] = 0;
    primeraAparicion[t] = Infinity;
  });

  normalizadas.forEach(({ primaria, secundaria }, i) => {
    if (primaria) {
      peso[primaria] += PESO_PRIMARIA;
      vecesPrimaria[primaria]++;
      primeraAparicion[primaria] = Math.min(primeraAparicion[primaria], i);
    }
    if (secundaria) {
      peso[secundaria] += PESO_SECUNDARIA;
      primeraAparicion[secundaria] = Math.min(primeraAparicion[secundaria], i);
    }
  });

  const pesoTotal = TIPOS.reduce((s, t) => s + peso[t], 0) || 1;
  const porcentajes = {};
  TIPOS.forEach((t) => (porcentajes[t] = Math.round((peso[t] / pesoTotal) * 100)));

  const ordenado = TIPOS.slice().sort((a, b) => {
    if (peso[b] !== peso[a]) return peso[b] - peso[a];
    if (vecesPrimaria[b] !== vecesPrimaria[a]) return vecesPrimaria[b] - vecesPrimaria[a];
    if (primeraAparicion[a] !== primeraAparicion[b]) return primeraAparicion[a] - primeraAparicion[b];
    return 0;
  });

  const conPeso = ordenado.filter((t) => peso[t] > 0);
  const perfilDominante = conPeso.slice(0, 2);
  // Las que siguen, para mostrarlas como "también le funciona" sin darles
  // el peso visual de las principales.
  const secundarias = conPeso.slice(2, 4);

  const confiabilidad = evaluarConfiabilidad(normalizadas);
  const repasoSugerido = [...new Set(perfilDominante.flatMap((t) => REPASO_SUGERIDO[t] || []))];
  const actividadesSugeridas = perfilDominante.map((t) => ({ tipo: t, actividad: ACTIVIDADES_SUGERIDAS[t] }));

  return {
    conteo: peso, // ahora es peso (la primaria vale 1, la secundaria 0.5)
    porcentajes,
    perfil_dominante: perfilDominante,
    perfil_dominante_texto: perfilDominante.map((t) => ETIQUETAS[t]),
    secundarias,
    secundarias_texto: secundarias.map((t) => ETIQUETAS[t]),
    confiable: confiabilidad.confiable,
    motivo_no_confiable: confiabilidad.motivo,
    repaso_sugerido: repasoSugerido,
    actividades_sugeridas: actividadesSugeridas,
    // alias por compatibilidad con el nombre anterior del campo
    dominantes: perfilDominante,
    dominantes_texto: perfilDominante.map((t) => ETIQUETAS[t]),
  };
}

module.exports = {
  preguntasPublicas,
  calcularResultado,
  ETIQUETAS,
  TIPOS,
  ACTIVIDADES_SUGERIDAS,
};
