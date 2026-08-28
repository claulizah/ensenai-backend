// test-material-tema.js
// Prueba puntual del validador de la forma REAL de material que produce
// agents/generateTema.js (tipo 'material_tema' en utils/revisorCalidad.js),
// distinta de los tipos simples quiz/memorama/resumen que ya cubre
// test-manual.js. Sin necesitar API key — solo prueba validarEstructura.

const { validarEstructura } = require('./utils/revisorCalidad');

function materialValidoIndividual() {
  return {
    es_de_practica: true,
    resumen: { que_es: 'Las fracciones representan partes de un todo.', secciones: [], pasos: [], ideas_clave: [], ojo_aqui: '', truco: '' },
    actividad: { titulo: 'Reparte la pizza', instrucciones: '1. Dibuja una pizza...' },
    ejercicios: Array.from({ length: 6 }, (_, i) => ({ enunciado: `Ejercicio ${i + 1}`, pista: '...', pasos: ['...'], respuesta: `${i + 1}/2` })),
    trivia: [
      { pregunta: '¿Qué representa el denominador?', tipo: 'opcion', opciones: ['El total de partes', 'La parte tomada', 'Nada'], respuesta_correcta: 'El total de partes' },
      { pregunta: '¿1/2 es mayor que 1/4?', tipo: 'vf', opciones: ['Verdadero', 'Falso'], respuesta_correcta: 'Verdadero' },
    ],
    material_extra: [],
  };
}

function materialValidoGrupo() {
  const inteligencias = ['linguistica', 'logico_matematica', 'espacial', 'musical', 'kinestesica', 'interpersonal', 'intrapersonal', 'naturalista'];
  return {
    ...materialValidoIndividual(),
    actividad: undefined,
    actividades: inteligencias.map((inteligencia) => ({ inteligencia, titulo: `Actividad ${inteligencia}`, instrucciones: '1. Haz esto...' })),
  };
}

console.log('=== Caso 1: material individual válido (debería pasar) ===');
console.log(validarEstructura(materialValidoIndividual(), 'material_tema', 'individual'));

console.log('\n=== Caso 2: material individual sin resumen ni actividad (debería fallar) ===');
console.log(validarEstructura({ ejercicios: [], trivia: [] }, 'material_tema', 'individual'));

console.log('\n=== Caso 3: trivia de opción con la respuesta correcta que no está en las opciones (bug real que debería atrapar) ===');
const roto = materialValidoIndividual();
roto.trivia[0].respuesta_correcta = 'Un número cualquiera';
console.log(validarEstructura(roto, 'material_tema', 'individual'));

console.log('\n=== Caso 4: material de grupo válido con las 8 inteligencias (debería pasar) ===');
console.log(validarEstructura(materialValidoGrupo(), 'material_tema', 'grupo'));

console.log('\n=== Caso 5: material de grupo con solo 3 actividades (debería fallar) ===');
const grupoRoto = materialValidoGrupo();
grupoRoto.actividades = grupoRoto.actividades.slice(0, 3);
console.log(validarEstructura(grupoRoto, 'material_tema', 'grupo'));

console.log('\n=== Caso 6: tema de práctica con solo 2 ejercicios (debería fallar, mínimo 4) ===');
const pocosEjercicios = materialValidoIndividual();
pocosEjercicios.ejercicios = pocosEjercicios.ejercicios.slice(0, 2);
console.log(validarEstructura(pocosEjercicios, 'material_tema', 'individual'));
