# Capa de control de calidad — EnseñAI

Módulo para verificar y auto-corregir el material educativo generado antes de
que le llegue al usuario. Vive en `utils/` (no en `routes/`: no es un router
de Express, es una utilidad, igual que `utils/planes.js` o `utils/slugify.js`).

## Ya está integrado

`routes/temas.js` (endpoint `POST /api/temas/generar`) envuelve la llamada a
`generarMaterialTema` (en `agents/generateTema.js`) con `verificarYCorregir`,
usando el `askClaude` que se exporta desde ese mismo archivo:

```js
// routes/temas.js
const { generarMaterialTema, askClaude, EDAD_APROX } = require("../agents/generateTema");
const { verificarYCorregir } = require("../utils/revisorCalidad");

const generarFn = (temaOriginal, instruccionesCorrectivas) =>
  generarMaterialTema(temaOriginal, nivel, perfilDominante, modoFinal, {
    detalles: instruccionesCorrectivas ? `${detalles || ""} ${instruccionesCorrectivas}`.trim() : detalles,
    imagenes,
  });

const { material: contenido, calidad } = await verificarYCorregir(
  askClaude,
  generarFn,
  tema,
  { tipo: "material_tema", modo: modoFinal, edadObjetivo: edadNumericaAproximada(nivel) },
  2,
  { onProblemaDetectado: (problemas, intento) => console.warn(`[QA temas] intento ${intento}:`, problemas) }
);
```

Notas de esta integración:

- El tipo usado es `'material_tema'` (no `'quiz'`/`'memorama'`/`'resumen'`) —
  es el que entiende la forma real que genera `generarMaterialTema`: resumen
  por secciones, `actividad` (individual) o `actividades` (grupo, 8 en
  total), `ejercicios`, `trivia`, `material_extra`. Ver
  `validarEstructuraMaterialTema` en `revisorCalidad.js`.
- Las instrucciones correctivas se reutilizan por el mismo canal `detalles`
  que ya recibe el prompt (no se tocó `buildPrompt`).
- `calidad` (con `calidad.verificado`) se regresa en la respuesta del
  endpoint (`POST /api/temas/generar`), pero **no** se guarda en la tabla
  `mis_temas` — esa tabla no tiene esa columna hoy. Si quieres persistirlo
  para mostrar el sello también en el historial, hay que agregar una columna
  (`calidad jsonb`, por ejemplo) vía una nueva `db/schema_vXX.sql`.
- El generador de video (`agents/generate.js`, el flujo viejo que
  `generateTema.js` reemplaza) NO está conectado a esta capa de QA — nadie
  lo pidió y su forma de material es distinta otra vez (glosario, memorama
  simple, flashcards). Se puede integrar por separado si hace falta.

## Cómo integrarlo en otro lugar (referencia genérica)

Si en el futuro quieres usar este módulo para otro flujo de generación con
una forma de material distinta, la firma general es:

```js
const { material, calidad } = await verificarYCorregir(
  askClaude,           // async (systemPrompt, mensaje, maxTokens) => texto
  generarFn,           // async (temaOriginal, instruccionesCorrectivas) => material
  temaDelUsuario,
  { tipo: 'quiz'|'memorama'|'resumen'|'material_tema', modo: 'individual'|'grupo', edadObjetivo: 9 },
  2, // máximo de intentos, ajustable
  {
    cache: miCache, // opcional: objeto con get(clave)/set(clave, valor)
    onProblemaDetectado: (problemas, intento) => console.log(problemas),
  }
);
```

`modo` solo importa cuando `tipo` es `'material_tema'`. Para una forma de
material completamente nueva, agrega otro branch a `validarEstructura` en
vez de forzarla dentro de un tipo existente.

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

Viven en la raíz del proyecto (junto a `test-flow.js`), no aquí en `utils/`:

- `test-manual.js` — prueba las validaciones de estructura y nivel de lectura
  con casos rotos y válidos, sin necesitar API key.
- `test-orquestador.js` — simula el flujo completo de detección + regeneración
  con un `askClaude` falso, para ver la lógica de principio a fin sin gastar
  llamadas reales.
- `test-correcciones.js` — prueba puntual de las correcciones de la segunda
  revisión (memorama vacío, caché, timeout, callback `onProblemaDetectado`).

Corre cualquiera desde la raíz: `node test-manual.js`, `node test-orquestador.js`
o `node test-correcciones.js`.

## Ajustes que probablemente quieras hacer

- Los rangos de nivel de lectura por edad (`NIVEL_ESPERADO_POR_EDAD`) son un
  punto de partida — ajústalos con lo que observes en producción.
- El máximo de intentos (default 2) — súbelo si ves que 2 no es suficiente,
  aunque cada intento extra cuesta una llamada más a la API.
- El prompt del revisor de IA está en español neutro — personalízalo si
  quieres que sea más estricto o más permisivo en algún tipo de contenido.
- El timeout de la revisión con IA es 15 segundos (`TIMEOUT_REVISION_MS`) —
  si notas que Claude tarda más seguido en tu caso de uso, súbelo.

## Correcciones aplicadas (segunda revisión)

- **Bug real corregido:** un memorama con 0 tarjetas pasaba la validación
  como "válido" (0 es número par) — ahora se detecta explícitamente.
- **Revisor de IA más completo:** ahora también verifica que el contenido
  sea realmente sobre el tema pedido (no desviado), y que los *conceptos*
  sean apropiados para la edad, no solo la redacción.
- **Timeout:** si la llamada de revisión con IA se cuelga o tarda de más,
  ya no bloquea al usuario — se entrega el material sin el sello de
  verificado, y se registra la causa.
- **Caché opcional:** si le pasas un objeto `cache` (ver ejemplo arriba),
  no se repite generación+revisión para el mismo tema+edad+tipo. Los
  resultados sin verificar nunca se cachean, para no repetir un mal
  resultado.
- **Callback `onProblemaDetectado`:** para que acumules qué tipo de
  errores salen más seguido y ajustes tus prompts de generación con
  datos reales, no solo intuición.

## Pendiente, no implementado (decisión consciente)

- **Regenerar solo la pieza rota, no todo el material completo.** Por
  ejemplo, si de 8 ejercicios solo 1 sale mal, o de 8 actividades de grupo
  solo 1 tiene una inteligencia repetida, hoy se regenera el material
  completo (las 8, las 8). No lo implementé porque `generarMaterialTema`
  devuelve el material completo de una sola llamada a Claude — hacer
  regeneración parcial requeriría que supiera regenerar/reemplazar una sola
  pieza (un ejercicio, una actividad), lo cual cambia bastante el prompt de
  `agents/generateTema.js`. Se puede diseñar si en producción se ve que la
  regeneración completa sale cara o lenta seguido.
- **Persistir `calidad` en el historial (`mis_temas`).** Ver nota en
  "Ya está integrado" arriba — hoy solo viaja en la respuesta del endpoint,
  no en la base de datos.
