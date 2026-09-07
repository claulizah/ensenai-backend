/**
 * Arma un paquete vendible a partir de hojas que ya están en la
 * biblioteca (7-sep-2026).
 *
 * Un paquete = portada + las hojas + página de términos de uso, todo en
 * UN solo PDF, que es lo que se sube a Etsy / TPT / la tienda propia.
 *
 * Decisión de fondo: se hace TODO con pdf-lib, sin rasterizar. Render no
 * trae poppler ni ImageMagick (misma razón por la que utils/marcaAgua.js
 * escribe encima en vez de convertir a imagen), así que las hojas se
 * copian tal cual y la portada se dibuja con vectores y texto. Ventaja
 * extra: el PDF que compra la maestra sigue siendo nítido a cualquier
 * zoom y pesa lo mismo que las hojas originales.
 *
 * Lo único que sí necesita rasterizar es la FOTO del anuncio (miniaturas
 * de las páginas), y eso se hace en el navegador del admin con pdf.js
 * sobre un canvas — el mismo camino que ya se usó para homologar
 * imágenes, por la misma razón.
 */

const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

// Colores de marca (kit de Canva, 4-sep-2026).
const AZUL = rgb(0x1e / 255, 0x3a / 255, 0x8a / 255);
const AZUL_OSCURO = rgb(0x16 / 255, 0x29 / 255, 0x6b / 255);
const CIELO = rgb(0x60 / 255, 0xa5 / 255, 0xfa / 255);
const CORAL = rgb(0xf9 / 255, 0x70 / 255, 0x66 / 255);
const MENTA = rgb(0x34 / 255, 0xd3 / 255, 0x99 / 255);
const HIELO = rgb(0xf0 / 255, 0xfd / 255, 0xf4 / 255);
const GRIS = rgb(0.42, 0.5, 0.58);
const BLANCO = rgb(1, 1, 1);

// Carta, que es el tamaño en que quedaron homologadas las 230 hojas.
const CARTA = [612, 792];

const MAX_HOJAS = 60; // un paquete más grande que esto nadie lo imprime
const MAX_BYTES_HOJA = 8 * 1024 * 1024;

/**
 * Parte un texto en renglones que caben en `ancho`, midiendo de verdad
 * con la fuente (no contando caracteres, que falla feo con mayúsculas).
 */
function enRenglones(texto, fuente, tamaño, ancho) {
  const palabras = String(texto || "").split(/\s+/).filter(Boolean);
  const renglones = [];
  let actual = "";
  for (const palabra of palabras) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(prueba, tamaño) <= ancho) {
      actual = prueba;
    } else {
      if (actual) renglones.push(actual);
      actual = palabra;
    }
  }
  if (actual) renglones.push(actual);
  return renglones;
}

/** Centra un texto horizontalmente en la página. */
function centrado(pagina, texto, { fuente, tamaño, y, color }) {
  const ancho = fuente.widthOfTextAtSize(texto, tamaño);
  pagina.drawText(texto, {
    x: (pagina.getWidth() - ancho) / 2,
    y,
    size: tamaño,
    font: fuente,
    color,
  });
}

/**
 * pdf-lib usa WinAnsi en las fuentes estándar: acentos y ñ sí pasan,
 * pero un emoji o una comilla tipográfica revientan el dibujo con un
 * error que no dice nada útil. Se limpian antes en vez de reventar.
 */
function soloWinAnsi(texto) {
  return String(texto == null ? "" : texto)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Fuera todo lo que no sea Latin-1 (emojis incluidos).
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "")
    .trim();
}

/**
 * Dibuja la portada. Sin foto: bandas de color, el título grande y el
 * conteo de hojas. Es la página que se ve primero al abrir el PDF, no la
 * foto del anuncio (esa se arma aparte, en el navegador).
 */
async function dibujarPortada(pdf, { titulo, subtitulo, hojas, nivel }, fuentes) {
  const pagina = pdf.addPage(CARTA);
  const { width: W, height: H } = pagina.getSize();

  pagina.drawRectangle({ x: 0, y: 0, width: W, height: H, color: HIELO });
  // Banda superior azul con el nombre de la marca.
  pagina.drawRectangle({ x: 0, y: H - 132, width: W, height: 132, color: AZUL });
  // Tres acentos de color, para que no se vea como un documento de oficina.
  pagina.drawRectangle({ x: 0, y: H - 140, width: W / 3, height: 8, color: CIELO });
  pagina.drawRectangle({ x: W / 3, y: H - 140, width: W / 3, height: 8, color: MENTA });
  pagina.drawRectangle({ x: (2 * W) / 3, y: H - 140, width: W / 3, height: 8, color: CORAL });

  centrado(pagina, "EnseñAI", { fuente: fuentes.bold, tamaño: 30, y: H - 78, color: BLANCO });
  centrado(pagina, "ensenai.com", { fuente: fuentes.normal, tamaño: 11, y: H - 100, color: CIELO });

  // El bloque central se MIDE antes de dibujarlo y se centra entre la
  // banda de arriba y el pie. Dibujarlo desde una `y` fija dejaba media
  // portada vacía cuando el título era corto y no traía subtítulo — se
  // veía sin terminar. Medir primero cuesta unas líneas y hace que
  // cualquier combinación de título, subtítulo y nivel quede compuesta.
  let tamaño = 34;
  let renglones = enRenglones(titulo, fuentes.bold, tamaño, W - 120);
  while (renglones.length > 3 && tamaño > 18) {
    tamaño -= 2;
    renglones = enRenglones(titulo, fuentes.bold, tamaño, W - 120);
  }

  const renglonesSub = subtitulo
    ? enRenglones(subtitulo, fuentes.normal, 14, W - 150).slice(0, 3)
    : [];
  const etiqueta = `${hojas} ${hojas === 1 ? "hoja para imprimir" : "hojas para imprimir"}`;
  const altoPastilla = 40;

  const alto =
    renglones.length * (tamaño + 10) +
    (renglonesSub.length ? 12 + renglonesSub.length * 20 : 0) +
    34 + 3 + 28 +          // aire + línea de acento + aire
    altoPastilla +
    (nivel ? 12 + 14 : 0);

  // Espacio útil: entre el borde inferior de la banda y el borde superior
  // del pie.
  const topeArriba = H - 140;
  const topeAbajo = 46;
  let y = topeAbajo + (topeArriba - topeAbajo + alto) / 2 - tamaño;

  for (const renglon of renglones) {
    centrado(pagina, renglon, { fuente: fuentes.bold, tamaño, y, color: AZUL_OSCURO });
    y -= tamaño + 10;
  }

  if (renglonesSub.length) {
    y -= 12;
    for (const renglon of renglonesSub) {
      centrado(pagina, renglon, { fuente: fuentes.normal, tamaño: 14, y, color: GRIS });
      y -= 20;
    }
  }

  y -= 34;
  // Línea corta de acento, para cerrar el bloque de texto.
  pagina.drawRectangle({ x: (W - 90) / 2, y: y + 14, width: 90, height: 3, color: CIELO });
  y -= 28;

  // Pastilla con el conteo — es el dato que la compradora busca primero.
  const anchoTexto = fuentes.bold.widthOfTextAtSize(etiqueta, 14);
  const anchoPastilla = anchoTexto + 48;
  pagina.drawRectangle({
    x: (W - anchoPastilla) / 2,
    y: y - altoPastilla + 12,
    width: anchoPastilla,
    height: altoPastilla,
    color: CORAL,
    // pdf-lib no tiene esquinas redondeadas; el rectángulo plano en coral
    // se ve intencional, no inacabado.
  });
  centrado(pagina, etiqueta, { fuente: fuentes.bold, tamaño: 14, y: y - altoPastilla / 2 + 7, color: BLANCO });
  y -= altoPastilla + 12;

  if (nivel) {
    centrado(pagina, soloWinAnsi(nivel), { fuente: fuentes.normal, tamaño: 12, y, color: GRIS });
  }

  pagina.drawRectangle({ x: 0, y: 0, width: W, height: 46, color: AZUL });
  centrado(pagina, "Material original de EnseñAI - uso personal y de aula", {
    fuente: fuentes.normal,
    tamaño: 10,
    y: 18,
    color: CIELO,
  });

  return pagina;
}

/**
 * Página de términos de uso. Va SIEMPRE, en todos los paquetes: es lo
 * que distingue "compré una hoja" de "compré el derecho a revenderla",
 * y en las plataformas de material educativo se da por hecho que existe.
 */
function dibujarTerminos(pdf, { titulo }, fuentes) {
  const pagina = pdf.addPage(CARTA);
  const { width: W, height: H } = pagina.getSize();

  pagina.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: AZUL });
  centrado(pagina, "Términos de uso", { fuente: fuentes.bold, tamaño: 22, y: H - 55, color: BLANCO });

  const bloques = [
    ["Sí puedes", MENTA, [
      "Imprimir estas hojas las veces que quieras para tus propios alumnos o hijos.",
      "Usarlas en tu salón, en tu consultorio o en casa.",
      "Compartirlas impresas con las familias de tu grupo.",
    ]],
    ["No puedes", CORAL, [
      "Revender, regalar o compartir el archivo digital.",
      "Subirlo a un sitio, grupo o nube de acceso público.",
      "Quitarle la marca de EnseñAI o presentarlo como propio.",
      "Usarlo para armar otro producto que vayas a vender.",
    ]],
  ];

  let y = H - 140;
  for (const [encabezado, color, puntos] of bloques) {
    pagina.drawRectangle({ x: 60, y: y - 4, width: 6, height: 20, color });
    pagina.drawText(encabezado, { x: 76, y, size: 15, font: fuentes.bold, color: AZUL_OSCURO });
    y -= 28;
    for (const punto of puntos) {
      for (const renglon of enRenglones(punto, fuentes.normal, 11.5, W - 160)) {
        pagina.drawText(renglon, { x: 78, y, size: 11.5, font: fuentes.normal, color: GRIS });
        y -= 17;
      }
      y -= 4;
    }
    y -= 18;
  }

  y -= 6;
  const cierre =
    "Si compraste esto para tu escuela y varias maestras lo van a usar, escríbeme a " +
    "contacto@ensenai.com y te paso una licencia para todo el plantel. Cuesta menos que " +
    "comprarlo varias veces.";
  for (const renglon of enRenglones(cierre, fuentes.normal, 11, W - 160)) {
    pagina.drawText(renglon, { x: 78, y, size: 11, font: fuentes.normal, color: AZUL });
    y -= 16;
  }

  pagina.drawText(soloWinAnsi(titulo), { x: 60, y: 60, size: 9, font: fuentes.normal, color: GRIS });
  pagina.drawRectangle({ x: 0, y: 0, width: W, height: 40, color: AZUL });
  centrado(pagina, "EnseñAI - ensenai.com", { fuente: fuentes.normal, tamaño: 10, y: 15, color: CIELO });

  return pagina;
}

/**
 * Arma el paquete completo.
 *
 * @param {Array<{nombre:string, bytes:Buffer|Uint8Array}>} hojas - ya descargadas
 * @param {{titulo:string, subtitulo?:string, nivel?:string}} datos
 * @returns {Promise<{bytes:Uint8Array, paginas:number, hojasUsadas:number, avisos:string[]}>}
 */
async function armarPaquete(hojas, datos) {
  if (!Array.isArray(hojas) || hojas.length === 0) {
    throw new Error("Elige al menos una hoja para armar el paquete.");
  }
  if (hojas.length > MAX_HOJAS) {
    throw new Error(`Son ${hojas.length} hojas y el tope es ${MAX_HOJAS}. Arma dos paquetes.`);
  }

  const titulo = soloWinAnsi(datos.titulo) || "Paquete de hojas para imprimir";
  const avisos = [];

  const pdf = await PDFDocument.create();
  pdf.setTitle(titulo);
  pdf.setAuthor("EnseñAI");
  pdf.setCreator("EnseñAI - ensenai.com");
  pdf.setSubject(soloWinAnsi(datos.subtitulo || ""));

  const fuentes = {
    normal: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // Se cuentan las páginas ANTES de dibujar la portada, porque el conteo
  // va impreso en ella. Una hoja rota no debe abortar el paquete entero:
  // se anota y se sigue, igual que la marca de agua.
  const copiables = [];
  for (const hoja of hojas) {
    try {
      if (!hoja.bytes || hoja.bytes.length === 0) throw new Error("llegó vacía");
      if (hoja.bytes.length > MAX_BYTES_HOJA) throw new Error("pesa demasiado");
      const doc = await PDFDocument.load(hoja.bytes, { ignoreEncryption: true });
      copiables.push({ nombre: hoja.nombre, doc, paginas: doc.getPageCount() });
    } catch (err) {
      avisos.push(`Se saltó "${hoja.nombre}": ${err.message}`);
    }
  }

  if (copiables.length === 0) {
    throw new Error("Ninguna de las hojas se pudo leer. Revisa que sigan en la biblioteca.");
  }

  const totalPaginas = copiables.reduce((n, c) => n + c.paginas, 0);

  await dibujarPortada(pdf, { ...datos, titulo, hojas: totalPaginas }, fuentes);

  for (const copiable of copiables) {
    const indices = copiable.doc.getPageIndices();
    const paginas = await pdf.copyPages(copiable.doc, indices);
    paginas.forEach((p) => pdf.addPage(p));
  }

  dibujarTerminos(pdf, { titulo }, fuentes);

  const bytes = await pdf.save();
  return {
    bytes,
    paginas: pdf.getPageCount(),
    hojasUsadas: copiables.length,
    avisos,
  };
}

module.exports = { armarPaquete, MAX_HOJAS, soloWinAnsi };
