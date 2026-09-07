/**
 * Te avisa por correo cuando a un maestro le falla una generación
 * (7-sep-2026).
 *
 * Por qué existe: hoy, si a alguien le truena un tema, el error se queda
 * en los logs de Render. Nadie lee los logs de Render. En el piloto eso
 * significa que la persona ve un error, no lo reporta (casi nadie
 * reporta), y simplemente no regresa — y tú te enteras semanas después,
 * cuando ya no puedes preguntarle qué estaba haciendo.
 *
 * Con cinco maestros invitados, un correo por falla es exactamente el
 * volumen correcto: te llegan dos o tres en dos semanas, los lees todos,
 * y cada uno trae el tema y el nivel para reproducirlo.
 *
 * Igual que utils/avisoTope.js, todo aquí es "best effort": este archivo
 * no puede tumbar nada. Ya le falló algo al usuario; el aviso no puede
 * ser lo que empeore su error.
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

// Si algo se rompe de verdad (Anthropic caído, una llave vencida), no
// quieres 200 correos: quieres uno y arreglarlo. Se agrupa por tipo de
// falla, no por usuario — 15 minutos entre avisos del mismo tipo.
const ESPERA_MS = 15 * 60 * 1000;
const avisados = new Map();

// Los 402 (se acabó el plan) y 400 (falta el tema) NO son fallas: son el
// sistema funcionando. Solo se avisa de lo que sí está roto.
const NO_SON_FALLAS = new Set([400, 402, 403, 404]);

function escapar(t) {
  return String(t == null ? "" : t)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Agrupa errores parecidos para que el dedupe funcione. */
function firma(mensaje) {
  return String(mensaje || "")
    .replace(/\d+/g, "#")        // ids, tiempos, tamaños
    .slice(0, 80)
    .toLowerCase();
}

/**
 * @param {{correo?:string, tema?:string, nivel?:string, modo?:string, error:Error, status?:number, donde?:string}} datos
 */
function avisarFalla(datos) {
  // Sin await a propósito: al usuario ya se le contestó (con su error).
  (async () => {
    try {
      const status = datos.status || datos.error?.status || 500;
      if (NO_SON_FALLAS.has(Number(status))) return;

      const mensaje = datos.error?.message || String(datos.error || "error desconocido");
      const clave = `${datos.donde || "?"}:${firma(mensaje)}`;
      const ultimo = avisados.get(clave) || 0;
      const repetida = Date.now() - ultimo < ESPERA_MS;

      // El log queda SIEMPRE, aunque el correo se calle por el dedupe:
      // es el respaldo para contar cuántas veces pasó de verdad.
      console.error(`[falla] ${datos.donde || "?"} · ${datos.correo || "sin correo"} · tema="${datos.tema || ""}" · ${mensaje}`);
      if (repetida) return;
      avisados.set(clave, Date.now());

      const correo = clienteResend();
      if (!correo) return;
      await correo.emails.send({
        from: AVISAR_DESDE,
        to: AVISAR_A,
        subject: `🐞 A alguien le falló ${escapar(datos.donde || "una generación")}`,
        html: `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1E3A8A;">
            <p style="margin:0 0 4px;font-size:20px;">🐞 <strong>Falló una generación</strong></p>
            <p style="margin:0 0 16px;color:#4A6A85;font-size:13px;">${escapar(datos.correo || "sin correo")}</p>
            <div style="background:#FDECEC;border-left:4px solid #E05252;border-radius:8px;padding:14px 16px;color:#7A1F1F;">
              <code style="font-size:13px;">${escapar(mensaje)}</code>
            </div>
            <table style="margin:18px 0 0;font-size:14px;color:#1E3A8A;border-collapse:collapse;">
              <tr><td style="padding:3px 14px 3px 0;color:#4A6A85;">Dónde</td><td>${escapar(datos.donde || "—")}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#4A6A85;">Tema</td><td>${escapar(datos.tema || "—")}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#4A6A85;">Nivel</td><td>${escapar(datos.nivel || "—")}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#4A6A85;">Modo</td><td>${escapar(datos.modo || "—")}</td></tr>
              <tr><td style="padding:3px 14px 3px 0;color:#4A6A85;">Código</td><td>${escapar(status)}</td></tr>
            </table>
            <p style="margin:18px 0 0;color:#4A6A85;font-size:13px;">
              Con el tema y el nivel puedes reproducirlo tú misma. Si es un 429 o un 529,
              es saturación de Anthropic y ya se reintentó 3 veces (utils/reintento.js).
            </p>
            <p style="margin:14px 0 0;color:#7089A8;font-size:12px;">
              Fallas iguales se agrupan: máximo un correo cada 15 minutos por tipo de error.
            </p>
          </div>`,
      });
    } catch (err) {
      /* el aviso es un extra; que falle no le importa a nadie más */
    }
  })();
}

module.exports = { avisarFalla };
