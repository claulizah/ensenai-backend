/**
 * Quiz de inteligencias múltiples (teoría de Gardner) — ayuda a identificar
 * cómo aprende mejor un niño, para en el futuro recomendar qué tipo de
 * repaso (memorama/flashcards/rima) le puede servir más.
 *
 * IMPORTANTE — esto es una guía orientativa, no un diagnóstico clínico ni
 * psicológico. Los niños cambian rápido; es una tendencia, no una etiqueta fija.
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

const PREGUNTAS = [
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
];

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

function preguntasPublicas() {
  return PREGUNTAS;
}

/**
 * @param {number[]} respuestas - un índice (0-7) por cada pregunta, en orden
 */
function calcularResultado(respuestas) {
  const conteo = {};
  TIPOS.forEach((t) => (conteo[t] = 0));

  respuestas.forEach((indice) => {
    const tipo = TIPOS[indice];
    if (tipo) conteo[tipo]++;
  });

  const maxConteo = Math.max(...Object.values(conteo));
  const dominantes = TIPOS.filter((t) => conteo[t] === maxConteo && maxConteo > 0);

  const repasoSugerido = [...new Set(dominantes.flatMap((t) => REPASO_SUGERIDO[t] || []))];

  return {
    dominantes,
    dominantes_texto: dominantes.map((t) => ETIQUETAS[t]),
    repaso_sugerido: repasoSugerido,
    conteo,
  };
}

module.exports = { preguntasPublicas, calcularResultado, ETIQUETAS };
