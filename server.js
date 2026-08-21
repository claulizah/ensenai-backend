require("dotenv").config();
const express = require("express");
const cors = require("cors");
const coursesRouter = require("./routes/courses");
const creatorsRouter = require("./routes/creators");
const purchasesRouter = require("./routes/purchases");
const bundlesRouter = require("./routes/bundles");
const aprendizajeRouter = require("./routes/aprendizaje");
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

app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok", service: "ensenai-backend" }));

app.use("/api/courses", coursesRouter);
app.use("/api/creators", creatorsRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/bundles", bundlesRouter);
app.use("/api/aprendizaje", aprendizajeRouter);

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "El video es muy grande (máximo 200 MB, hasta ~10 minutos)." });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Error interno del servidor." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`EnseñAI backend corriendo en http://localhost:${PORT}`);
});
