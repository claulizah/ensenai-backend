const { validarEstructura, calcularNivelLectura, compararConEdad } = require('./utils/revisorCalidad');

console.log('=== Prueba 1: quiz con índice de respuesta fuera de rango (el bug real que buscamos atrapar) ===');
const quizRoto = {
  preguntas: [
    { pregunta: '¿Capital de Francia?', opciones: ['Madrid', 'París', 'Roma'], respuestaCorrectaIndex: 5 }
  ]
};
console.log(validarEstructura(quizRoto, 'quiz'));

console.log('\n=== Prueba 2: quiz válido ===');
const quizBueno = {
  preguntas: [
    { pregunta: '¿Capital de Francia?', opciones: ['Madrid', 'París', 'Roma'], respuestaCorrectaIndex: 1 }
  ]
};
console.log(validarEstructura(quizBueno, 'quiz'));

console.log('\n=== Prueba 3: memorama con número impar de tarjetas ===');
const memoramaRoto = {
  tarjetas: [
    { parejaId: 'sol', texto: 'Sol' },
    { parejaId: 'sol', texto: 'Estrella' },
    { parejaId: 'luna', texto: 'Luna' }, // le falta su pareja
  ]
};
console.log(validarEstructura(memoramaRoto, 'memorama'));

console.log('\n=== Prueba 4: nivel de lectura — texto simple vs complejo ===');
const textoSimple = 'El sol es una estrella. Da luz y calor. La Tierra gira a su alrededor.';
const textoComplejo = 'La fotosíntesis constituye un proceso bioquímico fundamental mediante el cual los organismos autótrofos sintetizan compuestos orgánicos complejos.';

const nivelSimple = calcularNivelLectura(textoSimple);
const nivelComplejo = calcularNivelLectura(textoComplejo);
console.log('Texto simple:', nivelSimple);
console.log('Texto complejo:', nivelComplejo);

console.log('\n=== Prueba 5: comparación contra edad objetivo ===');
console.log('Texto complejo para niño de 7 años:', compararConEdad(nivelComplejo.score, 7));
console.log('Texto simple para niño de 7 años:', compararConEdad(nivelSimple.score, 7));
