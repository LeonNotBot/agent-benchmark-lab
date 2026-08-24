// Adaptive thinking 调用示例（零依赖，Node 18+ 内置 fetch）
// 运行: ANTHROPIC_API_KEY=sk-xxx node scripts/adaptive-thinking-demo.mjs

const API_KEY = process.env.ANTHROPIC_API_KEY;
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

if (!API_KEY) {
  console.error("请先设置环境变量 ANTHROPIC_API_KEY");
  process.exit(1);
}

async function ask(prompt, effort = "high") {
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" }, // 关键：开启自适应思考
      effort,                          // low | medium | high
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const data = await ask("证明根号 2 是无理数");

for (const block of data.content) {
  if (block.type === "thinking") {
    console.log("【思考过程】\n" + block.thinking + "\n");
  } else if (block.type === "text") {
    console.log("【回答】\n" + block.text);
  }
}
