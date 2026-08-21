/**
 * Quiz de comprensión de reglas — NO mide aptitud pedagógica ni psicológica,
 * solo confirma que el creador entendió las expectativas de la plataforma
 * antes de empezar. Sirve como una señal más (junto con CURP y bio) para
 * la revisión manual de verificación — no aprueba a nadie automáticamente.
 */
const PREGUNTAS = [
  {
    id: 1,
    pregunta: "¿Quién puede subir contenido a EnseñAI?",
    opciones: [
      "Cualquier persona, incluidos niños",
      "Solo adultos: maestros, psicólogos o educadores verificados",
      "Solo la plataforma",
    ],
  },
  {
    id: 2,
    pregunta: "Si tu video es rechazado en la revisión, ¿qué deberías hacer?",
    opciones: [
      "Subir uno nuevo que sí cumpla las reglas",
      "Publicarlo de todos modos",
      "Pedir que otra persona lo suba por ti",
    ],
  },
  {
    id: 3,
    pregunta: "El material que genera la IA (resumen, trivia, etc.) antes de publicarse debe...",
    opciones: ["Publicarse tal cual, sin revisar", "Revisarse y ajustarse si hace falta", "Ignorarse por completo"],
  },
  {
    id: 4,
    pregunta: "Si compartes contenido inapropiado para niños, ¿qué puede pasar?",
    opciones: [
      "Nada, si la intención era buena",
      "Tu cuenta puede ser suspendida y el contenido removido",
      "Solo recibes una advertencia y nada más",
    ],
  },
  {
    id: 5,
    pregunta: "El precio de cada curso individual...",
    opciones: ["Lo pones tú libremente", "Es fijo, definido por la plataforma", "Siempre es gratis"],
  },
];

// índice (0-based) de la opción correcta, por id de pregunta
const RESPUESTAS_CORRECTAS = { 1: 1, 2: 0, 3: 1, 4: 1, 5: 1 };

const PUNTAJE_MINIMO_APROBAR = 4; // de 5

function preguntasPublicas() {
  // regresa las preguntas SIN las respuestas correctas
  return PREGUNTAS.map(({ id, pregunta, opciones }) => ({ id, pregunta, opciones }));
}

function calificar(respuestas) {
  // respuestas: { "1": 1, "2": 0, ... } — id de pregunta -> índice elegido
  let puntaje = 0;
  for (const pregunta of PREGUNTAS) {
    const elegida = respuestas?.[pregunta.id];
    if (elegida === RESPUESTAS_CORRECTAS[pregunta.id]) puntaje++;
  }
  return { puntaje, total: PREGUNTAS.length, aprobado: puntaje >= PUNTAJE_MINIMO_APROBAR };
}

module.exports = { preguntasPublicas, calificar };
