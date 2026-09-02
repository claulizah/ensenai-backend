const express = require("express");
const { Resend } = require("resend");
const { requireBuyer } = require("../middleware/auth");
const supabase = require("../db/supabase");

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

// A dónde llegan los comentarios del piloto. Mismo destino que el reenvío
// de contacto@ensenai.com (ver routes/inboundEmail.js).
const AVISAR_A = "claudia.achd@gmail.com";
const AVISAR_DESDE = "EnseñAI <contacto@ensenai.com>";

const MAX_MENSAJE = 4000;
const MAX_POR_VENTANA = 6; // comentarios por usuario…
const VENTANA_MIN = 10; //   …cada 10 minutos

const ETIQUETA = {
  bien: { emoji: "💚", titulo: "Le gustó algo" },
  bug: { emoji: "🐞", titulo: "Reportó una falla" },
};

/** Escapa para meter texto de usuario en el HTML del correo. */
function escapar(texto) {
  return String(texto == null ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * POST /api/feedback
 * body: { tipo: "bien" | "bug", mensaje, pagina, contexto }
 *
 * Guarda el comentario y le manda un correo a Claudia. El reply-to es el
 * correo de quien escribió, así que contestarle es darle "Responder" —
 * durante un piloto eso es la diferencia entre tener conversación y tener
 * una tabla que nadie vuelve a abrir.
 *
 * El correo es "best effort": si Resend falla, el comentario YA quedó
 * guardado y la persona ve su "gracias". Perder el aviso es molesto;
 * perder el comentario de alguien que se tomó la molestia de escribirlo,
 * no se vale.
 */
router.post("/", requireBuyer, async (req, res) => {
  try {
    const { tipo, mensaje, pagina, contexto } = req.body || {};

    if (tipo !== "bien" && tipo !== "bug") {
      return res.status(400).json({ error: "Tipo de comentario inválido." });
    }
    const texto = String(mensaje || "").trim();
    if (!texto) {
      return res.status(400).json({ error: "Escribe tu comentario antes de enviarlo." });
    }
    if (texto.length > MAX_MENSAJE) {
      return res.status(400).json({ error: `El comentario es muy largo (máximo ${MAX_MENSAJE} caracteres).` });
    }

    // Tope suave por usuario: protege de un dedo pegado al botón, no de un
    // atacante (para eso ya está requireBuyer).
    const desde = new Date(Date.now() - VENTANA_MIN * 60 * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .gte("created_at", desde);
    if (countError) throw new Error(countError.message);
    if ((count || 0) >= MAX_POR_VENTANA) {
      return res.status(429).json({
        error: "Ya recibimos varios comentarios tuyos en los últimos minutos. Espera un poco y mándanos el que falta.",
      });
    }

    // Solo se guarda lo que el navegador puede decir de sí mismo (tamaño de
    // pantalla, user agent, url). Nada del contenido de sus temas.
    const ctx = contexto && typeof contexto === "object" ? contexto : {};
    const contextoLimpio = {
      url: String(ctx.url || "").slice(0, 500),
      navegador: String(ctx.navegador || "").slice(0, 300),
      pantalla: String(ctx.pantalla || "").slice(0, 50),
      idioma: String(ctx.idioma || "").slice(0, 20),
    };

    const { data: fila, error } = await supabase
      .from("feedback")
      .insert({
        user_id: req.user.id,
        correo: req.user.email || null,
        tipo,
        mensaje: texto,
        pagina: String(pagina || "").slice(0, 60),
        contexto: contextoLimpio,
      })
      .select("id, created_at")
      .single();
    if (error) throw new Error(error.message);

    const et = ETIQUETA[tipo];
    try {
      await resend.emails.send({
        from: AVISAR_DESDE,
        to: AVISAR_A,
        replyTo: req.user.email || undefined,
        subject: `${et.emoji} ${et.titulo}: ${req.user.email || "alguien"}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:#1E3A8A;">
            <p style="margin:0 0 4px; font-size:20px;">${et.emoji} <strong>${escapar(et.titulo)}</strong></p>
            <p style="margin:0 0 16px; color:#4A6A85; font-size:13px;">
              ${escapar(req.user.email || "sin correo")} · ${escapar(pagina || "página desconocida")}
            </p>
            <div style="background:#F0FDF4; border-left:4px solid #34D399; border-radius:8px; padding:14px 16px; white-space:pre-wrap; color:#065F46;">${escapar(texto)}</div>
            <p style="margin:18px 0 0; color:#4A6A85; font-size:12px;">
              ${escapar(contextoLimpio.navegador)}<br>
              Pantalla ${escapar(contextoLimpio.pantalla)} · ${escapar(contextoLimpio.url)}
            </p>
            <p style="margin:14px 0 0; color:#4A6A85; font-size:12px;">
              Contéstale dándole "Responder" a este correo: le llega directo.
            </p>
          </div>
        `,
      });
    } catch (err) {
      console.error("No se pudo mandar el correo de feedback:", err.message);
    }

    res.json({ status: "recibido", id: fila.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
