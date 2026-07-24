/**
 * Smoke: Vite /openai middleware must route by X-Forknote-Target (not a fixed host).
 * Run with `npm run dev:web` (or `npm run dev`) already listening on :5173.
 *
 *   npx tsx scripts/smoke-openai-proxy.mts
 */
const BASE = process.env.FORKNOTE_DEV_URL ?? "http://127.0.0.1:5173";

async function post(
  path: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{ status: number; text: string; server?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, server: res.headers.get("server") ?? undefined };
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const chatBody = {
  model: "qwen2.5-coder:7b",
  messages: [{ role: "user", content: "hi" }],
  stream: false,
  max_tokens: 5,
};

// 1) Missing target → 502 misconfigured (never silent DeepSeek)
{
  const r = await post("/openai/chat/completions", {}, chatBody);
  assert(r.status === 502, `missing target expected 502, got ${r.status}: ${r.text}`);
  assert(
    r.text.includes("X-Forknote-Target"),
    `502 body should mention X-Forknote-Target: ${r.text}`,
  );
  console.log("ok: missing target → 502");
}

// 2) Ollama target → upstream Ollama (not DeepSeek governor 401)
{
  const r = await post(
    "/openai/chat/completions",
    { "X-Forknote-Target": "http://127.0.0.1:11434/v1" },
    chatBody,
  );
  assert(
    r.status !== 401 || !r.text.includes("governor"),
    `Ollama must not hit DeepSeek governor: ${r.status} ${r.text}`,
  );
  assert(
    r.status === 200,
    `Ollama proxy expected 200, got ${r.status}: ${r.text.slice(0, 300)}`,
  );
  assert(
    r.text.includes("chat.completion") || r.text.includes("choices"),
    `Ollama body should look like chat completion: ${r.text.slice(0, 200)}`,
  );
  console.log("ok: Ollama X-Forknote-Target → local model");
}

// 3) Path prefix preserved for versioned roots
{
  const r = await post(
    "/openai/chat/completions",
    { "X-Forknote-Target": "http://127.0.0.1:11434" },
    chatBody,
  );
  assert(
    r.status === 200,
    `normalize /v1 expected 200, got ${r.status}: ${r.text.slice(0, 300)}`,
  );
  console.log("ok: base without /v1 still routes to Ollama /v1");
}

console.log("smoke-openai-proxy: all passed");
