/**
 * Genera una ilustración con la API de imágenes de OpenAI (5-sep-2026).
 *
 * Pedido de la usuaria: "podría generar una app que utilice dall e para
 * generar mis imágenes y que todas tengan la misma estética?".
 *
 * Nota para quien lea esto después: DALL·E ya no existe. OpenAI lo apagó en
 * la API el 12 de mayo de 2026. Lo que se usa aquí es la familia GPT Image.
 *
 * ── Dónde se usa y dónde NO ──────────────────────────────────────────────
 * Esto es para LLENAR LA BIBLIOTECA de una vez, desde el panel de admin, no
 * para generar imágenes mientras un maestro espera su tema. La cuenta que
 * lo decide: un tema completo cuesta alrededor de 1 peso; tres imágenes en
 * calidad media le sumarían más de medio peso, y en calidad alta lo
 * multiplicarían por siete. Además cada imagen tarda entre 10 y 30
 * segundos. Generadas una vez y guardadas en el bucket, se reutilizan
 * gratis para siempre — que es exactamente como ya funciona icon_library.
 *
 * ── Qué hace que salgan parejas ──────────────────────────────────────────
 * Tres cosas, y ninguna es "pedirle bonito al modelo":
 *   1. ESTILO fijo — el mismo bloque de texto se pega a TODOS los prompts.
 *      Ayuda, pero por sí solo no alcanza: dos imágenes con el mismo prompt
 *      salen con paletas distintas.
 *   2. FONDO TRANSPARENTE — es lo que más iguala. Sin fondo no hay "un
 *      fondo azulito y otro rosita": la ilustración cae limpia sobre el
 *      material, siempre igual.
 *   3. FORMATO fijo — mismo tamaño y mismo cuadro para todas.
 *
 * Lo que NO se puede prometer: que el mismo personaje salga idéntico en
 * veinte hojas. Eso hoy no lo garantiza ningún modelo, y decir lo contrario
 * sería mentir. Para series de personaje conviene generar y escoger a mano.
 *
 * ── Lo que nunca se debe generar así ─────────────────────────────────────
 * Nada con texto ni con medidas. Los modelos escriben mal en español y
 * dibujan un rectángulo etiquetado "8 cm" que mide otra cosa. Para eso está
 * utils/figuras.js, donde el dibujo sale de los números y no puede
 * contradecirlos.
 */

const ENDPOINT = "https://api.openai.com/v1/images/generations";

/**
 * Precio por imagen de 1024×1024, en dólares (consultado el 5-sep-2026).
 * Se guarda aquí para poder decirle a la usuaria cuánto va a gastar ANTES
 * de que le dé al botón. Si OpenAI cambia precios, se cambia esta tabla.
 */
const MODELOS = {
  "gpt-image-1-mini": {
    etiqueta: "Mini — el barato",
    precios: { low: 0.005, medium: 0.011, high: 0.036 },
  },
  "gpt-image-1.5": {
    etiqueta: "1.5 — el bueno",
    precios: { low: 0.009, medium: 0.034, high: 0.133 },
  },
};

const MODELO_POR_OMISION = "gpt-image-1-mini";
const CALIDADES = ["low", "medium", "high"];

/**
 * El bloque de estilo. Se pega igualito a todos los prompts: es la mitad
 * del trabajo de que la biblioteca se vea de una sola familia.
 *
 * Está escrito en inglés a propósito — los modelos de imagen entienden
 * mejor las instrucciones de estilo en inglés, aunque lo que se dibuja se
 * describa en español. Eso no afecta el resultado: son dibujos, no texto.
 */
const ESTILO =
  "Flat vector illustration for children's educational material. " +
  "Simple rounded shapes, thick uniform outlines, no gradients, no shadows, no texture. " +
  "Friendly and cheerful, drawn for kids aged 4 to 10. " +
  "Limited palette of deep blue, sky blue, aqua, mint green, coral and warm amber. " +
  "Centered single subject, generous empty margin around it, nothing cropped by the edges. " +
  "Absolutely no text, no letters, no numbers, no labels, no watermark anywhere in the image.";

function hayLlave() {
  return !!process.env.OPENAI_API_KEY;
}

function modelosDisponibles() {
  return Object.keys(MODELOS).map((id) => ({
    id,
    etiqueta: MODELOS[id].etiqueta,
    precios: MODELOS[id].precios,
  }));
}

/** Cuánto costaría, en dólares. Devuelve null si no reconoce la combinación. */
function costoDe(modelo, calidad) {
  const m = MODELOS[modelo];
  if (!m) return null;
  const p = m.precios[calidad];
  return typeof p === "number" ? p : null;
}

/**
 * Arma el prompt final: lo que la persona quiere ver + el bloque de estilo.
 * La descripción va primero para que pese más que el estilo.
 */
function armarPrompt(descripcion) {
  const limpia = String(descripcion || "").trim().slice(0, 800);
  if (!limpia) return null;
  return `${limpia}.\n\n${ESTILO}`;
}

/**
 * Genera UNA imagen.
 *
 * @returns {Promise<{base64, tipoMime, costoUsd, modelo, calidad, prompt}>}
 * @throws  Error con mensaje en español, listo para enseñarse en pantalla.
 */
async function generarIlustracion(descripcion, opciones = {}) {
  if (!hayLlave()) {
    throw new Error(
      "Falta configurar OPENAI_API_KEY en las variables de Render. " +
      "Se saca en platform.openai.com → API keys, y hay que cargarle saldo."
    );
  }

  const prompt = armarPrompt(descripcion);
  if (!prompt) throw new Error("Escribe qué quieres que dibuje.");

  const modelo = MODELOS[opciones.modelo] ? opciones.modelo : MODELO_POR_OMISION;
  const calidad = CALIDADES.includes(opciones.calidad) ? opciones.calidad : "medium";
  const tamano = ["1024x1024", "1024x1536", "1536x1024"].includes(opciones.tamano)
    ? opciones.tamano
    : "1024x1024";

  // Sin timeout, una llamada colgada se queda pegada y bloquea el lote
  // entero. 90 s es holgado: la calidad alta ronda los 30.
  const corte = AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined;

  let respuesta;
  try {
    respuesta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelo,
        prompt,
        n: 1,
        size: tamano,
        quality: calidad,
        // Lo que más iguala la biblioteca: sin fondo, todas caen limpias
        // sobre el material en vez de traer cada una su propio recuadro.
        background: "transparent",
        output_format: "png",
      }),
      signal: corte,
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error("La imagen tardó demasiado. Intenta de nuevo o baja la calidad.");
    }
    throw new Error(`No se pudo conectar con OpenAI: ${err.message}`);
  }

  if (!respuesta.ok) {
    let detalle = "";
    try {
      const cuerpo = await respuesta.json();
      detalle = cuerpo?.error?.message || "";
    } catch (err) {
      /* la respuesta de error no era JSON; el status alcanza */
    }
    // Los tres errores que de verdad le van a salir, dichos en claro.
    if (respuesta.status === 401) throw new Error("La OPENAI_API_KEY no es válida o ya se revocó.");
    if (respuesta.status === 429) throw new Error("OpenAI está limitando las peticiones o se acabó el saldo. Revisa tu saldo y espera un momento.");
    if (respuesta.status === 400 && /safety|moderation|policy/i.test(detalle)) {
      throw new Error("El filtro de contenido de OpenAI rechazó esa descripción. Cámbiala y vuelve a intentar.");
    }
    throw new Error(`OpenAI contestó ${respuesta.status}${detalle ? ": " + detalle : ""}.`);
  }

  const datos = await respuesta.json();
  const primera = (datos && Array.isArray(datos.data) ? datos.data[0] : null) || {};
  const base64 = primera.b64_json;
  if (!base64) throw new Error("OpenAI no devolvió la imagen. Intenta de nuevo.");

  return {
    base64,
    tipoMime: "image/png",
    costoUsd: costoDe(modelo, calidad),
    modelo,
    calidad,
    prompt,
  };
}

module.exports = {
  generarIlustracion,
  modelosDisponibles,
  costoDe,
  hayLlave,
  MODELOS,
  CALIDADES,
  ESTILO,
};
