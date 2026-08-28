/**
 * Reduce un nombre libre (el que el alumno escribió al entrar a una liga de
 * grupo, ej. "Ana García" o "Grupo 3B - Juan") a solo su primer "token" —
 * pensado para minimizar qué se guarda junto a las respuestas de trivia de
 * un alumno: alcanza para que el profesional distinga entre alumnos sin
 * guardar el nombre completo que haya escrito.
 *
 * @param {string|null|undefined} nombre
 * @returns {string|null}
 */
function primerNombre(nombre) {
  const limpio = (nombre || "").trim();
  if (!limpio) return null;
  return limpio.split(/\s+/)[0];
}

module.exports = { primerNombre };
