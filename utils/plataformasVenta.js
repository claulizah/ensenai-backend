/**
 * Reglas de cada plataforma donde vende sus paquetes (7-sep-2026).
 *
 * Todo lo que cambia entre Etsy, Teachers Pay Teachers y una tienda
 * propia son DATOS, no código: límites de título, cuántas etiquetas
 * caben y de qué largo, en qué idioma se escriben, y qué forma tiene la
 * foto del anuncio. Agregar una plataforma nueva es agregar un objeto
 * aquí — ni el armador de PDF ni el agente de textos se enteran.
 *
 * Los números salen de las reglas publicadas de cada plataforma, y los
 * de Etsy además de haber armado a mano sus 9 primeros paquetes.
 */

const PLATAFORMAS = {
  etsy: {
    id: "etsy",
    nombre: "Etsy",
    // Etsy corta el título en los resultados mucho antes del máximo real
    // (140): lo que se ve en el celular son ~60 caracteres, así que lo
    // importante va al principio.
    maxTitulo: 140,
    idealTitulo: 70,
    maxDescripcion: 4000,
    etiquetas: { cuantas: 13, maxLargo: 20 },
    // Mezcla a propósito: el material es en español, pero quien compra en
    // Etsy busca en inglés aunque después imprima en español.
    idiomaEtiquetas: "mezcla",
    idiomaTextos: "es",
    foto: { ancho: 2000, alto: 2000, nombre: "cuadrada 2000×2000" },
    notas: "La primera foto es la que decide el clic. Etsy la recorta a cuadrado en la búsqueda.",
  },

  tpt: {
    id: "tpt",
    nombre: "Teachers Pay Teachers",
    maxTitulo: 100,
    idealTitulo: 60,
    maxDescripcion: 5000,
    // TPT no usa etiquetas libres como Etsy: usa "keywords" y su propio
    // árbol de materias/grados. Se generan igual, sirven de guía al
    // llenar el formulario.
    etiquetas: { cuantas: 8, maxLargo: 30 },
    idiomaEtiquetas: "en",
    idiomaTextos: "en",
    // La portada de TPT se ve como miniatura vertical en el listado.
    foto: { ancho: 1600, alto: 2070, nombre: "vertical 1600×2070" },
    notas:
      "Público de maestras bilingües en EE.UU. El título en inglés y la palabra 'Spanish' al frente pesan más que cualquier otra cosa.",
  },

  propia: {
    id: "propia",
    nombre: "Tienda propia (Gumroad, Payhip, tu sitio)",
    maxTitulo: 120,
    idealTitulo: 60,
    maxDescripcion: 6000,
    etiquetas: { cuantas: 6, maxLargo: 30 },
    idiomaEtiquetas: "es",
    idiomaTextos: "es",
    foto: { ancho: 1600, alto: 1200, nombre: "horizontal 1600×1200" },
    notas:
      "Aquí no hay algoritmo que conquistar: quien llega ya venía de tu liga. La descripción puede ser más larga y más tuya.",
  },

  facebook: {
    id: "facebook",
    nombre: "Facebook / grupos de maestras",
    // En Facebook el "título" es el primer renglón del post: si no
    // engancha ahí, nadie le da a "ver más".
    maxTitulo: 80,
    idealTitulo: 50,
    maxDescripcion: 1200,
    etiquetas: { cuantas: 5, maxLargo: 25 },
    idiomaEtiquetas: "es",
    idiomaTextos: "es",
    foto: { ancho: 1200, alto: 1200, nombre: "cuadrada 1200×1200" },
    notas:
      "Texto corto y en español de México. Nada de inglés aquí: el público es el de tus grupos, no el de Etsy.",
  },
};

const PREDETERMINADA = "etsy";

/** Devuelve la plataforma pedida, o Etsy si el id no existe. */
function plataforma(id) {
  return PLATAFORMAS[String(id || "").toLowerCase()] || PLATAFORMAS[PREDETERMINADA];
}

/** Lista ligera para pintar el selector en el admin. */
function listaDePlataformas() {
  return Object.values(PLATAFORMAS).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    foto: p.foto,
    etiquetas: p.etiquetas,
    maxTitulo: p.maxTitulo,
    notas: p.notas,
  }));
}

module.exports = { PLATAFORMAS, plataforma, listaDePlataformas, PREDETERMINADA };
