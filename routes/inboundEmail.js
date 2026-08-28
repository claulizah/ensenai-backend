const { Webhook } = require("svix");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// A dónde reenviamos lo que llegue a cualquier dirección @ensenai.com
// (contacto@, soporte@, etc. — "Enable Receiving" en el dominio de Resend
// acepta cualquier usuario en @ensenai.com, no solo uno). Hoy solo hay un
// destino: el correo personal de Claudia. Si más adelante hay más gente
// en el equipo, esto se puede volver un mapeo por dirección de destino
// (usando event.data.to).
const REENVIAR_A = "claudia.achd@gmail.com";
const REENVIAR_DESDE = "EnseñAI <contacto@ensenai.com>";

/**
 * POST /api/inbound/webhook
 *
 * Webhook de "Receiving" de Resend: cuando llega un correo a cualquier
 * dirección @ensenai.com, Resend lo recibe, lo guarda, y nos manda este
 * evento con el `email_id` (el webhook NO incluye el cuerpo del correo,
 * solo metadata — hay que pedirlo aparte, y por eso usamos el helper
 * `forward()` del SDK que ya se encarga de bajar el contenido original y
 * reenviarlo). Así, cualquiera que le escriba a contacto@ensenai.com le
 * llega directo al Gmail personal, sin que haya que revisar una bandeja
 * de entrada aparte — le da cara profesional al dominio sin montar un
 * correo real.
 *
 * Requiere el body RAW (sin parsear por express.json) para poder
 * verificar la firma de Svix con la que Resend firma sus webhooks — por
 * eso se registra en server.js con express.raw(), igual que el webhook
 * de Stripe (ver routes/stripeWebhook.js).
 */
async function inboundEmailWebhookHandler(req, res) {
  let event;
  try {
    const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
    event = wh.verify(req.body, {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    });
  } catch (err) {
    console.error("Firma de webhook de Resend inválida:", err.message);
    return res.status(400).json({ error: "Firma inválida." });
  }

  try {
    if (event.type === "email.received") {
      const { error } = await resend.emails.receiving.forward({
        emailId: event.data.email_id,
        to: REENVIAR_A,
        from: REENVIAR_DESDE,
      });
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    // A diferencia del webhook de Stripe, aquí no hay un cobro en juego —
    // en el peor caso se pierde un correo. Lo dejamos en los logs de
    // Render para poder revisarlo, pero respondemos 200 para que Resend
    // no reintente el mismo correo indefinidamente.
    console.error("Error reenviando correo entrante:", err.message);
  }

  res.json({ received: true });
}

module.exports = { inboundEmailWebhookHandler };
