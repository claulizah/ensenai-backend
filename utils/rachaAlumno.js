const supabase = require("../db/supabase");
const { primerNombre } = require("./nombre");

/**
 * Racha de los alumnos/pacientes que entran por la liga pública, sin cuenta
 * (2-sep-2026). Es el equivalente de utils/gamificacion.js para el modo
 * grupo, pero mucho más chico a propósito: aquí no hay medallas ni trivia
 * diaria — el gancho del alumno es no romper la cadena, y el del maestro es
 * ver quién la está siguiendo.
 *
 * Identidad: un id que genera el NAVEGADOR del alumno y guarda en
 * localStorage (ver g.html y db/schema_v37.sql). Con todo lo que eso
 * implica: otro aparato = racha nueva. No se promete más que eso en
 * pantalla.
 *
 * Cuenta como día activo: contestar la trivia de un tema o marcar
 * ejercicios como resueltos. Entrar a mirar no cuenta.
 */

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function diasEntre(fechaA, fechaB) {
  const a = new Date(`${fechaA}T00:00:00Z`);
  const b = new Date(`${fechaB}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Un id de navegador que no venga en la forma esperada se ignora en vez de
 * romper la petición: el alumno tiene que poder contestar su trivia aunque
 * su localStorage traiga basura. */
function normalizarAlumnoId(valor) {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  if (limpio.length < 8 || limpio.length > 64) return null;
  return /^[A-Za-z0-9_-]+$/.test(limpio) ? limpio : null;
}

/**
 * Marca actividad de HOY para un alumno dentro de un grupo y devuelve su
 * racha. Nunca lanza: si algo falla (tabla sin migrar, red), el alumno ya
 * contestó su trivia y eso no se puede echar a perder por un contador.
 *
 * @param {string} grupoId
 * @param {string} alumnoIdCrudo - id del navegador, tal como llegó
 * @param {object} [opciones]
 * @param {string|null} [opciones.nombre] - nombre tal como lo escribió
 * @param {boolean} [opciones.guardarNombre] - false en grupos anónimos
 * @returns {Promise<{racha_actual:number, racha_record:number, dias_activos:number, es_dia_nuevo:boolean}|null>}
 */
async function registrarActividadAlumno(grupoId, alumnoIdCrudo, opciones = {}) {
  if (!supabase) return null;
  const alumnoId = normalizarAlumnoId(alumnoIdCrudo);
  if (!alumnoId || !grupoId) return null;

  try {
    const { data: actual, error } = await supabase
      .from("rachas_alumno")
      .select("*")
      .eq("grupo_id", grupoId)
      .eq("alumno_id", alumnoId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const hoy = hoyISO();
    const previo = actual || { racha_actual: 0, racha_record: 0, dias_activos: 0, ultimo_dia: null };
    const esDiaNuevo = previo.ultimo_dia !== hoy;

    let racha = previo.racha_actual || 0;
    if (!esDiaNuevo) {
      // Ya hubo actividad hoy: la racha no se mueve por contestar dos veces.
    } else if (previo.ultimo_dia && diasEntre(previo.ultimo_dia, hoy) === 1) {
      racha += 1;
    } else {
      racha = 1;
    }

    const fila = {
      grupo_id: grupoId,
      alumno_id: alumnoId,
      racha_actual: racha,
      racha_record: Math.max(previo.racha_record || 0, racha),
      dias_activos: (previo.dias_activos || 0) + (esDiaNuevo ? 1 : 0),
      ultimo_dia: hoy,
    };

    // El nombre solo se guarda en grupos que sí piden nombre, y siempre
    // recortado al primer nombre (utils/nombre.js) — mismo criterio que
    // respuestas_alumno. Si en esta visita no lo dio, se conserva el que ya
    // estaba en vez de borrarlo.
    if (opciones.guardarNombre) {
      const nombre = primerNombre(opciones.nombre);
      if (nombre) fila.nombre = nombre;
    }

    const { error: errorGuardar } = await supabase
      .from("rachas_alumno")
      .upsert(fila, { onConflict: "grupo_id,alumno_id" });
    if (errorGuardar) throw new Error(errorGuardar.message);

    return {
      racha_actual: fila.racha_actual,
      racha_record: fila.racha_record,
      dias_activos: fila.dias_activos,
      es_dia_nuevo: esDiaNuevo,
    };
  } catch (err) {
    console.warn("[racha alumno] no se pudo registrar:", err.message);
    return null;
  }
}

/**
 * Lo que ve el maestro: cómo va cada alumno de su grupo. Ordenado por racha
 * (los más constantes arriba) y, a igual racha, por actividad más reciente.
 */
async function rachasDelGrupo(grupoId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("rachas_alumno")
    .select("alumno_id, nombre, racha_actual, racha_record, dias_activos, ultimo_dia")
    .eq("grupo_id", grupoId);
  if (error) throw new Error(error.message);

  return (data || [])
    .map((r, i) => ({ ...r, nombre: r.nombre || null, orden: i }))
    .sort((a, b) => {
      if (b.racha_actual !== a.racha_actual) return b.racha_actual - a.racha_actual;
      return String(b.ultimo_dia || "").localeCompare(String(a.ultimo_dia || ""));
    });
}

module.exports = { registrarActividadAlumno, rachasDelGrupo, normalizarAlumnoId };
