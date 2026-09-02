const supabase = require("../db/supabase");

/**
 * "Gancho para volver" del modo individual (papás/estudiantes/adultos):
 * una racha de días activos — generar un tema, armar un simulacro, o
 * completar la trivia diaria, lo que sea, cuenta como "hoy estuviste
 * aquí" — más un catálogo fijo de medallas por hitos.
 *
 * Todo por CUENTA, no por perfil/hijo: mis_temas no guarda a qué perfil
 * pertenece cada tema (solo `perfil_usado`, la inteligencia dominante que
 * se usó ese día), así que no hay forma de saber "el perfil de Juan lleva
 * 3 días" sin cambiar ese esquema — se deja así para v1.
 *
 * No aplica al modo grupo/maestro (ver schema_v29.sql) — para un maestro
 * el enganche es ver el avance de su grupo, no generar contenido seguido.
 */

const CATALOGO_MEDALLAS = [
  { codigo: "primer_paso", nombre: "Primer paso", icono: "🌱", descripcion: "Generaste tu primer tema." },
  { codigo: "racha_3", nombre: "Racha de 3 días", icono: "🔥", descripcion: "3 días seguidos estudiando." },
  { codigo: "racha_7", nombre: "Racha de 7 días", icono: "🔥🔥", descripcion: "7 días seguidos estudiando." },
  { codigo: "racha_30", nombre: "Racha de 30 días", icono: "🔥🔥🔥", descripcion: "30 días seguidos estudiando." },
  { codigo: "temas_10", nombre: "10 temas", icono: "📚", descripcion: "Generaste 10 temas." },
  { codigo: "temas_50", nombre: "50 temas", icono: "📚📚", descripcion: "Generaste 50 temas." },
  { codigo: "examen_1", nombre: "Primer simulacro", icono: "🎯", descripcion: "Armaste tu primer simulacro de examen." },
  { codigo: "examen_5", nombre: "5 simulacros", icono: "🎯🎯", descripcion: "Armaste 5 simulacros de examen." },
  { codigo: "etiqueta_1", nombre: "Organizador", icono: "🏷️", descripcion: "Usaste tu primera etiqueta." },
  { codigo: "trivia_diaria_1", nombre: "Trivia diaria", icono: "🧠", descripcion: "Completaste tu primera trivia diaria." },
];

function hoyISO() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD — basta porque ultima_actividad es date, no timestamp
}

function diasEntre(fechaA, fechaB) {
  const a = new Date(`${fechaA}T00:00:00Z`);
  const b = new Date(`${fechaB}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

async function obtenerOCrear(userId) {
  const { data, error } = await supabase.from("gamificacion").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || { user_id: userId, racha_actual: 0, racha_record: 0, ultima_actividad: null, medallas: [] };
}

/**
 * Marca actividad de HOY y recalcula racha + medallas nuevas. Se llama
 * desde POST /generar, POST /combinar y POST /trivia-diaria/completar (ver
 * routes/temas.js) — cualquiera de las tres cuenta como el día activo.
 *
 * @param {string} userId
 * @param {object} [contexto]
 * @param {boolean} [contexto.contarTemas] - true si esta llamada acaba de
 * guardar una fila en mis_temas (generar o combinar) — dispara los
 * conteos de "primer_paso"/"temas_N"/"examen_N".
 * @param {boolean} [contexto.etiquetaUsada] - true si el tema que se
 * acaba de generar llevaba al menos una etiqueta.
 * @param {boolean} [contexto.triviaDiariaCompletada] - true si esta
 * llamada viene de completar la trivia diaria.
 * @returns {Promise<{racha_actual:number, racha_record:number, medallas_nuevas:Array}>}
 */
async function registrarActividad(userId, contexto = {}) {
  if (!supabase) return { racha_actual: 0, racha_record: 0, medallas_nuevas: [] };

  const estado = await obtenerOCrear(userId);
  const hoy = hoyISO();

  let racha = estado.racha_actual || 0;
  if (estado.ultima_actividad === hoy) {
    // ya había actividad hoy — la racha no cambia, solo se revisan medallas nuevas
  } else if (estado.ultima_actividad && diasEntre(estado.ultima_actividad, hoy) === 1) {
    racha += 1;
  } else {
    racha = 1; // primera actividad de siempre, o se rompió la racha (hueco de 2+ días)
  }
  const record = Math.max(estado.racha_record || 0, racha);

  const medallasActuales = new Set(estado.medallas || []);
  const medallasNuevas = [];
  const otorgar = (codigo) => {
    if (medallasActuales.has(codigo)) return;
    medallasActuales.add(codigo);
    const medalla = CATALOGO_MEDALLAS.find((m) => m.codigo === codigo);
    if (medalla) medallasNuevas.push(medalla);
  };

  if (racha >= 3) otorgar("racha_3");
  if (racha >= 7) otorgar("racha_7");
  if (racha >= 30) otorgar("racha_30");
  if (contexto.etiquetaUsada) otorgar("etiqueta_1");
  if (contexto.triviaDiariaCompletada) otorgar("trivia_diaria_1");

  if (contexto.contarTemas) {
    const { count: totalTemas, error: errTemas } = await supabase
      .from("mis_temas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "tema");
    if (errTemas) throw new Error(errTemas.message);
    if ((totalTemas || 0) >= 1) otorgar("primer_paso");
    if ((totalTemas || 0) >= 10) otorgar("temas_10");
    if ((totalTemas || 0) >= 50) otorgar("temas_50");

    const { count: totalExamenes, error: errExamenes } = await supabase
      .from("mis_temas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("tipo", "examen");
    if (errExamenes) throw new Error(errExamenes.message);
    if ((totalExamenes || 0) >= 1) otorgar("examen_1");
    if ((totalExamenes || 0) >= 5) otorgar("examen_5");
  }

  const { error: upsertError } = await supabase.from("gamificacion").upsert({
    user_id: userId,
    racha_actual: racha,
    racha_record: record,
    ultima_actividad: hoy,
    medallas: [...medallasActuales],
    updated_at: new Date().toISOString(),
  });
  if (upsertError) throw new Error(upsertError.message);

  return { racha_actual: racha, racha_record: record, medallas_nuevas: medallasNuevas };
}

/**
 * Solo lectura — para GET /mi-plan, que se pide cada vez que se abre la
 * app y no debe registrar actividad ni tocar la racha.
 */
async function obtenerEstadoGamificacion(userId) {
  if (!supabase) return { racha_actual: 0, racha_record: 0, medallas: [] };
  const estado = await obtenerOCrear(userId);
  return { racha_actual: estado.racha_actual || 0, racha_record: estado.racha_record || 0, medallas: estado.medallas || [] };
}

/**
 * Arma la trivia diaria de un usuario: junta la trivia de todos sus temas
 * guardados (mis_temas.contenido.trivia) y elige hasta `cuantas` preguntas.
 * La selección es determinística por día (mismo usuario + misma fecha ⇒
 * mismas preguntas) usando una semilla simple — así no se reparte distinto
 * cada vez que abren la pantalla el mismo día, sin necesidad de guardar
 * nada en la base de datos.
 */
function pseudoAleatorio(semilla) {
  // xorshift32 — determinístico, no necesita ninguna librería de por medio.
  let x = semilla | 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1000000) / 1000000;
  };
}

function semillaDe(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) {
    h = (h * 31 + texto.charCodeAt(i)) | 0;
  }
  return h;
}

async function armarTriviaDiaria(userId, cuantas = 5) {
  if (!supabase) return { disponible: false, motivo: "Supabase no está configurado." };

  // Los temas marcados como "ya lo aprendí" (db/schema_v36.sql) no vuelven a
  // salir en la trivia diaria: es exactamente lo que pidió la usuaria con
  // "quitar de la racha en caso de ya ser aprendidos". Si la migración
  // todavía no se corrió, se pide sin esa columna y se sigue como antes.
  let temas = null;
  {
    const conColumna = await supabase
      .from("mis_temas")
      .select("id, tema, contenido, aprendido")
      .eq("user_id", userId)
      .eq("aprendido", false);
    if (!conColumna.error) {
      temas = conColumna.data;
    } else if (conColumna.error.code === "42703" || /column .*aprendido.* does not exist/i.test(conColumna.error.message || "")) {
      const sinColumna = await supabase.from("mis_temas").select("id, tema, contenido").eq("user_id", userId);
      if (sinColumna.error) throw new Error(sinColumna.error.message);
      temas = sinColumna.data;
    } else {
      throw new Error(conColumna.error.message);
    }
  }

  const pool = [];
  for (const t of temas || []) {
    const trivia = t.contenido?.trivia;
    if (!Array.isArray(trivia)) continue;
    for (const p of trivia) {
      if (p?.pregunta && p?.respuesta_correcta) {
        pool.push({ pregunta: p.pregunta, tipo: p.tipo || "opcion", opciones: p.opciones || [], respuesta_correcta: p.respuesta_correcta, origen_tema: t.tema });
      }
    }
  }

  if (!pool.length) {
    return {
      disponible: false,
      motivo: "Genera al menos un tema (que no esté marcado como aprendido) para desbloquear tu trivia diaria.",
    };
  }

  const hoy = hoyISO();
  const rand = pseudoAleatorio(semillaDe(`${userId}:${hoy}`));
  // Fisher-Yates con el generador determinístico de arriba.
  const barajado = [...pool];
  for (let i = barajado.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [barajado[i], barajado[j]] = [barajado[j], barajado[i]];
  }

  return { disponible: true, preguntas: barajado.slice(0, Math.min(cuantas, barajado.length)) };
}

module.exports = { registrarActividad, obtenerEstadoGamificacion, armarTriviaDiaria, CATALOGO_MEDALLAS };
