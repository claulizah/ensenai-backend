/**
 * Marca de agua de EnseñAI para las plantillas (4-sep-2026).
 *
 * Pedido de Claudia: "el agente que revisa las páginas y las nombra podría
 * ayudarme a ponerles la marca de agua". Ojo con la palabra "agente": esto
 * NO lo hace la IA. Poner un sello en una esquina es trabajo de código, es
 * exacto y cuesta cero; pedírselo a un modelo sería caro, lento y menos
 * confiable. La IA sigue haciendo lo que sí necesita criterio: mirar la
 * hoja y ponerle nombre.
 *
 * Se usa pdf-lib porque escribe ENCIMA del PDF que ya existe, sin volver a
 * dibujar la página: no baja la calidad, no engorda el archivo y no
 * necesita rasterizar (Render no trae poppler ni ImageMagick).
 *
 * El sello es una pastilla blanca abajo a la derecha, con el pulpito y
 * "EnseñAI · ensenai.com". Se eligió la pastilla —y no una banda al pie—
 * porque funciona igual en una hoja blanca que en una tarjeta a color a
 * sangre, y aquí no se puede mirar el pixel para decidir cuál conviene.
 */

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const TEXTO = "EnseñAI · ensenai.com";
const AZUL = rgb(30 / 255, 58 / 255, 138 / 255);
const LOGO = path.join(__dirname, "..", "assets", "isotipo.png");

/** El pulpito, si está disponible. Sin él la marca se pone solo con texto. */
function leerLogo() {
  try {
    return fs.readFileSync(LOGO);
  } catch (err) {
    return null;
  }
}

/**
 * Pone la marca en TODAS las páginas de un PDF.
 * @returns {Promise<Buffer|null>} el PDF marcado, o null si no se pudo
 * (un archivo que no es PDF, uno protegido, uno corrupto). Nunca lanza:
 * si algo sale mal, la plantilla se sube sin marca en vez de no subirse.
 */
async function marcarPdf(buffer) {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const fuente = await pdf.embedFont(StandardFonts.HelveticaBold);

    let logo = null;
    const bytesLogo = leerLogo();
    if (bytesLogo) {
      try {
        logo = await pdf.embedPng(bytesLogo);
      } catch (err) {
        logo = null;
      }
    }

    for (const pagina of pdf.getPages()) {
      const { width: W, height: H } = pagina.getSize();

      const tam = Math.max(7, Math.min(9, H * 0.011));
      const anchoTexto = fuente.widthOfTextAtSize(TEXTO, tam);
      const altoLogo = logo ? tam * 1.5 : 0;
      const separacion = logo ? tam * 0.5 : 0;

      const padX = tam * 0.9;
      const padY = tam * 0.7;
      const anchoPastilla = anchoTexto + altoLogo + separacion + padX * 2;
      const altoPastilla = Math.max(tam, altoLogo) + padY * 2;

      const x = W - anchoPastilla - W * 0.04;
      const y = H * 0.022;

      // Pastilla blanca semi-opaca: se ve sobre fondo de color sin taparlo.
      pagina.drawRectangle({
        x,
        y,
        width: anchoPastilla,
        height: altoPastilla,
        color: rgb(1, 1, 1),
        opacity: 0.92,
        borderColor: rgb(0.86, 0.93, 0.99),
        borderWidth: 0.6,
        borderOpacity: 0.9,
      });

      if (logo) {
        pagina.drawImage(logo, {
          x: x + padX,
          y: y + (altoPastilla - altoLogo) / 2,
          width: altoLogo,
          height: altoLogo,
        });
      }

      pagina.drawText(TEXTO, {
        x: x + padX + altoLogo + separacion,
        y: y + (altoPastilla - tam) / 2 + tam * 0.22,
        size: tam,
        font: fuente,
        color: AZUL,
      });
    }

    return Buffer.from(await pdf.save());
  } catch (err) {
    return null;
  }
}

/**
 * Marca lo que se pueda. Hoy solo PDF: una imagen suelta se guarda tal
 * cual y se avisa, en vez de fingir que quedó marcada.
 */
async function ponerMarca(buffer, tipoMime) {
  if (tipoMime !== "application/pdf") {
    return { buffer, marcada: false, motivo: "solo se le pone marca a los PDF" };
  }
  const marcado = await marcarPdf(buffer);
  if (!marcado) return { buffer, marcada: false, motivo: "no se pudo abrir el PDF" };
  return { buffer: marcado, marcada: true, motivo: null };
}

module.exports = { ponerMarca, marcarPdf, TEXTO };
