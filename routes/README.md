# Capa de control de calidad — EnseñAI

Módulo para verificar y auto-corregir el material educativo generado antes de
que le llegue al usuario. Diseñado para conectarse a tu backend existente sin
duplicar tu cliente de Claude.

## Cómo integrarlo

En tu backend (ensenai-backend), donde hoy generas el material directamente,
envuelve esa llamada con `verificarYCorregir`:

```js
const { verificarYCorregir } = require('./revisorCalidad');

// Tu función askClaude YA existente (la que ya usas en el resto del backend)
// Firma esperada: async (systemPrompt, mensajeUsuario, maxTokens) => textoRespuesta

// Adapta tu función generadora actual a esta firma:
// async (temaOriginal, instruccionesCorrectivas) => material
async function generarMaterial(tema, instruccionesCorrectivas) {
  const prompt = instruccionesCorrectivas
    ? `Genera material sobre "${tema}". ${instruccionesCorrectivas}`
    : `Genera material sobre "${tema}".`;
  const respuesta = await askClaude(TU_SYSTEM_PROMPT_ACTUAL, prompt, 1000);
  return JSON.parse(respuesta); // o como ya parseas la respuesta hoy
}

// En tu endpoint:
const { material, calidad } = await verificarYCorregir(
  askClaude,
  generarMaterial,
  temaDelUsuario,
  { tipo: 'quiz', edadObjetivo: 9 }, // tipo: 'quiz' | 'memorama' | 'resumen'
  2 // máximo de intentos, ajustable
);

// Guarda/devuelve `material` como ya haces, y usa `calidad.verificado`
// para mostrar el sello "✓ Contenido verificado" en el frontend.
```

## Qué hace cada verificación

1. **Estructura** (gratis, sin IA): índices de respuesta válidos, memorama con
   pares completos, campos esperados presentes.
2. **Nivel de lectura** (gratis, sin IA): fórmula Fernández-Huerta (adaptación
   al español del índice Flesch), comparado contra la edad objetivo.
3. **Revisión con IA** (una llamada barata a Claude como revisor, no generador):
   solo corre si los pasos 1 y 2 ya pasaron limpio, para no gastar de más.

Si algo falla, se regenera con instrucciones correctivas específicas, hasta
el máximo de intentos que definas. Si se agotan los intentos y sigue habiendo
problemas, se entrega el material igual (no se bloquea al usuario) pero sin
el sello de verificado, y con las notas de qué falló — para que puedas
revisar esos casos manualmente y ajustar tus prompts con el tiempo.

## Archivos de prueba incluidos

- `test-manual.js` — prueba las validaciones de estructura y nivel de lectura
  con casos rotos y válidos, sin necesitar API key.
- `test-orquestador.js` — simula el flujo completo de detección + regeneración
  con un `askClaude` falso, para ver la lógica de principio a fin sin gastar
  llamadas reales.

Corre cualquiera con `node test-manual.js` o `node test-orquestador.js`.

## Ajustes que probablemente quieras hacer

- Los rangos de nivel de lectura por edad (`NIVEL_ESPERADO_POR_EDAD`) son un
  punto de partida — ajústalos con lo que observes en producción.
- El máximo de intentos (default 2) — súbelo si ves que 2 no es suficiente,
  aunque cada intento extra cuesta una llamada más a la API.
- El prompt del revisor de IA está en español neutro — personalízalo si
  quieres que sea más estricto o más permisivo en algún tipo de contenido.
