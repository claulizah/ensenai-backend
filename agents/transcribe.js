const fs = require("fs");
const os = require("os");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Extrae solo el audio del video, comprimido, para que quepa en el
 * límite de 25MB de Whisper incluso con videos de hasta ~10 minutos.
 */
function extraerAudio(videoPath) {
  return new Promise((resolve, reject) => {
    const audioPath = path.join(os.tmpdir(), `audio-${Date.now()}.mp3`);
    ffmpeg(videoPath)
      .noVideo()
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .on("error", (err) => reject(new Error(`Error extrayendo audio: ${err.message}`)))
      .on("end", () => resolve(audioPath))
      .save(audioPath);
  });
}

/**
 * Agente de transcripción — usa Whisper (OpenAI).
 * Requiere OPENAI_API_KEY y TRANSCRIPTION_PROVIDER=whisper en .env.
 * Sin esa config, regresa un texto de prueba para no bloquear el resto del flujo.
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

  let audioPath;
  try {
    audioPath = await extraerAudio(videoPath);

    const fileBuffer = fs.readFileSync(audioPath);
    const form = new FormData();
    form.append("file", new Blob([fileBuffer]), "audio.mp3");
    form.append("model", "whisper-1");
    form.append("language", "es");

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
  } finally {
    if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
  }
}

module.exports = { transcribeVideo };
