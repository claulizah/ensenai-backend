const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");

const AZUL_PROFUNDO = "#1E3A8A";
const BOSQUE = "#065F46";
const GRIS = "#4A6A85";

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

/**
 * Imprimible de un tema generado por agents/generateTema.js — reemplaza a
 * generarPdfEjercicios (agents/pdf.js, pensado solo para la lista simple
 * de {enunciado, respuesta} del flujo de video) para el flujo nuevo del
 * pivote: tema + nivel + perfil → resumen + esquema + actividad(es) +
 * trivia + material extra + respuestas.
 *
 * Estructura del PDF: portada (resumen + esquema visual) → actividad(es)
 * → trivia (con espacio para responder a mano, sin las respuestas) →
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

    const salto = (h = 1) => doc.moveDown(h);
    const titulo = (texto, color = AZUL_PROFUNDO, tam = 16) =>
      doc.fillColor(color).fontSize(tam).font("Helvetica-Bold").text(texto);
    const parrafo = (texto, opts = {}) =>
      doc.fillColor("#000000").fontSize(11).font("Helvetica").text(texto, { lineGap: 3, ...opts });

    // --- Portada: encabezado, resumen, esquema visual ---
    doc.fillColor(AZUL_PROFUNDO).fontSize(20).font("Helvetica-Bold").text("EnseñAI");
    salto(0.3);
    titulo(contenido.tema || "Tema", "#000000", 18);
    salto(0.5);

    if (contenido.resumen) {
      doc.fillColor(BOSQUE).fontSize(12).font("Helvetica-Bold").text("Resumen");
      salto(0.2);
      parrafo(contenido.resumen);
      salto(0.8);
    }

    if (contenido.esquema_visual) {
      doc.fillColor(BOSQUE).fontSize(12).font("Helvetica-Bold").text("Esquema visual");
      salto(0.2);
      doc.fillColor("#000000").fontSize(10.5).font("Courier").text(contenido.esquema_visual, { lineGap: 2 });
    }

    // --- Actividad(es) ---
    const actividades = contenido.actividades || (contenido.actividad ? [contenido.actividad] : []);
    if (actividades.length) {
      doc.addPage();
      titulo(modo === "grupo" ? "Actividades (una por cada tipo de inteligencia)" : "Actividad", BOSQUE, 15);
      salto(0.5);
      actividades.forEach((a, i) => {
        if (a.inteligencia) {
          doc
            .fillColor(AZUL_PROFUNDO)
            .fontSize(10)
            .font("Helvetica-Bold")
            .text((ETIQUETAS_INTELIGENCIA[a.inteligencia] || a.inteligencia).toUpperCase());
          salto(0.1);
        }
        doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text(a.titulo || "");
        salto(0.15);
        parrafo(a.instrucciones || "");
        if (i < actividades.length - 1) salto(0.8);
      });
    }

    // --- Trivia (con espacio para escribir, sin respuestas) ---
    if (contenido.trivia?.length) {
      doc.addPage();
      titulo("Trivia", BOSQUE, 15);
      salto(0.5);
      contenido.trivia.forEach((p, i) => {
        doc
          .fillColor("#000000")
          .fontSize(12)
          .font("Helvetica-Bold")
          .text(`${i + 1}. `, { continued: true })
          .font("Helvetica")
          .text(p.pregunta || "");
        salto(0.2);
        if (p.opciones?.length) {
          p.opciones.forEach((op) => {
            doc.fillColor("#000000").fontSize(10.5).font("Helvetica").text(`   ○  ${op}`);
          });
          salto(0.5);
        } else {
          doc
            .strokeColor("#CCCCCC")
            .lineWidth(1)
            .moveTo(doc.x, doc.y + 18)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y + 18)
            .stroke();
          salto(1.6);
        }
      });
    }

    // --- Material extra ---
    if (contenido.material_extra?.length) {
      doc.addPage();
      titulo("Material extra", BOSQUE, 15);
      salto(0.5);
      contenido.material_extra.forEach((m, i) => {
        doc
          .fillColor(AZUL_PROFUNDO)
          .fontSize(11)
          .font("Helvetica-Bold")
          .text((m.tipo || "").toUpperCase());
        salto(0.15);
        parrafo(m.contenido || "");
        if (i < contenido.material_extra.length - 1) salto(0.8);
      });
    }

    // --- Hoja de respuestas, en una página nueva y al final ---
    const r = contenido.respuestas || {};
    doc.addPage();
    doc.fillColor(BOSQUE).fontSize(18).font("Helvetica-Bold").text("Hoja de respuestas");
    doc
      .fillColor(GRIS)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("Para el papá, la mamá, o el profesional — revisa aquí sin que el estudiante la vea mientras resuelve.");
    salto(1);

    if (r.trivia_resuelta?.length) {
      doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text("Trivia resuelta");
      salto(0.2);
      r.trivia_resuelta.forEach((rt) => {
        doc
          .fillColor("#000000")
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(`${rt.pregunta} `, { continued: true })
          .font("Helvetica")
          .text(`— ${rt.respuesta}`);
      });
      salto(0.8);
    }

    if (r.solucion_actividad) {
      doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text("Solución de la actividad");
      salto(0.2);
      parrafo(r.solucion_actividad);
      salto(0.8);
    }

    if (r.conceptos_clave?.length) {
      doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text("Conceptos clave");
      salto(0.2);
      r.conceptos_clave.forEach((k) => doc.fillColor("#000000").fontSize(11).font("Helvetica").text(`•  ${k}`));
      salto(0.8);
    }

    if (r.autoevaluacion) {
      doc.fillColor("#000000").fontSize(12).font("Helvetica-Bold").text("Autoevaluación");
      salto(0.2);
      parrafo(r.autoevaluacion);
    }

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generarPdfTema };
