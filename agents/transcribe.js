const fs = require("fs");

/**
 * Agente de transcripción.
 *
 * Usa la API de Whisper (OpenAI) — elegido por buen soporte multi-idioma
 * (incluido español) y precio bajo (~$0.006/min) para el volumen esperado.
 *
 * Requiere OPENAI_API_KEY en tu .env. Mientras no esté configurada, regresa
 * un texto de prueba para poder probar el resto del flujo sin depender de
 * una API externa.
 *
 * @param {string} videoPath - ruta local del video subido
 * @returns {Promise<{ text: string }>}
 */
async function transcribeVideo(videoPath) {
  const provider = process.env.TRANSCRIPTION_PROVIDER;

  if (provider !== "whisper") {
    console.warn(
      "[transcribe] TRANSCRIPTION_PROVIDER no está en 'whisper' — regresando transcripción de prueba."
    );
    return {
      text: "Esta es una transcripción de prueba. Configura TRANSCRIPTION_PROVIDER=whisper y OPENAI_API_KEY en .env para usar transcripción real.",
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Falta OPENAI_API_KEY en tu .env para usar Whisper.");
  }

  const fileBuffer = fs.readFileSync(videoPath);
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), "video.mp4");
  form.append("model", "whisper-1");
  form.append("language", "es"); // los videos de EnseñAI son en español

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Error de Whisper API (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return { text: data.text };
}

module.exports = { transcribeVideo };
