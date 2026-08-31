const supabase = require("../db/supabase");

/**
 * Programa de referidos (gancho de crecimiento, ago-2026): cada usuario
 * tiene un código propio para compartir. Cada vez que alguien nuevo lo
 * canjea, quien invitó gana +1 tema de regalo — un "crédito" que no
 * caduca y se consume solo cuando ya se le acabó su límite normal del mes
 * (ver resolverAccesoIndividual en routes/temas.js). Quien se une con el
 * código no gana nada aparte del boost normal de cuenta nueva (ver
 * utils/planes.js) — no hay recompensa doble.
 *
 * Un código solo se puede canjear UNA vez por cuenta (nunca el propio).
 */

const CARACTERES_SUFIJO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I para que no se confundan al compartirlo de palabra

function sufijoAleatorio(largo = 4) {
  let s = "";
  for (let i = 0; i < largo; i++) {
    s += CARACTERES_SUFIJO[Math.floor(Math.random() * CARACTERES_SUFIJO.length)];
  }
  return s;
}

function baseDeCorreo(email) {
  const local = String(email || "").split("@")[0] || "";
  const limpio = local
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos (marcas diacríticas combinantes tras NFD)
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return (limpio.slice(0, 5) || "AMIGO");
}

/**
 * Regresa el código de referido del usuario, generándolo la primera vez
 * que se pide. Reintenta con otro sufijo si el código chocara con uno ya
 * existente (poco probable, pero el UNIQUE de la columna lo garantiza).
 */
async function obtenerOCrearCodigo(userId, email) {
  const { data: fila, error } = await supabase.from("usuarios_ajustes").select("codigo_referido").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (fila?.codigo_referido) return fila.codigo_referido;

  const base = baseDeCorreo(email);
  for (let intento = 0; intento < 5; intento++) {
    const codigo = `${base}${sufijoAleatorio()}`;
    const { error: upsertError } = await supabase.from("usuarios_ajustes").upsert(
      { user_id: userId, codigo_referido: codigo, actualizado_en: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (!upsertError) return codigo;
    // 23505 = unique_violation en Postgres — el código ya existía, se reintenta con otro sufijo.
    if (upsertError.code !== "23505") throw new Error(upsertError.message);
  }
  throw new Error("No se pudo generar un código de referido único — intenta de nuevo.");
}

/**
 * Canjea un código de referido a nombre de `userId`. Regresa
 * { ok: true } o { ok: false, error } con un mensaje listo para mostrar.
 */
async function canjearCodigo(userId, codigoIngresado) {
  const codigo = String(codigoIngresado || "").trim().toUpperCase();
  if (!codigo) return { ok: false, error: "Escribe un código." };

  const { data: filaCodigo, error: errCodigo } = await supabase
    .from("usuarios_ajustes")
    .select("user_id")
    .eq("codigo_referido", codigo)
    .maybeSingle();
  if (errCodigo) throw new Error(errCodigo.message);
  if (!filaCodigo) return { ok: false, error: "Ese código no existe. Revisa que esté bien escrito." };
  if (filaCodigo.user_id === userId) return { ok: false, error: "No puedes canjear tu propio código." };

  const { data: yaCanjeo, error: errYaCanjeo } = await supabase
    .from("referidos_canjeados")
    .select("id")
    .eq("user_id_referido", userId)
    .maybeSingle();
  if (errYaCanjeo) throw new Error(errYaCanjeo.message);
  if (yaCanjeo) return { ok: false, error: "Ya canjeaste un código de referido antes — solo se puede usar uno por cuenta." };

  const { error: errInsert } = await supabase
    .from("referidos_canjeados")
    .insert({ codigo, user_id_referidor: filaCodigo.user_id, user_id_referido: userId });
  if (errInsert) throw new Error(errInsert.message);

  await incrementarBono(filaCodigo.user_id);
  return { ok: true };
}

async function incrementarBono(userId) {
  const { data: fila, error } = await supabase.from("usuarios_ajustes").select("bono_temas_disponibles").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  const actual = fila?.bono_temas_disponibles || 0;
  const { error: errUpdate } = await supabase
    .from("usuarios_ajustes")
    .upsert({ user_id: userId, bono_temas_disponibles: actual + 1, actualizado_en: new Date().toISOString() }, { onConflict: "user_id" });
  if (errUpdate) throw new Error(errUpdate.message);
}

async function obtenerBono(userId) {
  const { data, error } = await supabase.from("usuarios_ajustes").select("bono_temas_disponibles").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.bono_temas_disponibles || 0;
}

/**
 * Descuenta 1 crédito — se llama SOLO después de que la generación de
 * verdad se cumplió (mismo criterio que el límite mensual normal, que
 * tampoco se cobra si Claude falla a medias). Best-effort: si falla no
 * debe tumbar la respuesta que el usuario ya recibió.
 */
async function consumirBono(userId) {
  const bono = await obtenerBono(userId);
  if (bono <= 0) return;
  const { error } = await supabase
    .from("usuarios_ajustes")
    .upsert({ user_id: userId, bono_temas_disponibles: bono - 1, actualizado_en: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

module.exports = { obtenerOCrearCodigo, canjearCodigo, obtenerBono, consumirBono };
