require("dotenv").config();
const express = require("express");
const cors = require("cors");
const coursesRouter = require("./routes/courses");
const creatorsRouter = require("./routes/creators");
const purchasesRouter = require("./routes/purchases");
const bundlesRouter = require("./routes/bundles");
const aprendizajeRouter = require("./routes/aprendizaje");
const gruposRouter = require("./routes/grupos");
const temasRouter = require("./routes/temas");
const { stripeWebhookHandler } = require("./routes/stripeWebhook");

const app = express();

// Solo ensenai.com puede llamar a la API desde el navegador. Peticiones sin
// "origin" (como el webhook de Stripe, o pruebas con curl/Postman) se dejan
// pasar igual — CORS solo aplica a peticiones hechas desde un navegador.
const ORIGENES_PERMITIDOS = [
  "https://ensenai.com",
  "https://www.ensenai.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ORIGENES_PERMITIDOS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origen no permitido por CORS: ${origin}`));
      }
    },
  })
);

app.post("/api/purchases/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

// 12 MB: las fotos de resúmenes/apuntes que se mandan al generador de temas
// viajan como base64 dentro del JSON (ver routes/temas.js). El frontend ya
// las comprime antes de subirlas, pero el default de Express (100 KB) se
// quedaba corto y devolvía un 413 sin mensaje útil.
app.use(express.json({ limit: "12mb" }));

app.get("/health", (req, res) => res.json({ status: "ok", service: "ensenai-backend" }));

app.use("/api/courses", coursesRouter);
app.use("/api/creators", creatorsRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/bundles", bundlesRouter);
app.use("/api/aprendizaje", aprendizajeRouter);
app.use("/api/grupos", gruposRouter);
app.use("/api/temas", temasRouter);

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "El video es muy grande (máximo 200 MB, hasta ~10 minutos)." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Las fotos que subiste pesan demasiado. Intenta con menos fotos, o tómalas de nuevo con menor resolución." });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Error interno del servidor." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`EnseñAI backend corriendo en http://localhost:${PORT}`);
});
