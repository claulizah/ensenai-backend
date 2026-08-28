const { validarEstructura, verificarYCorregir } = require('./utils/revisorCalidad');

async function main() {
  console.log('=== Corrección 1: memorama vacío ahora sí se detecta ===');
  console.log(validarEstructura({ tarjetas: [] }, 'memorama'));
  // Esperado: ok:false, con el mensaje de "no tiene ninguna tarjeta"

  console.log('\n=== Corrección 2: caché evita repetir generación+revisión ===');
  let llamadasGenerador = 0;
  async function generarFn(tema, instrucciones) {
    llamadasGenerador++;
    return { texto: 'El sol es una estrella. Da luz y calor.' };
  }
  async function askClaudeFalso() { return 'OK'; }

  // Caché simple en memoria para la prueba
  const almacen = new Map();
  const cache = {
    get: async (clave) => almacen.get(clave) || null,
    set: async (clave, valor) => almacen.set(clave, valor),
  };

  const contexto = { tipo: 'resumen', edadObjetivo: 8 };
  const r1 = await verificarYCorregir(askClaudeFalso, generarFn, 'el sol', contexto, 2, { cache });
  const r2 = await verificarYCorregir(askClaudeFalso, generarFn, 'el sol', contexto, 2, { cache });
  console.log('Llamadas al generador (debería ser 1, no 2, gracias al caché):', llamadasGenerador);
  console.log('Resultado 1 === Resultado 2 (mismo objeto del caché):', r1 === r2);

  console.log('\n=== Corrección 3: timeout en la revisión con IA no truena el proceso ===');
  async function askClaudeLento() {
    // Simula una llamada que nunca responde (más lenta que el timeout)
    return new Promise((resolve) => setTimeout(() => resolve('OK'), 30000));
  }
  async function generarSimple() { return { texto: 'Un texto cualquiera para probar el timeout aquí.' }; }

  console.log('(esto debería tardar ~15s por el timeout configurado, no 30s)');
  const inicio = Date.now();
  const resultado = await verificarYCorregir(askClaudeLento, generarSimple, 'tema x', { tipo: 'resumen', edadObjetivo: 10 }, 1);
  const duracion = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`Duración real: ${duracion}s`);
  console.log('Resultado (verificado debería ser false, con nota de timeout):', JSON.stringify(resultado.calidad, null, 2));

  console.log('\n=== Corrección 4: callback onProblemaDetectado se dispara ===');
  const problemasRegistrados = [];
  async function generarRoto() {
    return { preguntas: [{ pregunta: '¿x?', opciones: ['a', 'b'], respuestaCorrectaIndex: 9 }] };
  }
  await verificarYCorregir(
    askClaudeFalso, generarRoto, 'tema y', { tipo: 'quiz', edadObjetivo: 10 }, 1,
    { onProblemaDetectado: (problemas, intento) => problemasRegistrados.push({ problemas, intento }) }
  );
  console.log('Problemas registrados vía callback:', JSON.stringify(problemasRegistrados, null, 2));
}

main().then(() => {
  // El askClaudeLento de la prueba 3 deja un temporizador de 30s pendiente
  // (simulaba una llamada colgada) — esto es solo del script de prueba,
  // no del módulo real. Forzamos la salida limpia una vez que ya imprimimos todo.
  process.exit(0);
});
