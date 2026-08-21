const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AZUL_PROFUNDO = "#1E3A8A";
const BOSQUE = "#065F46";
const GRIS = "#4A6A85";

/**
 * Arma un PDF imprimible: portada con instrucciones + ejercicios (con
 * espacio para escribir la respuesta a mano), y una última página con
 * la "Hoja de respuestas" aparte — para que el papá/mamá/maestro pueda
 * revisar sin que el niño la vea mientras resuelve.
 *
 * @param {string} courseTitle
 * @param {Array<{enunciado: string, respuesta: string}>} ejercicios
 * @returns {Promise<string>} ruta local del PDF generado (temporal)
 */
function generarPdfEjercicios(courseTitle, ejercicios) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(os.tmpdir(), `ejercicios-${Date.now()}.pdf`);
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // --- Encabezado ---
    doc.fillColor(AZUL_PROFUNDO).fontSize(20).font("Helvetica-Bold").text("EnseñAI", { align: "left" });
    doc.moveDown(0.3);
    doc.fillColor("#000000").fontSize(16).text(courseTitle);
    doc.moveDown(0.2);
    doc
      .fillColor(GRIS)
      .fontSize(11)
      .font("Helvetica")
      .text("Resuelve estos ejercicios como el que viste en el video. ¡Tú puedes!");
    doc.moveDown(1);

    // --- Ejercicios, cada uno con espacio para escribir la respuesta ---
    ejercicios.forEach((ej, i) => {
      doc
        .fillColor("#000000")
        .fontSize(13)
        .font("Helvetica-Bold")
        .text(`${i + 1}. `, { continued: true })
        .font("Helvetica")
        .text(ej.enunciado);
      doc.moveDown(0.3);
      doc
        .strokeColor("#CCCCCC")
        .lineWidth(1)
        .moveTo(doc.x, doc.y + 20)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 20)
        .stroke();
      doc.moveDown(2);
    });

    // --- Hoja de respuestas, en una página nueva ---
    doc.addPage();
    doc.fillColor(BOSQUE).fontSize(18).font("Helvetica-Bold").text("Hoja de respuestas");
    doc
      .fillColor(GRIS)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("Para el papá, la mamá, o el maestro — revisa aquí sin que el niño la vea mientras resuelve.");
    doc.moveDown(1);

    ejercicios.forEach((ej, i) => {
      doc
        .fillColor("#000000")
        .fontSize(12)
        .font("Helvetica-Bold")
        .text(`${i + 1}. `, { continued: true })
        .font("Helvetica")
        .text(ej.respuesta);
      doc.moveDown(0.5);
    });

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generarPdfEjercicios };
