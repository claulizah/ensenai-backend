/**
 * Script de validación end-to-end del flujo de creador completo:
 * crear creador → subir video → generar materiales → revisar → editar → publicar.
 *
 * Uso:
 *   node test-flow.js /ruta/a/tu/video.mp4
 *
 * Requiere que el servidor (node server.js) ya esté corriendo en otra terminal.
 */
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const videoPath = process.argv[2];

const check = (ok, label, detail) => {
  console.log(ok ? `✅ ${label}` : `❌ ${label}`);
  if (!ok) {
    if (detail) console.log("   → detalle del error:", JSON.stringify(detail));
    process.exit(1);
  }
};

async function run() {
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error("❌ Necesitas pasar la ruta a un video de prueba: node test-flow.js /ruta/video.mp4");
    process.exit(1);
  }

  console.log(`\nValidando contra ${BASE_URL}\n`);

  // 0. Health check
  const health = await fetch(`${BASE_URL}/health`).then((r) => r.json()).catch(() => null);
  check(health?.status === "ok", "Servidor respondiendo (/health)");

  // 1. Crear creador
  const creatorRes = await fetch(`${BASE_URL}/api/creators`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Creador de prueba",
      email: `prueba-${Date.now()}@ejemplo.com`, // único cada vez, evita choque con email UNIQUE
    }),
  }).then((r) => r.json());
  check(!!creatorRes.creator?.id, "Crear creador", creatorRes);
  const creatorId = creatorRes.creator.id;
  console.log(`   → creatorId: ${creatorId}`);

  // 2. Subir video (multipart)
  const form = new FormData();
  const fileBuffer = fs.readFileSync(videoPath);
  form.append("video", new Blob([fileBuffer]), path.basename(videoPath));
  form.append("creatorId", creatorId);
  form.append("title", "Curso de prueba automática");
  form.append("audience", "ninos");

  const uploadRes = await fetch(`${BASE_URL}/api/courses/upload`, {
    method: "POST",
    body: form,
  }).then((r) => r.json());
  check(!!uploadRes.course?.id, "Subir video + transcribir + generar materiales", uploadRes);
  const courseId = uploadRes.course.id;
  console.log(`   → courseId: ${courseId}, status: ${uploadRes.course.status}`);

  // 3. Consultar curso para revisión
  const getRes = await fetch(`${BASE_URL}/api/courses/${courseId}`).then((r) => r.json());
  check(!!getRes.course && !!getRes.materials, "Consultar curso + materiales para revisión", getRes);

  // 4. Editar materiales
  const editRes = await fetch(`${BASE_URL}/api/courses/${courseId}/materials`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumen_editado: "Resumen ajustado por el script de prueba." }),
  }).then((r) => r.json());
  check(editRes.materials?.resumen_editado === "Resumen ajustado por el script de prueba.", "Editar materiales", editRes);

  // 5. Publicar
  const publishRes = await fetch(`${BASE_URL}/api/courses/${courseId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ price_mxn: 79 }),
  }).then((r) => r.json());
  check(publishRes.course?.status === "publicado", "Publicar curso", publishRes);
  console.log(`   → slug público: ${publishRes.course?.slug}`);

  console.log("\n🎉 Flujo completo validado sin errores.\n");
}

run().catch((err) => {
  console.error("❌ Error inesperado:", err.message);
  process.exit(1);
});
