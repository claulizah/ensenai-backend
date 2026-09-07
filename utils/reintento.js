/**
 * Reintento con espera para las llamadas a la API de Anthropic (7-sep-2026).
 *
 * Por qué existe: generateTema.js ya reintentaba una vez, pero de
 * INMEDIATO. Eso funciona para lo que motivó ese reintento (un JSON que
 * llegó truncado), pero no para las dos fallas que aparecen cuando varias
 * personas generan al mismo tiempo:
 *
 *   · 429 — se tocó el límite de peticiones de la cuenta de Anthropic.
 *   · 529 — Anthropic está saturado (overloaded).
 *
 * En esos dos casos volver a pedir en el mismo milisegundo choca contra la
 * misma pared: se gastan los dos intentos en un segundo y el maestro ve un
 * error que se habría resuelto solo esperando dos segundos. Esperar entre
 * intentos es la diferencia entre "no sirvió" y "tardó un poquito más".
 *
 * Cuánto se espera: lo que diga la cabecera `retry-after` si viene, y si
 * no, 1s, 4s, 9s (crecimiento cuadrático) más un poco de azar. El azar
 * importa cuando son varias peticiones a la vez: sin él, las cinco que
 * fallaron juntas reintentan juntas y vuelven a chocar juntas.
 *
 * Los errores que NO son de saturación (un prompt inválido, una llave
 * mal puesta, un JSON truncado) se reintentan igual pero sin esperar,
 * para no volver lento el caso que este archivo no vino a resolver.
 */

/** Códigos donde esperar sí sirve: la falla es de carga, no del contenido. */
const CODIGOS_DE_ESPERA = new Set([429, 500, 502, 503, 504, 529]);

function esDeSaturacion(err) {
  const status = err?.status ?? err?.statusCode ?? err?.response?.status;
  if (CODIGOS_DE_ESPERA.has(Number(status))) return true;
  const texto = String(err?.message || "").toLowerCase();
  return texto.includes("rate limit") || texto.includes("overloaded") || texto.includes("too many requests");
}

/** Segundos que pide el servidor, si los pide. */
function esperaSugerida(err) {
  const cabeceras = err?.headers || err?.response?.headers;
  if (!cabeceras) return null;
  const valor = typeof cabeceras.get === "function" ? cabeceras.get("retry-after") : cabeceras["retry-after"];
  const segundos = Number(valor);
  // Tope de 30s: si Anthropic pide más, es mejor fallar rápido y que la
  // persona vuelva a intentar que dejarla mirando una pantalla congelada.
  return Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 30) * 1000 : null;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opciones del cliente de Anthropic que usa todo el backend.
 *
 * Por default el SDK espera 10 MINUTOS por llamada y reintenta 2 veces
 * solo — o sea, hasta 30 minutos escondidos dentro de UNA llamada. Eso ya
 * era un problema (el frontend se rinde a los 8 min y barrerZombis marca
 * el trabajo como fallido a los 10, mientras el proceso sigue gastando
 * tokens por media hora), y se vuelve peor si encima nosotros
 * reintentamos: las capas se multiplican en vez de sumarse.
 *
 * Así que: un tope claro por llamada, y CERO reintentos del SDK — los
 * reintentos los hace conReintento(), que sí espera entre uno y otro y
 * respeta un presupuesto total.
 */
const OPCIONES_CLIENTE = {
  timeout: 120 * 1000, // una generación normal tarda 40-90 s
  maxRetries: 0,       // los reintentos son nuestros, con espera
};

/**
 * Corre `fn` y la reintenta hasta `intentos` veces en total, sin pasarse
 * de `presupuestoMs` contando desde la primera llamada.
 *
 * El presupuesto existe porque los reintentos se anidan: el revisor de
 * calidad (utils/revisorCalidad.js) ya regenera hasta 2 veces, y cada una
 * de esas pasa por aquí. Sin tope, 2 × 3 intentos de 120 s se van a 12
 * minutos — y el maestro dejó de esperar a los 8. Mejor darle un error
 * honesto a los 4 minutos que dejarlo viendo una pantalla que ya nadie
 * está escuchando.
 *
 * @param {() => Promise<any>} fn
 * @param {{intentos?: number, etiqueta?: string, presupuestoMs?: number}} opciones
 */
async function conReintento(fn, opciones = {}) {
  const intentos = opciones.intentos || 3;
  const etiqueta = opciones.etiqueta || "anthropic";
  const presupuestoMs = opciones.presupuestoMs || 4 * 60 * 1000;
  const arranque = Date.now();
  let ultimo;

  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      if (i === intentos) break;

      if (esDeSaturacion(err)) {
        // 1s, 4s, 9s… más 0-500ms de azar para que las peticiones que
        // fallaron juntas no reintenten todas en el mismo instante.
        const espera = esperaSugerida(err) ?? i * i * 1000 + Math.random() * 500;
        const transcurrido = Date.now() - arranque;
        if (transcurrido + espera > presupuestoMs) {
          console.warn(`[${etiqueta}] se acabó el presupuesto (${Math.round(transcurrido / 1000)}s), ya no se reintenta`);
          break;
        }
        console.warn(`[${etiqueta}] intento ${i}/${intentos} falló por saturación (${err.status || "?"}), reintento en ${Math.round(espera)}ms`);
        await dormir(espera);
      } else {
        if (Date.now() - arranque > presupuestoMs) {
          console.warn(`[${etiqueta}] se acabó el presupuesto, ya no se reintenta`);
          break;
        }
        console.warn(`[${etiqueta}] intento ${i}/${intentos} falló: ${err.message}`);
      }
    }
  }
  throw ultimo;
}

module.exports = { conReintento, esDeSaturacion, OPCIONES_CLIENTE };
