/**
 * Caché de material de tema YA VERIFICADO (8-sep-2026).
 *
 * utils/revisorCalidad.js (verificarYCorregir) ya sabía recibir un
 * `cache: { get(clave), set(clave, valor) }` desde que se escribió, pero
 * ningún llamador se lo pasaba — este archivo es esa implementación,
 * respaldada en Supabase (así sobrevive un reinicio de Render, a
 * diferencia de un Map en memoria).
 *
 * A propósito NO se usa para cualquier generación — ver dónde se conecta
 * en routes/temas.js:
 *   - Solo modo GRUPO. La actividad de grupo es genérica ("todas las
 *     inteligencias"), así que dos maestros pidiendo el mismo tema+nivel
 *     de verdad quieren el mismo material. En modo individual el perfil
 *     de inteligencias cambia el contenido y además cacharía la
 *     personalización — se deja fuera por ahora.
 *   - Solo si NO hay `detalles` (nota escrita) ni `imagenes` (fotos de
 *     apuntes) — esas dos cosas orientan la generación y un maestro que
 *     las mandó espera que se usen, no que le regresen el material
 *     genérico que le tocó a alguien más.
 * La clave (ver utils/revisorCalidad.js) ya incluye modo y enfoque, así
 * que un tema escolar y uno psicoeducativo con el mismo nombre nunca se
 * mezclan.
 */
const supabase = require("../db/supabase");

async function get(clave) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("material_tema_cache")
    .select("contenido, veces_usado")
    .eq("clave", clave)
    .maybeSingle();
  if (error || !data) return null;

  // Contador de uso: informativo (para saber qué temas conviene precargar
  // o revisar primero), nunca debe tumbar la respuesta si falla.
  supabase
    .from("material_tema_cache")
    .update({ veces_usado: (data.veces_usado || 1) + 1, actualizada_en: new Date().toISOString() })
    .eq("clave", clave)
    .then(() => {}, () => {});

  return data.contenido || null;
}

async function set(clave, valor) {
  if (!supabase) return;
  try {
    await supabase
      .from("material_tema_cache")
      .upsert(
        { clave, contenido: valor, actualizada_en: new Date().toISOString() },
        { onConflict: "clave" }
      );
  } catch (err) {
    // Guardar en caché es una optimización, no un requisito — si falla,
    // el tema ya se generó y se le entregó bien al usuario de todas formas.
    console.warn("[cache material_tema] no se pudo guardar:", err.message);
  }
}

module.exports = { get, set };
