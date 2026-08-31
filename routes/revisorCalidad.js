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

function validarEstructura(material, tipo, modo = 'individual', enfoque = 'estudio') {
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
    if (tarjetas.length === 0) {
      problemas.push('El memorama no tiene ninguna tarjeta.');
    } else if (tarjetas.length % 2 !== 0) {
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

  // 'material_tema' es la forma real que produce agents/generateTema.js
  // (resumen por secciones, diagrama, actividad(es), ejercicios, trivia,
  // material_extra, respuestas) — distinta de los tipos simples de arriba,
  // que quedaron para material tipo quiz/memorama/resumen plano.
  if (tipo === 'material_tema') {
    problemas.push(...validarEstructuraMaterialTema(material, modo, enfoque));
  }

  return { ok: problemas.length === 0, problemas };
}

// El modo ('individual' | 'grupo') decide si se valida `actividad` (un solo
// objeto) o `actividades` (arreglo de 8, una por inteligencia) — es el
// tercer parámetro opcional de validarEstructura de arriba, así no se rompe
// la firma original (material, tipo) que ya usan los tests existentes.
const INTELIGENCIAS_VALIDAS = [
  'linguistica', 'logico_matematica', 'espacial', 'musical',
  'kinestesica', 'interpersonal', 'intrapersonal', 'naturalista',
];
const TIPOS_TRIVIA_VALIDOS = ['vf', 'opcion', 'abierta', 'caso'];

function validarEstructuraMaterialTema(material, modo, enfoque = 'estudio') {
  const problemas = [];

  if (!material || typeof material !== 'object') {
    return ['El material llegó vacío o no es un objeto.'];
  }

  // "examen" (Modo Examen, 31-ago-2026) es un simulador puro — ver
  // agents/combinarTemas.js — que deja resumen/diagrama/actividad vacíos A
  // PROPÓSITO y solo trae ejercicios y/o trivia (lo que aplique según el
  // tema, no siempre ambos). Nada de eso es un error ahí, así que esas
  // reglas (pensadas para el material completo de siempre) no aplican.
  const esExamen = enfoque === 'examen';

  // --- Resumen ---
  if (!esExamen) {
    const resumen = material.resumen;
    if (!resumen || typeof resumen !== 'object' || !String(resumen.que_es || '').trim()) {
      problemas.push('El resumen no trae "que_es" (la idea central del tema).');
    }
  }

  // --- Actividad(es), según modo ---
  if (!esExamen) {
    if (modo === 'grupo') {
      const actividades = material.actividades || [];
      if (actividades.length !== 8) {
        problemas.push(`En modo grupo se esperan 8 actividades (una por inteligencia) y llegaron ${actividades.length}.`);
      }
      const inteligenciasVistas = new Set();
      actividades.forEach((a, i) => {
        if (!a.titulo || !a.instrucciones) {
          problemas.push(`Actividad ${i + 1}: falta título o instrucciones.`);
        }
        if (!INTELIGENCIAS_VALIDAS.includes(a.inteligencia)) {
          problemas.push(`Actividad ${i + 1}: "${a.inteligencia}" no es una inteligencia válida.`);
        } else {
          inteligenciasVistas.add(a.inteligencia);
        }
      });
      if (inteligenciasVistas.size < INTELIGENCIAS_VALIDAS.length && actividades.length === 8) {
        problemas.push('Las 8 actividades no cubren las 8 inteligencias (hay repetidas).');
      }
    } else {
      const actividad = material.actividad;
      if (!actividad || !actividad.titulo || !actividad.instrucciones) {
        problemas.push('Falta la actividad (título e instrucciones) o viene incompleta.');
      }
    }
  }

  // --- Ejercicios ---
  // En modo examen no es obligatorio traer ejercicios (el simulador puede
  // resolverse solo con trivia, ver el "o" de abajo) — pero si SÍ trae,
  // cada uno debe venir completo igual que siempre.
  const ejercicios = material.ejercicios || [];
  if (!esExamen) {
    const minEjercicios = material.es_de_practica ? 4 : 1;
    if (ejercicios.length < minEjercicios) {
      problemas.push(`Solo llegaron ${ejercicios.length} ejercicio(s) (mínimo esperado: ${minEjercicios}).`);
    }
  }
  ejercicios.forEach((e, i) => {
    if (!e.enunciado || !String(e.enunciado).trim()) {
      problemas.push(`Ejercicio ${i + 1}: falta el enunciado.`);
    }
    if (!e.respuesta || !String(e.respuesta).trim()) {
      problemas.push(`Ejercicio ${i + 1}: falta la respuesta.`);
    }
  });

  // --- Trivia ---
  const trivia = material.trivia || [];
  if (esExamen) {
    if (ejercicios.length === 0 && trivia.length === 0) {
      problemas.push('El simulador no trae ni ejercicios ni trivia — tiene que traer al menos uno de los dos.');
    }
  } else if (trivia.length === 0) {
    problemas.push('No llegó ninguna pregunta de trivia.');
  }
  trivia.forEach((p, i) => {
    if (!p.pregunta || !String(p.pregunta).trim()) {
      problemas.push(`Trivia ${i + 1}: falta el texto de la pregunta.`);
      return;
    }
    if (!TIPOS_TRIVIA_VALIDOS.includes(p.tipo)) {
      problemas.push(`Trivia ${i + 1}: tipo "${p.tipo}" no es válido (debe ser vf/opcion/abierta/caso).`);
    }
    if (p.tipo === 'opcion' || p.tipo === 'vf') {
      const opciones = p.opciones || [];
      if (opciones.length < 2) {
        problemas.push(`Trivia ${i + 1}: tiene menos de 2 opciones.`);
      } else {
        const unicas = new Set(opciones.map(o => String(o).trim().toLowerCase()));
        if (unicas.size < opciones.length) {
          problemas.push(`Trivia ${i + 1}: hay opciones repetidas.`);
        }
        const correctaExiste = opciones.some(o => String(o).trim().toLowerCase() === String(p.respuesta_correcta || '').trim().toLowerCase());
        if (!correctaExiste) {
          problemas.push(`Trivia ${i + 1}: la respuesta correcta ("${p.respuesta_correcta}") no aparece entre las opciones.`);
        }
      }
    } else if (!String(p.respuesta_correcta || '').trim()) {
      problemas.push(`Trivia ${i + 1}: falta la respuesta correcta.`);
    }
  });

  return problemas;
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

const TIMEOUT_REVISION_MS = 15000;

function conTimeout(promesa, ms, mensajeError) {
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new Error(mensajeError)), ms)),
  ]);
}

async function revisarConIA(askClaude, material, contexto) {
  const systemPrompt = `Eres un revisor de calidad educativa, estricto pero justo.
Tu única tarea es encontrar problemas REALES en el siguiente material — no
opines sobre estilo ni hagas sugerencias de mejora, solo detecta errores.

Tema que se pidió: "${contexto.tema || 'no especificado'}"
Edad objetivo: ${contexto.edadObjetivo} años

Revisa específicamente:
1. Datos incorrectos o inventados (fechas, nombres, hechos científicos, etc.)
2. Preguntas de quiz donde ninguna opción sea realmente correcta, o donde
   más de una opción podría considerarse correcta (ambigüedad)
3. Contradicciones dentro del mismo texto
4. Que el contenido sea realmente sobre el tema pedido — no un tema distinto o desviado
5. Que los CONCEPTOS (no solo el vocabulario) sean apropiados para la edad —
   por ejemplo, una palabra corta como "ADN" puede estar bien escrita pero
   ser un concepto demasiado avanzado para un niño de 5 años

Si NO encuentras ningún problema, responde exactamente: OK

Si encuentras problemas, responde con una lista, una línea por problema,
cada línea empezando con "- ". No agregues explicaciones adicionales.`;

  const materialTexto = JSON.stringify(material, null, 2);
  let respuesta;
  try {
    respuesta = await conTimeout(
      askClaude(systemPrompt, materialTexto, 400),
      TIMEOUT_REVISION_MS,
      'La revisión con IA tardó demasiado (timeout) — se trata como "no verificado" en vez de bloquear al usuario.'
    );
  } catch (err) {
    // Si el revisor falla o tarda, no bloqueamos al usuario — se entrega el
    // material sin el sello de verificado, y se registra la causa.
    return { ok: false, problemas: [`Revisión con IA no completada: ${err.message}`] };
  }

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
 * @param {object} contexto - { tipo: 'quiz'|'memorama'|'resumen'|'material_tema', edadObjetivo: number, modo?: 'individual'|'grupo' }
 *   `modo` solo aplica (y es requerido en la práctica) cuando tipo es
 *   'material_tema' — decide si se valida `actividad` o `actividades`.
 * @param {number} maxIntentos - default 2 (1 intento inicial + 1 regeneración)
 * @param {object} [opciones] - opcional:
 *   - cache: { get(clave), set(clave, valor) } — para no regenerar/revisar
 *     dos veces el mismo tema+edad+tipo. Si no se pasa, no se cachea nada.
 *   - onProblemaDetectado(problemas, intento) — callback para que registres
 *     (log, base de datos, etc.) qué tipo de errores salen más seguido y
 *     así ajustar tus prompts de generación con el tiempo.
 */
async function verificarYCorregir(askClaude, generarFn, temaOriginal, contexto, maxIntentos = 2, opciones = {}) {
  const { cache, onProblemaDetectado } = opciones;

  const claveCache = cache
    ? `${contexto.tipo}:${contexto.edadObjetivo}:${temaOriginal.trim().toLowerCase()}`
    : null;

  if (cache) {
    const enCache = await cache.get(claveCache);
    if (enCache) return enCache;
  }

  // Le pasamos el tema al contexto para que el revisor de IA pueda checar
  // que el contenido de verdad sea sobre lo que se pidió.
  const contextoConTema = { ...contexto, tema: temaOriginal };

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
    const estructura = validarEstructura(material, contexto.tipo, contexto.modo, contexto.enfoque);
    if (!estructura.ok) notas.push(...estructura.problemas);

    // Paso 2: nivel de lectura (gratis) — solo si hay texto evaluable.
    // Para 'material_tema' el texto representativo es el resumen (que_es +
    // secciones) — es lo que más se lee de corrido; ejercicios y trivia son
    // más cortos y no reflejan bien la dificultad de lectura general.
    const textoParaLeer = material.texto
      || (material.preguntas || []).map(p => p.pregunta).join(' ')
      || (material.resumen && typeof material.resumen === 'object'
        ? [material.resumen.que_es, ...(material.resumen.secciones || []).map(s => s.texto)].filter(Boolean).join(' ')
        : '');
    if (textoParaLeer) {
      const { score } = calcularNivelLectura(textoParaLeer);
      const comparacion = compararConEdad(score, contexto.edadObjetivo);
      if (!comparacion.ok) notas.push(comparacion.mensaje);
    }

    // Si ya hay problemas estructurales/de nivel, no gastamos la llamada de IA todavía —
    // vamos directo a regenerar (ahorra costo).
    if (notas.length > 0) {
      if (onProblemaDetectado) onProblemaDetectado(notas, intentos);
      continue;
    }

    // Paso 3: revisión con IA — solo si lo anterior pasó limpio
    const revisionIA = await revisarConIA(askClaude, material, contextoConTema);
    if (!revisionIA.ok) {
      notas.push(...revisionIA.problemas);
      if (onProblemaDetectado) onProblemaDetectado(notas, intentos);
      continue;
    }

    // Todo pasó: material verificado
    const resultadoOk = {
      material,
      calidad: { verificado: true, intentos, notas: [] },
    };
    if (cache) await cache.set(claveCache, resultadoOk);
    return resultadoOk;
  }

  // Se acabaron los intentos y siguen quedando problemas —
  // se entrega igual (no bloquear al usuario), pero SIN el sello de verificado,
  // y con las notas para que tú puedas revisar manualmente el caso.
  // Nota: esto NO se cachea — no queremos guardar/repetir un resultado sin verificar.
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
