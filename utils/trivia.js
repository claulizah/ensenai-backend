/**
 * Calificación server-side de trivia — compartida entre modo grupo
 * (routes/grupos.js, liga pública g.html) y modo individual
 * (routes/temas.js, tema.html). Antes vivía duplicada solo en grupos.js;
 * se separó aquí al agregar el seguimiento de progreso individual
 * (31-ago-2026) para no mantener dos copias de la misma lógica.
 */

// Misma normalización que usan g.html/tema.html en el navegador — tiene que
// coincidir para que una respuesta correcta no se marque como incorrecta
// solo por mayúsculas o espacios de más.
function normalizarTexto(s) {
  return (s || "").toString().trim().toLowerCase();
}

/**
 * Recalcula "acerto" pregunta por pregunta usando el contenido REAL del
 * tema guardado en la base de datos (contenido.trivia), no lo que haya
 * mandado el cliente — así una respuesta manipulada desde las herramientas
 * de desarrollador no puede aparecer como "correcta" en ningún reporte.
 * Server siempre gana: pregunta, respuesta_correcta y acerto que salen de
 * aquí sustituyen lo que mandó el cliente; solo "respuesta" (lo que la
 * persona realmente contestó) es del cliente, porque eso no hay forma de
 * conocerlo del lado del servidor.
 */
function verificarRespuestas(contenido, respuestasCliente) {
  const triviaOriginal = Array.isArray(contenido?.trivia) ? contenido.trivia : [];

  return respuestasCliente.map((r) => {
    const original = Number.isInteger(r.indice) ? triviaOriginal[r.indice] : undefined;

    // No pudimos ubicar la pregunta original (tema editado, índice raro,
    // etc.) — guardamos lo que llegó pero sin confiar en su calificación.
    if (!original) {
      return {
        pregunta: typeof r.pregunta === "string" ? r.pregunta : "",
        respuesta: typeof r.respuesta === "string" ? r.respuesta : null,
        respuesta_correcta: typeof r.respuesta_correcta === "string" ? r.respuesta_correcta : "",
        acerto: null,
      };
    }

    const esCerrada = Array.isArray(original.opciones) && original.opciones.length > 0;
    const respuesta = typeof r.respuesta === "string" ? r.respuesta : null;
    const acerto = esCerrada
      ? !!respuesta && normalizarTexto(respuesta) === normalizarTexto(original.respuesta_correcta)
      : null; // abierta: nunca se autocalifica, ni aquí ni en el navegador

    return {
      pregunta: original.pregunta || "",
      respuesta,
      respuesta_correcta: original.respuesta_correcta || "",
      acerto,
    };
  });
}

module.exports = { normalizarTexto, verificarRespuestas };
