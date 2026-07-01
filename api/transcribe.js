// api/transcribe.js  — Vercel Serverless Function (Node 18+)
// 役割: クライアントから受け取った音声(base64)を Groq Whisper に中継し、
//       文字起こしテキストを返す。GROQ_API_KEY は環境変数で秘匿。
//
// デプロイ:
//   1) このファイルを プロジェクト直下 /api/transcribe.js に置く
//   2) Vercel の Project Settings → Environment Variables に
//      GROQ_API_KEY = (GroqCloudのAPIキー) を追加
//   3) デプロイすると POST /api/transcribe が使えるようになる

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

const STT_MODEL = "whisper-large-v3-turbo"; // 高速・低コスト。精度優先なら "whisper-large-v3"

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set" });

  try {
    const { audio, mime } = req.body || {};
    if (!audio) return res.status(400).json({ error: "no audio" });

    const buf = Buffer.from(audio, "base64");
    const type = mime || "audio/webm";
    const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "mp4" : type.includes("wav") ? "wav" : "webm";

    const form = new FormData();
    form.append("file", new Blob([buf], { type }), "audio." + ext);
    form.append("model", STT_MODEL);
    form.append("language", "en");
    form.append("response_format", "json");
    form.append("temperature", "0");

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "groq_stt_error", detail });
    }
    const j = await r.json();
    return res.status(200).json({ text: (j.text || "").trim() });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
