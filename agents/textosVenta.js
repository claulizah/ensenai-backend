/**
 * Escribe el título, la descripción y las etiquetas del anuncio
 * (7-sep-2026).
 *
 * Es el único paso del armador de paquetes que usa IA, y por la misma
 * razón que en el resto de la plataforma: aquí sí hace falta criterio.
 * Unir PDFs es código exacto; adivinar cómo busca una maestra de Texas
 * un cuadernillo de recortar en español, no.
 *
 * Usa Haiku, como describirPlantilla.js: es redacción corta con reglas
 * claras, no necesita el modelo grande. Costo aproximado por paquete:
 * $0.002 USD.
 *
 * Si falla, NO bloquea: routes/admin.js entrega el PDF igual y ella
 * escribe los textos a mano. El PDF es el producto; los textos son
 * ayuda.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { OPCIONES_CLIENTE } = require("../utils/reintento");
const { conReintento } = require("../utils/reintento");
const { plataforma } = require("../utils/plataformasVenta");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...OPCIONES_CLIENTE });

const MODELO = "claude-haiku-4-5-20251001";

function reglasDeIdioma(p) {
  if (p.idiomaTextos === "en") {
    return `Escribe el título y la descripción EN INGLÉS. El material en sí está en español,
así que la descripción debe decir claramente que las hojas son en español —
eso es una ventaja para quien lo busca, no un defecto que esconder.`;
  }
  return `Escribe el título y la descripción en ESPAÑOL DE MÉXICO, natural y directo.
Nada de "potencia el aprendizaje" ni frases de folleto corporativo.`;
}

function reglasDeEtiquetas(p) {
  const base = `Genera exactamente ${p.etiquetas.cuantas} etiquetas, cada una de máximo
${p.etiquetas.maxLargo} caracteres, en minúsculas, sin numerales ni comas.`;
  if (p.idiomaEtiquetas === "mezcla") {
    return `${base}
Mézclalas: aproximadamente la mitad en español y la mitad en inglés. Quien compra
en esta plataforma busca en inglés aunque después imprima material en español, así
que las etiquetas en inglés son las que traen tráfico y las de español a quien ya
sabe qué quiere. Incluye al menos una con "spanish".`;
  }
  if (p.idiomaEtiquetas === "en") return `${base}\nTodas en inglés.`;
  return `${base}\nTodas en español, sin inglés.`;
}

function construirPrompt(p) {
  return `Eres quien escribe los anuncios de EnseñAI, una marca mexicana de material
educativo imprimible hecho por una maestra. Vas a redactar el anuncio de UN paquete
de hojas para ${p.nombre}.

${reglasDeIdioma(p)}

TÍTULO
- Máximo ${p.maxTitulo} caracteres, pero apunta a ${p.idealTitulo}.
- Lo más importante va en las primeras palabras: en el celular se corta pronto.
- Di QUÉ es y PARA QUIÉN. Nada de signos de admiración ni MAYÚSCULAS gritadas.

DESCRIPCIÓN
- Máximo ${p.maxDescripcion} caracteres; entre 700 y 1400 es lo que se lee.
- Empieza por el problema que resuelve, no por el producto.
- Di cuántas hojas trae, que es tamaño carta, que se imprime en blanco y negro,
  y que es descarga inmediata en PDF.
- Incluye una línea de qué NO incluye (no es editable, no viene impreso y enviado).
- Cierra diciendo que es material original, no plantillas revendidas.
- Sin emojis. Sin promesas pedagógicas que no se puedan sostener.

ETIQUETAS
${reglasDeEtiquetas(p)}

PRECIO
- Sugiere un rango en dólares (o pesos si la plataforma es mexicana) basado en
  cuántas hojas trae y qué tan específico es el material.
- Es una referencia, no un dato: di en una frase de qué depende.

Contesta SOLO con este JSON, sin texto alrededor y sin bloques de código:
{
  "titulo": "...",
  "descripcion": "...",
  "etiquetas": ["...", "..."],
  "precio_sugerido": "...",
  "por_que_ese_precio": "..."
}`;
}

/** Quita ```json ... ``` si el modelo lo mete de todos modos. */
function limpiarJson(texto) {
  const t = String(texto || "").trim();
  const conBloque = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const crudo = conBloque ? conBloque[1] : t;
  const inicio = crudo.indexOf("{");
  const fin = crudo.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("La IA no contestó un JSON.");
  return JSON.parse(crudo.slice(inicio, fin + 1));
}

/** Recorta a lo que la plataforma acepta, por si el modelo se pasó. */
function ajustarALaPlataforma(datos, p) {
  const etiquetas = (Array.isArray(datos.etiquetas) ? datos.etiquetas : [])
    .map((e) => String(e).toLowerCase().replace(/[#,]/g, "").trim())
    .filter((e) => e && e.length <= p.etiquetas.maxLargo)
    .filter((e, i, todas) => todas.indexOf(e) === i)
    .slice(0, p.etiquetas.cuantas);

  return {
    titulo: String(datos.titulo || "").slice(0, p.maxTitulo).trim(),
    descripcion: String(datos.descripcion || "").slice(0, p.maxDescripcion).trim(),
    etiquetas,
    precio_sugerido: String(datos.precio_sugerido || "").slice(0, 120).trim(),
    por_que_ese_precio: String(datos.por_que_ese_precio || "").slice(0, 400).trim(),
    // Se avisa en vez de fallar: 11 etiquetas donde caben 13 sirven igual,
    // pero ella debe saber que quedaron huecos que puede llenar a mano.
    faltan_etiquetas: Math.max(0, p.etiquetas.cuantas - etiquetas.length),
  };
}

/**
 * @param {{nombre:string, categoria?:string, nivel?:string, descripcion?:string}[]} hojas
 * @param {{plataformaId?:string, nombrePaquete?:string, notas?:string}} opciones
 */
async function generarTextosVenta(hojas, opciones = {}) {
  const p = plataforma(opciones.plataformaId);

  // Se le manda el inventario real, no solo el nombre del paquete: los
  // nombres de las hojas son lo que de verdad describe el contenido.
  const inventario = (hojas || [])
    .slice(0, 60)
    .map((h, i) => {
      const partes = [h.nombre];
      if (h.nivel) partes.push(`nivel: ${h.nivel}`);
      if (h.categoria) partes.push(`categoría: ${h.categoria}`);
      if (h.descripcion) partes.push(String(h.descripcion).slice(0, 160));
      return `${i + 1}. ${partes.join(" | ")}`;
    })
    .join("\n");

  const mensaje = `Paquete: ${opciones.nombrePaquete || "(sin nombre todavía)"}
Total de hojas: ${(hojas || []).length}
${opciones.notas ? `Notas de la vendedora: ${opciones.notas}\n` : ""}
Las hojas que trae:
${inventario}`;

  const respuesta = await conReintento(
    () =>
      anthropic.messages.create({
        model: MODELO,
        max_tokens: 2000,
        system: construirPrompt(p),
        messages: [{ role: "user", content: mensaje }],
      }),
    { intentos: 3, etiqueta: "textosVenta", presupuestoMs: 90 * 1000 }
  );

  const texto = respuesta.content.find((b) => b.type === "text")?.text || "";
  return { plataforma: p.id, ...ajustarALaPlataforma(limpiarJson(texto), p) };
}

module.exports = { generarTextosVenta };
