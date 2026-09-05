/**
 * Avisa cuando alguien toca el techo de uso justo (5-sep-2026).
 *
 * Que una cuenta llegue al tope de un plan Ilimitado es raro y es
 * información valiosa: casi siempre es una de tres cosas —
 *
 *   · una cuenta compartida entre mucha gente (una escuela entera),
 *   · un script desbocado,
 *   · o un cliente de verdad grande, al que conviene subirle el tope
 *     antes de que se moleste.
 *
 * Las tres quieren que TÚ te enteres el mismo día, no a fin de mes cuando
 * llegue la factura de la API.
 *
 * Todo aquí es "best effort": si Resend falla, si no hay llave, si el
 * correo rebota — al usuario no le pasa nada. Este archivo jamás debe
 * poder tumbar una generación.
 */

const { Resend } = require("resend");

let cliente = null;
function clienteResend() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!cliente) cliente = new Resend(process.env.RESEND_API_KEY);
  return cliente;
}

const AVISAR_A = "claudia.achd@gmail.com";
const AVISAR_DESDE = "EnseñAI <contacto@ensenai.com>";

// Para no mandar veinte correos si la persona sigue dándole al botón:
// uno por cuenta cada 12 horas es suficiente para enterarse.
const ESPERA_MS = 12 * 60 * 60 * 1000;
const avisados = new Map();

function escapar(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * @param {{correo?:string, usados:number, tope:number, tipo:"individual"|"grupo"}} datos
 */
function avisarTopeJusto(datos) {
  // A propósito NO se espera (sin await): el usuario ya recibió su
  // respuesta y no tiene por qué esperar a que salga un correo.
  (async () => {
    try {
      const clave = `${datos.tipo}:${datos.correo || "sin-correo"}`;
      const ultimo = avisados.get(clave) || 0;
      if (Date.now() - ultimo < ESPERA_MS) return;
      avisados.set(clave, Date.now());

      // Queda en los logs de Render aunque el correo no salga: es el
      // respaldo si algún día Resend está caído justo ese día.
      console.warn(
        `[tope justo] ${datos.correo || "sin correo"} llegó a ${datos.usados}/${datos.tope} temas (${datos.tipo})`
      );

      const correo = clienteResend();
      if (!correo) return;
      await correo.emails.send({
        from: AVISAR_DESDE,
        to: AVISAR_A,
        subject: `🚦 Alguien tocó el tope de uso justo (${datos.usados} temas)`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1E3A8A;">
            <p style="margin:0 0 4px;font-size:20px;">🚦 <strong>Tope de uso justo alcanzado</strong></p>
            <p style="margin:0 0 16px;color:#4A6A85;font-size:13px;">Plan ${escapar(datos.tipo)} · ${escapar(datos.correo || "sin correo")}</p>
            <div style="background:#FDF3E0;border-left:4px solid #F5A524;border-radius:8px;padding:14px 16px;color:#7A4E00;">
              Lleva <strong>${datos.usados}</strong> temas este mes, con el tope en <strong>${datos.tope}</strong>.
            </div>
            <p style="margin:18px 0 0;color:#4A6A85;font-size:13px;">
              Suele ser una de tres: una cuenta compartida entre mucha gente, un script, o un
              cliente grande de verdad. Si es lo tercero, súbele el tope en
              <code>platform_settings.tope_justo_temas_${escapar(datos.tipo)}</code> y avísale
              — no hace falta desplegar nada.
            </p>
            <p style="margin:14px 0 0;color:#7089A8;font-size:12px;">
              Este aviso se manda como máximo una vez cada 12 horas por cuenta.
            </p>
          </div>`,
      });
    } catch (err) {
      /* el aviso es un extra; que falle no le importa a nadie más */
    }
  })();
}

module.exports = { avisarTopeJusto };
