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
const referidosRouter = require("./routes/referidos");
const feedbackRouter = require("./routes/feedback");
const supabaseEstado = require("./db/supabase");
const adminRouter = require("./routes/admin");
const paquetesRouter = require("./routes/paquetes");
const recursosRouter = require("./routes/recursos");
const { stripeWebhookHandler } = require("./routes/stripeWebhook");
const { inboundEmailWebhookHandler } = require("./routes/inboundEmail");
const { iniciarBarridoZombis } = require("./utils/trabajos");

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

// Webhook de "Receiving" de Resend (contacto@ensenai.com → correo personal
// — ver routes/inboundEmail.js). Igual que el de Stripe, necesita el body
// RAW para verificar la firma, así que se registra antes de express.json().
app.post("/api/inbound/webhook", express.raw({ type: "application/json" }), inboundEmailWebhookHandler);

// 12 MB: las fotos de resúmenes/apuntes que se mandan al generador de temas
// viajan como base64 dentro del JSON (ver routes/temas.js). El frontend ya
// las comprime antes de subirlas, pero el default de Express (100 KB) se
// quedaba corto y devolvía un 413 sin mensaje útil.
app.use(express.json({ limit: "12mb" }));

/**
 * /health — la revisa RENDER para decidir si la instancia está viva.
 *
 * Se queda como está a propósito: contesta rápido y siempre 200. Si aquí
 * empezáramos a revisar Supabase y a fallar cuando Supabase tiene un mal
 * día, Render daría la instancia por muerta y la reiniciaría en bucle —
 * el remedio sería peor que la enfermedad.
 */
app.get("/health", (req, res) => res.json({ status: "ok", service: "ensenai-backend" }));

/**
 * /estado — esta es la que revisa UptimeRobot.
 *
 * /health solo prueba que el proceso de Node respira. Con Supabase caído,
 * /health sigue diciendo "ok" mientras ningún maestro puede entrar ni
 * generar un tema: el peor tipo de caída, la que no se ve.
 *
 * Aquí sí se toca la base con la consulta más barata posible (una fila,
 * solo el conteo). Contesta SIEMPRE 200 —para no confundir a Render si
 * algún día alguien apunta su health check aquí— y lo que cambia es el
 * texto: "ok" o "degradado". UptimeRobot se configura como monitor de
 * palabra clave buscando  "status":"ok"  y avisa cuando desaparece.
 */
app.get("/estado", async (req, res) => {
  const inicio = Date.now();
  const salida = { status: "ok", service: "ensenai-backend", supabase: "ok", ms: 0 };

  if (!supabaseEstado) {
    salida.status = "degradado";
    salida.supabase = "sin configurar";
  } else {
    try {
      const { error } = await supabaseEstado
        .from("platform_settings")
        .select("id", { count: "exact", head: true })
        .limit(1);
      if (error) throw new Error(error.message);
    } catch (err) {
      salida.status = "degradado";
      salida.supabase = String(err.message || err).slice(0, 120);
    }
  }

  salida.ms = Date.now() - inicio;
  res.json(salida);
});

app.use("/api/courses", coursesRouter);
app.use("/api/creators", creatorsRouter);
app.use("/api/purchases", purchasesRouter);
app.use("/api/bundles", bundlesRouter);
app.use("/api/aprendizaje", aprendizajeRouter);
app.use("/api/grupos", gruposRouter);
app.use("/api/temas", temasRouter);
app.use("/api/referidos", referidosRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/admin/paquetes", paquetesRouter);
app.use("/api/admin", adminRouter);
app.use("/api/recursos", recursosRouter);

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
  // Las generaciones en segundo plano (POST /api/temas/generar-async) se
  // atienden dentro de este proceso. Si el servidor se reinicia a media
  // generación, el trabajo queda "generando" para siempre y el celular se
  // queda preguntando sin respuesta — este barrido los cierra con un
  // mensaje que manda a revisar el historial (ver utils/trabajos.js).
  iniciarBarridoZombis();
});
