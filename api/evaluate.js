// api/evaluate.js  — Vercel Serverless Function (Node 18+)
// 役割: 3タスク(音読/リテル/自由発話)の文字起こし＋客観指標を Groq LLM に渡し、
//       CEFRルーブリックで5観点(発音/流暢さ/文法/語彙/一貫性)＋総合を JSON で返す。
//
// デプロイ: /api/evaluate.js に置く。GROQ_API_KEY 環境変数を共有。

const LLM_MODEL = "llama-3.3-70b-versatile"; // 評価用。差し替え可(例: meta-llama/llama-4-scout-17b-16e-instruct)

const SYSTEM = `あなたは CEFR に精通した英語スピーキング試験官です。
受験者の3タスク（音読 read / リテル retell / 自由発話 free）の文字起こしと客観指標をもとに、
発音・流暢さ・文法・語彙・一貫性 の5観点を CEFR(A1〜C1) で評価し、総合CEFRとスコアを出します。

評価の指針:
- 発音: 主に音読タスクの accuracy(正しく読めた語の割合) と、全体の聞き取りやすさ(文字起こしの崩れ具合)から推定。音素レベルの精査はできないため過度に断定しない。
- 流暢さ: wpm(話速) と wordCount/duration、言い淀み・不自然な繰り返しの有無から。目安 wpm 60未満=A2以下, 60-90=B1, 90-120=B2, 120+=C1寄り(内容次第)。
- 文法: retell と free の文構造の正確さ・多様さ(時制/従属節/複文)。
- 語彙: 使用語彙の幅と適切さ。定型表現だけか、抽象語・言い換えができるか。
- 一貫性: 話の筋・つながり(接続表現、論理展開)。retell は元文の要点をどれだけ再現できたか。

注意:
- 文字起こしは自動生成のため多少の誤りを含む。明らかな認識ミスは受験者の誤りと断定しない。
- 各 note と summary, strengths, improvements は必ず日本語で、具体的かつ簡潔に。
- 出力は指定JSONのみ。前置きや\`\`\`は付けない。`;

function buildUserPrompt(tasks) {
  const blocks = tasks.map((t, i) => {
    const wpm = t.durationSec ? Math.round((t.wordCount / t.durationSec) * 60) : 0;
    const lines = [
      `[Task ${i + 1}] type=${t.type}`,
      t.target ? `target(音読原文): ${t.target}` : null,
      t.prompt ? `prompt(トピック): ${t.prompt}` : null,
      t.source ? `source(リテル元文): ${t.source}` : null,
      typeof t.accuracy === "number" ? `read_accuracy: ${(t.accuracy * 100).toFixed(0)}%` : null,
      `duration_sec: ${t.durationSec}  word_count: ${t.wordCount}  wpm: ${wpm}`,
      `transcript: ${t.transcript || "(無音/認識なし)"}`,
    ].filter(Boolean);
    return lines.join("\n");
  });
  return `以下を評価してください。\n\n${blocks.join("\n\n")}\n\n` +
`必ず次のJSON形式のみで返答:
{
  "overallCEFR": "A1|A2|B1|B2|C1",
  "overallScore": 0-1000,
  "dimensions": {
    "発音":   {"cefr":"A1|A2|B1|B2|C1","score":0-100,"note":"日本語で1文"},
    "流暢さ": {"cefr":"","score":0-100,"note":""},
    "文法":   {"cefr":"","score":0-100,"note":""},
    "語彙":   {"cefr":"","score":0-100,"note":""},
    "一貫性": {"cefr":"","score":0-100,"note":""}
  },
  "strengths": ["日本語で1〜2点"],
  "improvements": ["日本語で1〜2点"],
  "summary": "日本語で2文以内の総評"
}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not set" });
  // 任意の保護: ALLOWED_ORIGIN を設定すると、そのオリジン以外からの呼び出しを拒否
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) {
    const origin = req.headers.origin || req.headers.referer || "";
    if (!origin.startsWith(allowed)) return res.status(403).json({ error: "forbidden" });
  }

  try {
    const { tasks } = req.body || {};
    if (!tasks || !tasks.length) return res.status(400).json({ error: "no tasks" });

    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildUserPrompt(tasks) },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "groq_llm_error", detail });
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content || "{}";
    let data;
    try { data = JSON.parse(content); }
    catch (e) { return res.status(502).json({ error: "parse_error", raw: content }); }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
