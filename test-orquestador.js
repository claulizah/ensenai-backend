const { verificarYCorregir } = require('./utils/revisorCalidad');

// Simulamos askClaude: en la vida real llama a la API de Claude.
// Aquí simulamos que el revisor de IA SIEMPRE aprueba (para probar el flujo completo).
async function askClaudeFalso(systemPrompt, mensaje, maxTokens) {
  return 'OK';
}

// Simulamos una función generadora que la PRIMERA vez produce un quiz roto,
// y la SEGUNDA vez (tras recibir instrucciones correctivas) lo produce bien.
let llamadas = 0;
async function generarFalso(tema, instruccionesCorrectivas) {
  llamadas++;
  console.log(`  [generarFn] Llamada #${llamadas}. Instrucciones correctivas: "${instruccionesCorrectivas || '(ninguna, primer intento)'}"`);

  if (llamadas === 1) {
    // Simula el bug: índice fuera de rango
    return {
      preguntas: [
        { pregunta: '¿Cuántos planetas tiene el sistema solar?', opciones: ['7', '8', '9'], respuestaCorrectaIndex: 9 }
      ]
    };
  }
  // Segundo intento: ya corregido
  return {
    preguntas: [
      { pregunta: '¿Cuántos planetas tiene el sistema solar?', opciones: ['7', '8', '9'], respuestaCorrectaIndex: 1 }
    ]
  };
}

async function main() {
  console.log('=== Caso: primer intento sale roto, segundo intento se autocorrige ===');
  const resultado = await verificarYCorregir(
    askClaudeFalso,
    generarFalso,
    'el sistema solar',
    { tipo: 'quiz', edadObjetivo: 9 },
    2 // máximo 2 intentos
  );
  console.log('\nResultado final:');
  console.log(JSON.stringify(resultado, null, 2));
}

main();
