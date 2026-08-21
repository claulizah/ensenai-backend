/**
 * Valida que un CURP tenga el formato oficial correcto (18 caracteres,
 * estructura de fecha de nacimiento, sexo, estado, etc.)
 *
 * IMPORTANTE — esto es solo "Nivel 1": confirma que el CURP está bien
 * formado, NO confirma que la persona sea real ni que el CURP exista de
 * verdad en RENAPO. Para eso se necesitaría una consulta en vivo (manual
 * en gob.mx/curp, o una API de pago) — no está conectado por ahora.
 */
const CURP_REGEX =
  /^[A-Z][AEIOU][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QO|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d][A-Z\d]$/;

function tieneFormatoValido(curp) {
  if (!curp || typeof curp !== "string") return false;
  return CURP_REGEX.test(curp.trim().toUpperCase());
}

module.exports = { tieneFormatoValido };
