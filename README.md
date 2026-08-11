# EnseñAI — backend (arranque MVP)

## Qué ya funciona
- `POST /api/creators` — registra un creador (name, email).
- `GET /api/creators/:id` — consulta un creador.
- `POST /api/courses/upload` — recibe un video + creatorId + title + audiencia (+ opcionalmente respuestas del modo "con ayuda del tutor"), sube el video a Supabase Storage, lo transcribe, genera los materiales, y guarda todo como curso en estado "borrador".
- `GET /api/courses/:id` — regresa el curso + materiales, para la pantalla de revisión.
- `PATCH /api/courses/:id/materials` — guarda las ediciones del creador sobre los materiales generados.
- `POST /api/courses/:id/publish` — publica el curso (requiere price_mxn), le asigna slug público y fecha de publicación.

## Antes de probar: crea el bucket de Storage
En el dashboard de Supabase → Storage → New bucket → nómbralo exactamente `course-videos` → márcalo como público (para que `getPublicUrl` funcione en el MVP).

## Qué falta (pendiente a propósito, para ir paso a paso)
- Integración con Stripe para el cobro al publicar/comprar.
- Página pública del curso (frontend).
- Verificación de credenciales del creador (por ahora `credential_verified` queda en `false` por default).

## Cómo arrancarlo en tu máquina (Windows / Git Bash)

```bash
cd backend
npm install
cp .env.example .env
# llena .env con tus keys de Supabase y Anthropic
npm install -g nodemon   # opcional, para recarga automática
nodemon server.js
```

Luego prueba con:
```bash
curl http://localhost:3001/health
```

## Base de datos
1. Crea un proyecto en Supabase (si no lo has hecho para este proyecto).
2. Corre `db/schema.sql` en el SQL Editor de Supabase — crea las tablas `creators`, `courses`, `course_materials`.
3. Copia la URL del proyecto y la `service_role` key a tu `.env`.

## Validar el flujo completo automáticamente (recomendado)
En vez de correr cada comando `curl` a mano, hay un script que corre todo el flujo (crear creador → subir → generar → revisar → editar → publicar) y te dice en qué paso falló si algo sale mal:

```bash
node test-flow.js /ruta/a/tu/video.mp4
```

Requiere que `node server.js` ya esté corriendo en otra terminal, y Node 18+ (trae `fetch` incluido).

## Probar el flujo paso a paso manualmente (alternativa)

1. Crea un creador:
```bash
curl -X POST http://localhost:3001/api/creators \
  -H "Content-Type: application/json" \
  -d '{"name":"Claudia Acosta","email":"claudia@ejemplo.com"}'
```
Copia el `id` que regresa.

2. Sube un video (usa el id del paso anterior):
```bash
curl -X POST http://localhost:3001/api/courses/upload \
  -F "video=@/ruta/a/tu/video.mp4" \
  -F "creatorId=EL_ID_DEL_CREADOR" \
  -F "title=Fracciones básicas" \
  -F "audience=ninos"
```
Copia el `id` del curso que regresa.

3. Revisa el curso + materiales:
```bash
curl http://localhost:3001/api/courses/EL_ID_DEL_CURSO
```

4. Edita los materiales (opcional):
```bash
curl -X PATCH http://localhost:3001/api/courses/EL_ID_DEL_CURSO/materials \
  -H "Content-Type: application/json" \
  -d '{"resumen_editado":"Resumen ajustado a mano."}'
```

5. Publica el curso:
```bash
curl -X POST http://localhost:3001/api/courses/EL_ID_DEL_CURSO/publish \
  -H "Content-Type: application/json" \
  -d '{"price_mxn":79}'
```

## Siguiente paso sugerido
Conectar el proveedor de transcripción real (Whisper o AssemblyAI) para probar el flujo completo con un video de verdad, antes de construir el frontend.
