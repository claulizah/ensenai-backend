/**
 * Utilidades para los archivos que se suben desde el panel de admin
 * (ver routes/admin.js). Aparte del router para poder probarlas solas.
 */

const TIPOS_ILUSTRACION = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const TIPOS_PLANTILLA = {
  ...TIPOS_ILUSTRACION,
  "application/pdf": "pdf",
};

// 2 MB por archivo. Una ilustración SVG pesa unos pocos KB y un PDF de
// una o dos hojas rara vez pasa de 1 MB; el tope está para que un
// arrastre accidental de una foto de 12 MP no se vaya al Storage.
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Un SVG es un documento, no una imagen: puede traer <script>, manejadores
 * onload/onclick y enlaces javascript:. Como la usuaria va a subir archivos
 * bajados de internet, se limpian ANTES de guardarlos — no al pintarlos, que
 * es donde se olvida.
 *
 * En la página además se muestran con <img src>, que no ejecuta scripts ni
 * aunque quedara alguno; esto es la segunda cerradura, no la única.
 */
function limpiarSvg(texto) {
  let svg = String(texto || "");

  // <script>…</script> completo, y también uno sin cerrar
  svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  svg = svg.replace(/<script[\s\S]*$/gi, "");

  // <foreignObject> puede meter HTML arbitrario dentro del SVG
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");

  // <use href="http://otro-sitio/…"> y <image href="…"> externos
  svg = svg.replace(/<(use|image)\b[^>]*\bhref\s*=\s*(['"])\s*https?:[\s\S]*?\2[^>]*>/gi, "");

  // manejadores de evento: onload=, onclick=, onmouseover=…
  svg = svg.replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "");
  svg = svg.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // javascript: en cualquier atributo (href, xlink:href, style…)
  svg = svg.replace(/(['"(=]\s*)javascript\s*:/gi, "$1");

  // <a> hacia fuera: se deja el contenido, se quita el enlace
  svg = svg.replace(/<a\b[^>]*>/gi, "").replace(/<\/a\s*>/gi, "");

  return svg;
}

/** ¿El texto se ve como un SVG de verdad? */
function pareceSvg(texto) {
  return /<svg[\s>]/i.test(String(texto || ""));
}

/**
 * Convierte lo que manda el navegador (data URL o base64 pelón) en un
 * Buffer, revisando tipo y tamaño. Devuelve { error } si algo no cuadra,
 * para que el router conteste 400 con un mensaje que se entienda.
 */
function leerArchivoSubido(base64, tipoMime, tiposPermitidos) {
  if (!base64 || typeof base64 !== "string") {
    return { error: "Falta el archivo." };
  }
  const extension = tiposPermitidos[tipoMime];
  if (!extension) {
    const lista = Object.keys(tiposPermitidos)
      .map((t) => t.split("/")[1].replace("svg+xml", "svg"))
      .join(", ");
    return { error: `Ese tipo de archivo no se puede subir aquí. Se aceptan: ${lista}.` };
  }

  // Se acepta tanto "data:image/svg+xml;base64,AAA" como "AAA" pelón.
  const limpio = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  let buffer;
  try {
    buffer = Buffer.from(limpio, "base64");
  } catch (err) {
    return { error: "No pudimos leer el archivo. Vuelve a intentarlo." };
  }
  if (!buffer.length) return { error: "El archivo llegó vacío." };
  if (buffer.length > MAX_BYTES) {
    return { error: `El archivo pesa ${(buffer.length / 1024 / 1024).toFixed(1)} MB y el máximo son 2 MB.` };
  }

  if (tipoMime === "image/svg+xml") {
    const texto = buffer.toString("utf8");
    if (!pareceSvg(texto)) {
      return { error: "Ese archivo dice ser SVG pero no lo parece por dentro." };
    }
    buffer = Buffer.from(limpiarSvg(texto), "utf8");
  }

  return { buffer, extension };
}

/** Nombre de archivo seguro y único dentro del bucket. */
function rutaEnBucket(carpeta, nombre, extension) {
  const base = String(nombre || "recurso")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "recurso";
  return `${carpeta}/${Date.now()}-${base}.${extension}`;
}

/** Normaliza las palabras clave que llegan del formulario. */
function normalizarClaves(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || "").split(",");
  const vistas = new Set();
  const salida = [];
  for (const c of bruto) {
    const clave = String(c)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(clave);
    if (salida.length >= 25) break;
  }
  return salida;
}

module.exports = {
  TIPOS_ILUSTRACION,
  TIPOS_PLANTILLA,
  MAX_BYTES,
  limpiarSvg,
  pareceSvg,
  leerArchivoSubido,
  rutaEnBucket,
  normalizarClaves,
};
