const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AZUL_PROFUNDO = "#1E3A8A";
const AZUL_OSCURO = "#16296B";
const CIELO = "#60A5FA";
const MENTA = "#34D399";
const AQUA = "#7DD3FC";
const BOSQUE = "#065F46";
const HIELO = "#F0FDF4";
const LINEA = "#DCEEFC";
const GRIS = "#4A6A85";
const TEXTO = "#1F2937";

const ETIQUETAS_INTELIGENCIA = {
  linguistica: "Lingüística",
  logico_matematica: "Lógico-matemática",
  espacial: "Espacial",
  musical: "Musical",
  kinestesica: "Corporal-kinestésica",
  interpersonal: "Interpersonal",
  intrapersonal: "Intrapersonal",
  naturalista: "Naturalista",
};

const LETRAS = ["A", "B", "C", "D", "E", "F"];

/**
 * Imprimible de un tema generado por agents/generateTema.js — reemplaza a
 * generarPdfEjercicios (agents/pdf.js, pensado solo para la lista simple
 * de {enunciado, respuesta} del flujo de video) para el flujo nuevo del
 * pivote: tema + nivel + perfil → resumen + esquema + actividad(es) +
 * trivia + material extra + respuestas.
 *
 * v2 (26 de agosto): rediseño visual completo para que se vea profesional
 * y consistente con la marca web (mismos colores/tono que las páginas
 * .html) — tarjetas con fondo suave en vez de texto plano, franja de marca
 * en la portada, y casillas de opción DIBUJADAS con vectores (doc.rect) en
 * vez de un carácter "○" de texto — ese carácter no existe en la fuente
 * base de pdfkit (WinAnsi) y se imprimía como un símbolo roto ("%Ë").
 * Dibujar la casilla a mano evita depender de qué glifos tenga la fuente.
 *
 * Estructura del PDF: portada (resumen + esquema visual) → actividad(es)
 * → trivia (con casillas para responder a mano, sin las respuestas) →
 * material extra → última página aparte con la "Hoja de respuestas"
 * (mismo patrón que agents/pdf.js: para que el papá/mamá/maestro revise
 * sin que el estudiante la vea mientras resuelve).
 *
 * @param {object} contenido - el JSON que regresa generarMaterialTema()
 * @param {"individual"|"grupo"} modo
 * @returns {Promise<string>} ruta local del PDF generado (temporal)
 */
function generarPdfTema(contenido, modo = "individual") {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(os.tmpdir(), `tema-${Date.now()}.pdf`);
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const pageBottom = () => doc.page.height - doc.page.margins.bottom;
    const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const salto = (h = 1) => doc.moveDown(h);

    // Evita que una tarjeta quede partida entre dos páginas — si no cabe
    // el alto estimado antes del margen inferior, salta de página primero.
    function asegurarEspacio(alto) {
      if (doc.y + alto > pageBottom()) doc.addPage();
    }

    function tituloSeccion(texto, color = BOSQUE) {
      const x = doc.page.margins.left;
      doc.rect(x, doc.y, 4, 18).fill(color);
      doc
        .fillColor(color)
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(texto, x + 12, doc.y + 1);
      salto(0.6);
    }

    // Tarjeta con fondo suave — mide el alto del texto antes de dibujar el
    // rectángulo, así el fondo siempre encierra bien el contenido.
    function tarjeta(texto, opts = {}) {
      const { fuente = "Helvetica", tam = 11, colorTexto = TEXTO, colorFondo = "#FFFFFF", colorBorde = LINEA, padding = 12 } = opts;
      const x = doc.page.margins.left;
      const w = contentWidth();
      doc.font(fuente).fontSize(tam);
      const alto = doc.heightOfString(texto, { width: w - padding * 2, lineGap: 3 }) + padding * 2;
      asegurarEspacio(alto + 4);
      const y = doc.y;
      doc.roundedRect(x, y, w, alto, 8).fillAndStroke(colorFondo, colorBorde);
      doc
        .fillColor(colorTexto)
        .font(fuente)
        .fontSize(tam)
        .text(texto, x + padding, y + padding, { width: w - padding * 2, lineGap: 3 });
      doc.y = y + alto;
      salto(0.6);
    }

    // Casilla de opción dibujada a mano (cuadro + letra) — nunca depende
    // de que la fuente tenga un glifo de "bullet" u "○".
    function filaOpcion(letra, texto, y) {
      const x = doc.page.margins.left;
      const w = contentWidth();
      doc.font("Helvetica").fontSize(10.5);
      const alturaCaja = Math.max(24, doc.heightOfString(texto, { width: w - 60 }) + 14);
      doc.roundedRect(x, y, w, alturaCaja, 6).lineWidth(1).strokeColor(LINEA).stroke();
      // casilla cuadrada para marcar a mano
      const cajaLado = 12;
      const cajaY = y + (alturaCaja - cajaLado) / 2;
      doc.rect(x + 12, cajaY, cajaLado, cajaLado).lineWidth(1).strokeColor("#94A3B8").stroke();
      doc
        .fillColor(AZUL_PROFUNDO)
        .fontSize(10.5)
        .font("Helvetica-Bold")
        .text(`${letra})`, x + 34, y + (alturaCaja - 12) / 2 - 1, { continued: false });
      doc
        .fillColor(TEXTO)
        .fontSize(10.5)
        .font("Helvetica")
        .text(texto, x + 58, y + (alturaCaja - 12) / 2 - 1, { width: w - 70 });
      return alturaCaja;
    }

    // --- Franja de marca + portada ---
    doc.rect(0, 0, doc.page.width, 64).fill(AZUL_PROFUNDO);
    doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold").text("EnseñAI", doc.page.margins.left, 22);
    doc
      .fillColor(AQUA)
      .fontSize(9)
      .font("Helvetica")
      .text("Material educativo generado con IA", doc.page.margins.left, 44);
    doc.y = 88;

    doc.fillColor(TEXTO).fontSize(19).font("Helvetica-Bold").text(contenido.tema || "Tema", doc.page.margins.left, doc.y, { width: contentWidth() });
    salto(0.8);

    if (contenido.resumen) {
      tituloSeccion("Resumen");
      tarjeta(contenido.resumen, { colorFondo: HIELO, colorBorde: LINEA });
    }

    if (contenido.esquema_visual) {
      tituloSeccion("Esquema visual");
      tarjeta(contenido.esquema_visual, { fuente: "Courier", tam: 10, colorFondo: "#FFFFFF", colorBorde: LINEA });
    }

    // --- Actividad(es) ---
    const actividades = contenido.actividades || (contenido.actividad ? [contenido.actividad] : []);
    if (actividades.length) {
      doc.addPage();
      tituloSeccion(modo === "grupo" ? "Actividades — una por cada tipo de inteligencia" : "Actividad", AZUL_PROFUNDO);
      salto(0.2);
      actividades.forEach((a) => {
        const x = doc.page.margins.left;
        const w = contentWidth();
        let etiqueta = "";
        if (a.inteligencia) etiqueta = (ETIQUETAS_INTELIGENCIA[a.inteligencia] || a.inteligencia).toUpperCase();

        doc.font("Helvetica-Bold").fontSize(12);
        const altoTitulo = doc.heightOfString(a.titulo || "", { width: w - 24 });
        doc.font("Helvetica").fontSize(10.5);
        const altoInstrucciones = doc.heightOfString(a.instrucciones || "", { width: w - 24, lineGap: 3 });
        const altoEtiqueta = etiqueta ? 20 : 0;
        const alto = altoEtiqueta + altoTitulo + altoInstrucciones + 30;
        asegurarEspacio(alto);
        const y = doc.y;
        doc.roundedRect(x, y, w, alto, 8).fillAndStroke(HIELO, LINEA);

        let cursorY = y + 12;
        if (etiqueta) {
          const anchoEtiqueta = doc.font("Helvetica-Bold").fontSize(8).widthOfString(etiqueta) + 16;
          doc.roundedRect(x + 12, cursorY, anchoEtiqueta, 15, 7).fill(MENTA);
          doc.fillColor("#FFFFFF").fontSize(8).font("Helvetica-Bold").text(etiqueta, x + 20, cursorY + 4);
          cursorY += 22;
        }
        doc
          .fillColor(TEXTO)
          .fontSize(12)
          .font("Helvetica-Bold")
          .text(a.titulo || "", x + 12, cursorY, { width: w - 24 });
        cursorY += altoTitulo + 6;
        doc
          .fillColor(TEXTO)
          .fontSize(10.5)
          .font("Helvetica")
          .text(a.instrucciones || "", x + 12, cursorY, { width: w - 24, lineGap: 3 });

        doc.y = y + alto;
        salto(0.6);
      });
    }

    // --- Trivia (con casillas para marcar a mano, sin respuestas) ---
    if (contenido.trivia?.length) {
      doc.addPage();
      tituloSeccion("Trivia", BOSQUE);
      salto(0.2);
      contenido.trivia.forEach((p, i) => {
        asegurarEspacio(40);
        const x = doc.page.margins.left;
        const w = contentWidth();
        doc.fillColor(AZUL_PROFUNDO).fontSize(11).font("Helvetica-Bold");
        const numeroLado = 20;
        const yPregunta = doc.y;
        doc.circle(x + numeroLado / 2, yPregunta + numeroLado / 2, numeroLado / 2).fill(AZUL_PROFUNDO);
        doc.fillColor("#FFFFFF").fontSize(10).font("Helvetica-Bold").text(String(i + 1), x, yPregunta + 5, { width: numeroLado, align: "center" });
        doc
          .fillColor(TEXTO)
          .fontSize(11.5)
          .font("Helvetica-Bold")
          .text(p.pregunta || "", x + numeroLado + 10, yPregunta + 2, { width: w - numeroLado - 10 });
        doc.y = Math.max(doc.y, yPregunta + numeroLado) + 8;

        if (p.opciones?.length) {
          p.opciones.forEach((op, oi) => {
            asegurarEspacio(30);
            const y = doc.y;
            const h = filaOpcion(LETRAS[oi] || String(oi + 1), op, y);
            doc.y = y + h + 6;
          });
        } else {
          asegurarEspacio(30);
          doc
            .strokeColor(LINEA)
            .lineWidth(1)
            .moveTo(x, doc.y + 20)
            .lineTo(x + w, doc.y + 20)
            .stroke();
          salto(1.8);
        }
        salto(0.5);
      });
    }

    // --- Material extra ---
    if (contenido.material_extra?.length) {
      doc.addPage();
      tituloSeccion("Material extra", AZUL_PROFUNDO);
      salto(0.2);
      contenido.material_extra.forEach((m) => {
        const x = doc.page.margins.left;
        const w = contentWidth();
        const etiqueta = (m.tipo || "").toUpperCase();
        doc.font("Helvetica").fontSize(10.5);
        const altoTexto = doc.heightOfString(m.contenido || "", { width: w - 24, lineGap: 3 });
        const alto = altoTexto + 40;
        asegurarEspacio(alto);
        const y = doc.y;
        doc
          .roundedRect(x, y, w, alto, 8)
          .lineWidth(1.2)
          .dash(4, { space: 3 })
          .strokeColor(AQUA)
          .stroke();
        doc.undash();
        doc
          .fillColor(AZUL_PROFUNDO)
          .fontSize(10.5)
          .font("Helvetica-Bold")
          .text(etiqueta, x + 12, y + 12);
        doc
          .fillColor(TEXTO)
          .fontSize(10.5)
          .font("Helvetica")
          .text(m.contenido || "", x + 12, y + 30, { width: w - 24, lineGap: 3 });
        doc.y = y + alto;
        salto(0.6);
      });
    }

    // --- Hoja de respuestas, en una página nueva y al final ---
    const r = contenido.respuestas || {};
    doc.addPage();
    doc.rect(0, 0, doc.page.width, 56).fill(BOSQUE);
    doc.fillColor("#FFFFFF").fontSize(17).font("Helvetica-Bold").text("Hoja de respuestas", doc.page.margins.left, 18);
    doc.y = 76;
    doc
      .fillColor(GRIS)
      .fontSize(9.5)
      .font("Helvetica-Oblique")
      .text("Para el papá, la mamá, o el profesional — revisa aquí sin que el estudiante la vea mientras resuelve.");
    salto(1);

    if (r.trivia_resuelta?.length) {
      tituloSeccion("Trivia resuelta");
      r.trivia_resuelta.forEach((rt) => {
        doc
          .fillColor(TEXTO)
          .fontSize(10.5)
          .font("Helvetica-Bold")
          .text(`${rt.pregunta} `, doc.page.margins.left, doc.y, { continued: true, width: contentWidth() })
          .font("Helvetica")
          .fillColor(BOSQUE)
          .text(`— ${rt.respuesta}`);
        salto(0.2);
      });
      salto(0.6);
    }

    if (r.solucion_actividad) {
      tituloSeccion("Solución de la actividad");
      doc.fillColor(TEXTO).fontSize(10.5).font("Helvetica").text(r.solucion_actividad, { lineGap: 3 });
      salto(0.8);
    }

    if (r.conceptos_clave?.length) {
      tituloSeccion("Conceptos clave");
      r.conceptos_clave.forEach((k) => doc.fillColor(TEXTO).fontSize(10.5).font("Helvetica").text(`•  ${k}`));
      salto(0.8);
    }

    if (r.autoevaluacion) {
      tituloSeccion("Autoevaluación");
      doc.fillColor(TEXTO).fontSize(10.5).font("Helvetica").text(r.autoevaluacion, { lineGap: 3 });
    }

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generarPdfTema };
