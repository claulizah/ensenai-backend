require("dotenv").config();
const express = require("express");
const cors = require("cors");
const coursesRouter = require("./routes/courses");
const creatorsRouter = require("./routes/creators");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok", service: "ensenai-backend" }));

app.use("/api/courses", coursesRouter);
app.use("/api/creators", creatorsRouter);

// Manejador de errores — atrapa, entre otras cosas, el límite de tamaño de multer
// (que si no se atrapa aquí, regresa HTML en vez de JSON y rompe al frontend/script).
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "El video es muy grande (máximo 25 MB). Intenta con un video más corto o comprimido.",
    });
  }
  console.error(err);
  res.status(500).json({ error: err.message || "Error interno del servidor." });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`EnseñAI backend corriendo en http://localhost:${PORT}`);
});
