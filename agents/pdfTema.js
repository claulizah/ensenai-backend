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
 * La fuente por defecto de pdfkit (Helvetica) usa codificación WinAnsi, que
 * NO incluye buena parte de los símbolos que aparecen en material de
 * matemáticas y ciencias. Cuando llega uno de esos, el PDF imprime basura:
 * "x − y = 1" salía como 'x " y = 1' porque el signo menos matemático
 * (U+2212) no es el guion normal. Es el mismo problema que antes tuvimos con
 * el círculo "○" de las opciones de trivia.
 *
 * En vez de parcharlo símbolo por símbolo cada vez que aparece uno nuevo, se
 * limpia TODO el contenido de una sola pasada antes de dibujar nada.
 */
const REEMPLAZOS = [
  [/[−‒–—―]/g, "-"],   // menos matemático y rayas largas
  [/[→⇒⟶]/g, " -> "],            // flechas a la derecha
  [/[←⇐⟵]/g, " <- "],            // flechas a la izquierda
  [/[↔⇔]/g, " <-> "],
  [/[✓✔]/g, "OK"],                    // palomitas
  [/[✗✘✕]/g, "X"],
  [/≠/g, " != "], [/≤/g, " <= "], [/≥/g, " >= "],
  [/≈/g, " ~ "], [/×/g, " x "], [/÷/g, " / "],
  [/√/g, "raiz "], [/∞/g, "infinito"], [/∑/g, "suma "], [/∫/g, "integral "],
  [/π/g, "pi "], [/α/g, "alfa "], [/β/g, "beta "], [/θ/g, "theta "],
  [/λ/g, "lambda "], [/μ/g, "mu "], [/Ω/g, "omega "], [/Δ/g, "delta "],
  [/[‘’‛]/g, "'"], [/[“”„]/g, '"'],
  [/…/g, "..."], [/·/g, "."], [/•/g, "-"],
  [/[    ]/g, " "],         // espacios raros
];

// Lo que WinAnsi sí puede imprimir arriba del rango Latin-1.
const EXTRAS_WINANSI = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));

function limpiarTexto(valor) {
  let t = String(valor);
  for (const [re, sub] of REEMPLAZOS) t = t.replace(re, sub);
  // Red de seguridad: cualquier símbolo que la fuente no pueda dibujar se
  // cambia por un espacio, en vez de salir como un glyph roto.
  t = t
    .split("")
    .map((ch) => (ch.codePointAt(0) < 256 || EXTRAS_WINANSI.has(ch) ? ch : " "))
    .join("");

  // Los reemplazos meten espacios de sobra ("x  !=  0"); se colapsan sin
  // tocar los saltos de línea, que sí importan en listas y esquemas.
  return t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n");
}

/** Aplica limpiarTexto a todos los strings del contenido, a cualquier profundidad. */
function limpiarContenido(valor) {
  if (typeof valor === "string") return limpiarTexto(valor);
  if (Array.isArray(valor)) return valor.map(limpiarContenido);
  if (valor && typeof valor === "object") {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = limpiarContenido(v);
    return salida;
  }
  return valor;
}

/**
 * Igual que en el frontend: los temas generados antes del rediseño traen
 * `resumen` como un string de texto corrido; los nuevos lo traen partido en
 * secciones. Esto deja todo en la forma nueva para poder imprimirlo igual.
 */
function normalizarResumen(resumen) {
  const vacio = { que_es: "", secciones: [], pasos: [], ideas_clave: [], ojo_aqui: "", truco: "" };
  if (!resumen) return vacio;
  if (typeof resumen === "string") return { ...vacio, que_es: resumen };
  return {
    que_es: resumen.que_es || "",
    secciones: Array.isArray(resumen.secciones) ? resumen.secciones.filter((s) => s && (s.titulo || s.texto)) : [],
    pasos: Array.isArray(resumen.pasos) ? resumen.pasos.filter(Boolean) : [],
    ideas_clave: Array.isArray(resumen.ideas_clave) ? resumen.ideas_clave.filter(Boolean) : [],
    ojo_aqui: resumen.ojo_aqui || "",
    truco: resumen.truco || "",
  };
}

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
 * `incluirRespuestas` (nuevo, para compartir con grupo/Modo Examen): cuando
 * es `false`, se omite por completo la "Hoja de respuestas" final — pensado
 * para que un maestro pueda generar un imprimible "en blanco" para repartir
 * al grupo, y otro "con respuestas" para su propio uso, del mismo material.
 * Todo lo demás del documento (portada, actividad, ejercicios, trivia sin
 * resolver, material extra) es idéntico en ambos casos.
 *
 * @param {object} contenido - el JSON que regresa generarMaterialTema()
 * @param {"individual"|"grupo"} modo
 * @param {object} [opciones]
 * @param {boolean} [opciones.incluirRespuestas=true] - si es false, no se
 * agrega la página final de "Hoja de respuestas".
 * @returns {Promise<string>} ruta local del PDF generado (temporal)
 */
function generarPdfTema(contenidoOriginal, modo = "individual", opciones = {}) {
  const incluirRespuestas = opciones.incluirRespuestas !== false;
  // Se limpia una sola vez, al entrar: de aquí para abajo todo el texto ya
  // es seguro de imprimir con la fuente del PDF (ver limpiarTexto arriba).
  const contenido = limpiarContenido(contenidoOriginal);

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

    // El resumen ahora viene partido en secciones (ver agents/generateTema.js).
    // Se imprime cada parte por separado — igual que en pantalla — porque un
    // bloque de texto corrido es justo lo que hacía que se perdiera la
    // atención. Los temas viejos traen `resumen` como string: en ese caso
    // `normalizarResumen` lo mete en `que_es` y sale como antes.
    const res = normalizarResumen(contenido.resumen);

    if (res.que_es) {
      tituloSeccion("De qué se trata");
      tarjeta(res.que_es, { colorFondo: HIELO, colorBorde: MENTA });
    }

    res.secciones.forEach((s) => {
      if (s.titulo) tituloSeccion(s.titulo, AZUL_PROFUNDO);
      if (s.texto) tarjeta(s.texto, { colorFondo: "#FFFFFF", colorBorde: LINEA });
    });

    if (res.pasos.length) {
      tituloSeccion("Paso a paso", AZUL_PROFUNDO);
      tarjeta(res.pasos.map((p, i) => `${i + 1}. ${p}`).join("\n"), { colorFondo: "#FFFFFF", colorBorde: LINEA });
    }

    if (res.ideas_clave.length) {
      tituloSeccion("Lo que no se te puede olvidar");
      tarjeta(res.ideas_clave.map((k) => `• ${k}`).join("\n"), { colorFondo: HIELO, colorBorde: LINEA });
    }

    if (res.ojo_aqui) {
      tituloSeccion("Ojo aquí", "#8A6100");
      tarjeta(res.ojo_aqui, { colorFondo: "#FFF7E6", colorBorde: "#FFDFA0" });
    }

    if (res.truco) {
      tituloSeccion("Truco para recordarlo", "#4B3BA8");
      tarjeta(res.truco, { colorFondo: "#F3F0FF", colorBorde: "#D9D2FF" });
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

    // --- Ejercicios (con espacio en blanco para resolver a mano) ---
    // Las soluciones NO van aquí: van en la hoja de respuestas del final,
    // para que la hoja del alumno se pueda repartir sin las respuestas.
    const ejercicios = contenido.ejercicios || [];
    if (ejercicios.length) {
      doc.addPage();
      tituloSeccion("Ejercicios", AZUL_PROFUNDO);
      doc
        .fillColor("#5b7d99")
        .fontSize(9.5)
        .font("Helvetica")
        .text("Resuelve cada uno en el espacio de abajo. Las soluciones vienen en la hoja de respuestas.", {
          width: contentWidth(),
        });
      salto(0.7);

      ejercicios.forEach((e, i) => {
        const x = doc.page.margins.left;
        const w = contentWidth();
        doc.font("Helvetica-Bold").fontSize(11);
        const altoEnunciado = doc.heightOfString(e.enunciado || "", { width: w - 46, lineGap: 2 });
        const altoPista = e.pista
          ? doc.font("Helvetica-Oblique").fontSize(9).heightOfString(`Pista: ${e.pista}`, { width: w - 46 }) + 6
          : 0;
        const espacioResolver = 68; // renglones en blanco para trabajar
        const alto = altoEnunciado + altoPista + espacioResolver + 26;
        asegurarEspacio(alto);
        const y = doc.y;

        doc.roundedRect(x, y, w, alto, 8).fillAndStroke("#FFFFFF", LINEA);

        // Número en círculo
        doc.circle(x + 20, y + 20, 10).fill(AZUL_PROFUNDO);
        doc
          .fillColor("#FFFFFF")
          .fontSize(9)
          .font("Helvetica-Bold")
          .text(String(i + 1), x + 12, y + 16, { width: 16, align: "center" });

        let cursorY = y + 12;
        doc
          .fillColor(TEXTO)
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(e.enunciado || "", x + 36, cursorY, { width: w - 46, lineGap: 2 });
        cursorY += altoEnunciado + 4;

        if (e.pista) {
          doc
            .fillColor("#8A6100")
            .fontSize(9)
            .font("Helvetica-Oblique")
            .text(`Pista: ${e.pista}`, x + 36, cursorY, { width: w - 46 });
          cursorY += altoPista;
        }

        // Renglones punteados para resolver
        cursorY += 8;
        doc.strokeColor("#E4EEF7").lineWidth(0.8);
        for (let r = 0; r < 4; r++) {
          const ly = cursorY + r * 15;
          doc.moveTo(x + 36, ly).lineTo(x + w - 14, ly).dash(2, { space: 3 }).stroke();
        }
        doc.undash().lineWidth(1);

        doc.y = y + alto;
        salto(0.5);
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
    // Se omite por completo cuando incluirRespuestas es false (imprimible
    // "en blanco" para repartir, ver docstring de generarPdfTema arriba).
    if (incluirRespuestas) {
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

      if (ejercicios.length) {
        tituloSeccion("Soluciones de los ejercicios", AZUL_PROFUNDO);
        ejercicios.forEach((e, i) => {
          asegurarEspacio(60);
          doc
            .fillColor(TEXTO)
            .fontSize(10.5)
            .font("Helvetica-Bold")
            .text(`${i + 1}. ${e.enunciado || ""}`, { width: contentWidth(), lineGap: 2 });
          (e.pasos || []).forEach((p) => {
            doc.fillColor("#4A6A85").fontSize(10).font("Helvetica").text(`    ${p}`, { width: contentWidth(), lineGap: 2 });
          });
          if (e.respuesta) {
            doc.fillColor(BOSQUE).fontSize(10.5).font("Helvetica-Bold").text(`    Respuesta: ${e.respuesta}`);
          }
          salto(0.45);
        });
        salto(0.5);
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
    }

    doc.end();

    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
  });
}

module.exports = { generarPdfTema };
