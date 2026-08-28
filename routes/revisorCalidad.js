// revisorCalidad.js
// Capa de control de calidad para el material generado por EnseñAI.
// Se conecta a tu backend existente vía inyección de dependencia: le pasas
// tu función askClaude(systemPrompt, mensajeUsuario, maxTokens) ya construida
// (el mismo patrón que usas en tus otros agentes), y tu función generadora
// existente, sin necesidad de duplicar el cliente de Claude aquí.
//
// Filosofía: primero validaciones GRATIS (sin llamar a la API) — estructura
// y nivel de lectura — y solo si esas pasan, una segunda llamada BARATA a
// Claude actuando como revisor (no generador). Si algo falla, se regenera
// con instrucciones correctivas, hasta un máximo de intentos.

// ============================================================
// 1. VALIDACIÓN ESTRUCTURAL (gratis, sin IA — puramente mecánica)
// ============================================================

function validarEstructura(material, tipo) {
  const problemas = [];

  if (tipo === 'quiz' || tipo === 'trivia') {
    const preguntas = material.preguntas || [];
    if (preguntas.length === 0) {
      problemas.push('El quiz no tiene ninguna pregunta.');
    }
    preguntas.forEach((p, i) => {
      if (!p.opciones || p.opciones.length < 2) {
        problemas.push(`Pregunta ${i + 1}: tiene menos de 2 opciones.`);
        return;
      }
      const idx = p.respuestaCorrectaIndex;
      if (idx === undefined || idx === null || idx < 0 || idx >= p.opciones.length) {
        problemas.push(`Pregunta ${i + 1}: el índice de la respuesta correcta (${idx}) no existe entre las opciones.`);
      }
      // Detecta opciones duplicadas — señal de que la IA repitió texto por error
      const opcionesUnicas = new Set(p.opciones.map(o => o.trim().toLowerCase()));
      if (opcionesUnicas.size < p.opciones.length) {
        problemas.push(`Pregunta ${i + 1}: hay opciones de respuesta repetidas.`);
      }
    });
  }

  if (tipo === 'memorama') {
    const tarjetas = material.tarjetas || [];
    if (tarjetas.length % 2 !== 0) {
      problemas.push(`El memorama tiene ${tarjetas.length} tarjetas — debe ser un número par para que todas tengan pareja.`);
    }
    const grupos = {};
    tarjetas.forEach(t => {
      grupos[t.parejaId] = (grupos[t.parejaId] || 0) + 1;
    });
    Object.entries(grupos).forEach(([parejaId, count]) => {
      if (count !== 2) {
        problemas.push(`La pareja "${parejaId}" tiene ${count} tarjeta(s) en vez de 2.`);
      }
    });
  }

  if (tipo === 'resumen') {
    if (!material.texto || material.texto.trim().length < 20) {
      problemas.push('El resumen viene vacío o demasiado corto.');
    }
  }

  return { ok: problemas.length === 0, problemas };
}

// ============================================================
// 2. NIVEL DE LECTURA (gratis, sin IA — fórmula Fernández-Huerta,
//    la adaptación al español del índice de legibilidad de Flesch)
// ============================================================

function contarSilabas(palabra) {
  const vocales = palabra.toLowerCase().match(/[aeiouáéíóúü]+/g);
  return vocales ? vocales.length : 1;
}

function calcularNivelLectura(texto) {
  const oraciones = texto.split(/[.!?]+/).filter(o => o.trim().length > 0);
  const palabras = texto.split(/\s+/).filter(p => p.trim().length > 0);

  if (oraciones.length === 0 || palabras.length === 0) {
    return { score: null, mensaje: 'Texto insuficiente para calcular nivel de lectura.' };
  }

  const totalSilabas = palabras.reduce((sum, p) => sum + contarSilabas(p), 0);
  const silabasPorPalabra = totalSilabas / palabras.length;
  const palabrasPorOracion = palabras.length / oraciones.length;

  // Fórmula Fernández-Huerta: 206.84 - 60*(sílabas/palabra) - 1.02*(palabras/oración)
  // Más alto = más fácil de leer. Referencia: 90-100 muy fácil (niños), 0-30 muy difícil (universitario).
  const score = 206.84 - 60 * silabasPorPalabra - 1.02 * palabrasPorOracion;

  return { score: Math.round(score), silabasPorPalabra, palabrasPorOracion };
}

// Rangos esperados por edad — ajustables según lo que observes en producción
const NIVEL_ESPERADO_POR_EDAD = [
  { edadMax: 8, scoreMin: 85, etiqueta: 'muy fácil (niños pequeños)' },
  { edadMax: 12, scoreMin: 70, etiqueta: 'fácil (niños)' },
  { edadMax: 15, scoreMin: 55, etiqueta: 'medio (adolescentes)' },
  { edadMax: 999, scoreMin: 0, etiqueta: 'cualquier nivel (adultos)' },
];

function compararConEdad(scoreLectura, edadObjetivo) {
  if (scoreLectura === null) return { ok: true }; // no penalizar si no se pudo calcular
  const rango = NIVEL_ESPERADO_POR_EDAD.find(r => edadObjetivo <= r.edadMax);
  const ok = scoreLectura >= rango.scoreMin;
  return {
    ok,
    mensaje: ok
      ? null
      : `El texto salió con nivel de lectura ${scoreLectura} (${rango.etiqueta} esperaría ≥${rango.scoreMin}) — probablemente muy complejo para la edad objetivo (${edadObjetivo} años).`,
  };
}

// ============================================================
// 3. REVISIÓN CON IA — el "QA real" (una llamada barata a Claude
//    actuando como REVISOR, no como generador)
// ============================================================

async function revisarConIA(askClaude, material, contexto) {
  const systemPrompt = `Eres un revisor de calidad educativa, estricto pero justo.
Tu única tarea es encontrar problemas REALES en el siguiente material — no
opines sobre estilo ni hagas sugerencias de mejora, solo detecta errores.

Revisa específicamente:
1. Datos incorrectos o inventados (fechas, nombres, hechos científicos, etc.)
2. Preguntas de quiz donde ninguna opción sea realmente correcta, o donde
   más de una opción podría considerarse correcta (ambigüedad)
3. Contradicciones dentro del mismo texto
4. Contenido inapropiado para la edad objetivo (${contexto.edadObjetivo} años)

Si NO encuentras ningún problema, responde exactamente: OK

Si encuentras problemas, responde con una lista, una línea por problema,
cada línea empezando con "- ". No agregues explicaciones adicionales.`;

  const materialTexto = JSON.stringify(material, null, 2);
  const respuesta = await askClaude(systemPrompt, materialTexto, 400);

  const limpio = respuesta.trim();
  if (limpio.toUpperCase() === 'OK') {
    return { ok: true, problemas: [] };
  }

  const problemas = limpio
    .split('\n')
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(l => l.length > 0);

  return { ok: problemas.length === 0, problemas };
}

// ============================================================
// 4. ORQUESTADOR: verifica y, si hace falta, regenera con
//    instrucciones correctivas — hasta un máximo de intentos.
// ============================================================

/**
 * @param {Function} askClaude - tu función existente askClaude(systemPrompt, mensaje, maxTokens)
 * @param {Function} generarFn - tu función existente que genera el material.
 *   Firma esperada: async (temaOriginal, instruccionesCorrectivas) => material
 *   En la primera llamada, instruccionesCorrectivas viene vacío.
 * @param {string} temaOriginal - el tema/prompt original del usuario
 * @param {object} contexto - { tipo: 'quiz'|'memorama'|'resumen', edadObjetivo: number }
 * @param {number} maxIntentos - default 2 (1 intento inicial + 1 regeneración)
 */
async function verificarYCorregir(askClaude, generarFn, temaOriginal, contexto, maxIntentos = 2) {
  let material = null;
  let intentos = 0;
  let notas = [];

  while (intentos < maxIntentos) {
    intentos++;
    const instrucciones = notas.length > 0
      ? `El intento anterior tuvo estos problemas, corrígelos: ${notas.join('; ')}`
      : '';

    material = await generarFn(temaOriginal, instrucciones);
    notas = [];

    // Paso 1: estructura (gratis)
    const estructura = validarEstructura(material, contexto.tipo);
    if (!estructura.ok) notas.push(...estructura.problemas);

    // Paso 2: nivel de lectura (gratis) — solo si hay texto evaluable
    const textoParaLeer = material.texto || (material.preguntas || []).map(p => p.pregunta).join(' ');
    if (textoParaLeer) {
      const { score } = calcularNivelLectura(textoParaLeer);
      const comparacion = compararConEdad(score, contexto.edadObjetivo);
      if (!comparacion.ok) notas.push(comparacion.mensaje);
    }

    // Si ya hay problemas estructurales/de nivel, no gastamos la llamada de IA todavía —
    // vamos directo a regenerar (ahorra costo).
    if (notas.length > 0) continue;

    // Paso 3: revisión con IA — solo si lo anterior pasó limpio
    const revisionIA = await revisarConIA(askClaude, material, contexto);
    if (!revisionIA.ok) {
      notas.push(...revisionIA.problemas);
      continue;
    }

    // Todo pasó: material verificado
    return {
      material,
      calidad: { verificado: true, intentos, notas: [] },
    };
  }

  // Se acabaron los intentos y siguen quedando problemas —
  // se entrega igual (no bloquear al usuario), pero SIN el sello de verificado,
  // y con las notas para que tú puedas revisar manualmente el caso.
  return {
    material,
    calidad: { verificado: false, intentos, notas },
  };
}

module.exports = {
  validarEstructura,
  calcularNivelLectura,
  compararConEdad,
  revisarConIA,
  verificarYCorregir,
};
