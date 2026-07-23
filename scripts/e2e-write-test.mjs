/**
 * E2E: sidecar write + client-side tool parsing against code-test.
 * Usage: node scripts/e2e-write-test.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const SIDECAR = "http://127.0.0.1:8787";
const PROJECT = "/Users/debris/cursor/code-test";

async function json(res) {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || text || res.status);
  return data;
}

async function write(rel, content) {
  return json(
    await fetch(`${SIDECAR}/fs/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: rel, content }),
    }),
  );
}

// Minimal mirror of collectToolCalls / extractWriteIntentsFromMarkdown
function normalizeRelPath(input) {
  let s = input.trim().replace(/\\/g, "/");
  if (!s || s === ".") return s || ".";
  while (s.startsWith("./")) s = s.slice(2);
  if (s.startsWith("/") && !s.startsWith("//")) s = s.replace(/^\/+/, "");
  return s || ".";
}

function extractWriteIntentsFromMarkdown(text) {
  const calls = [];
  const seen = new Set();
  const push = (pathRaw, content) => {
    const p = normalizeRelPath(pathRaw.replace(/^[`"'[{<]+|[`"'\]}>]+$/g, ""));
    if (!p || p === "." || !content.trim()) return;
    if (!/[./]/.test(p) && !/\.\w+$/.test(p)) return;
    if (seen.has(p)) return;
    seen.add(p);
    calls.push({ tool: "write_file", path: p, content });
  };
  const fenceWithPath = /```[\w+-]*(?:[ \t]+|:|=)([^\n`]+)\n([\s\S]*?)```/g;
  let fm;
  while ((fm = fenceWithPath.exec(text)) !== null) {
    const info = fm[1]
      .trim()
      .replace(/^path\s*=\s*/i, "")
      .replace(/^file\s*=\s*/i, "");
    if (!/[./\\]/.test(info) && !/\.\w{1,8}$/.test(info)) continue;
    push(info.split(/\s+/)[0], fm[2] ?? "");
  }
  const headerFence =
    /(?:^|\n)(?:File|文件|路径|Path)\s*[:：]\s*([^\n]+)\n\s*```[\w+-]*\n([\s\S]*?)```/gi;
  while ((fm = headerFence.exec(text)) !== null) {
    push(fm[1].trim(), fm[2] ?? "");
  }
  return calls;
}

function parseToolCalls(text) {
  const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  const TOOL_CONTENT_RE =
    /<tool_content(?:\s+path="([^"]*)")?\s*>\s*([\s\S]*?)\s*<\/tool_content>/gi;
  const contents = [];
  let cm;
  const contentRe = new RegExp(TOOL_CONTENT_RE.source, TOOL_CONTENT_RE.flags);
  while ((cm = contentRe.exec(text)) !== null) {
    contents.push({ path: cm[1]?.trim(), body: cm[2] ?? "" });
  }
  const calls = [];
  let m;
  const re = new RegExp(TOOL_CALL_RE.source, TOOL_CALL_RE.flags);
  let contentIdx = 0;
  while ((m = re.exec(text)) !== null) {
    let call;
    try {
      const obj = JSON.parse(m[1].trim());
      call = {
        tool: obj.tool,
        path: obj.path,
        content: obj.content,
      };
    } catch {
      continue;
    }
    if (call.tool === "write_file" && typeof call.content !== "string") {
      const next = contents[contentIdx++];
      if (next) call.content = next.body;
    }
    if (call.path) call.path = normalizeRelPath(call.path);
    calls.push(call);
  }
  return calls;
}

function collectToolCalls(text) {
  const explicit = parseToolCalls(text);
  if (explicit.length > 0) return explicit;
  return extractWriteIntentsFromMarkdown(text);
}

async function main() {
  const health = await json(await fetch(`${SIDECAR}/health`));
  console.log("health", health);
  if (health.root !== PROJECT) {
    await json(
      await fetch(`${SIDECAR}/project/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: PROJECT }),
      }),
    );
    console.log("opened", PROJECT);
  }

  // 1) Direct write
  await write("forknote-e2e/direct.txt", "direct\n");
  console.log("direct write OK");

  // 2) tool_call + tool_content style
  const xml = `<tool_call>{"tool":"write_file","path":"soft/soft.c"}</tool_call>
<tool_content>
#include <stdio.h>
int main(void) { return 0; }
</tool_content>`;
  const xmlCalls = collectToolCalls(xml);
  console.log("xml calls", xmlCalls);
  if (xmlCalls.length !== 1 || !xmlCalls[0].content?.includes("stdio")) {
    throw new Error("xml parse failed");
  }
  await write(xmlCalls[0].path, xmlCalls[0].content);
  console.log("xml write OK ->", path.join(PROJECT, xmlCalls[0].path));

  // 3) Markdown-only (what models often emit)
  const md = `【1】创建软法程序

\`\`\`c soft/main.c
#include <stdio.h>
int main(void) {
  printf("soft\\n");
  return 0;
}
\`\`\`
`;
  const mdCalls = collectToolCalls(md);
  console.log("md calls", mdCalls.map((c) => ({ path: c.path, n: c.content.length })));
  if (mdCalls.length !== 1) throw new Error("md parse failed: " + JSON.stringify(mdCalls));
  await write(mdCalls[0].path, mdCalls[0].content);
  console.log("md write OK ->", path.join(PROJECT, mdCalls[0].path));

  const soft = await fs.readFile(path.join(PROJECT, "soft/soft.c"), "utf8");
  const mainC = await fs.readFile(path.join(PROJECT, "soft/main.c"), "utf8");
  console.log("verified soft.c bytes", Buffer.byteLength(soft));
  console.log("verified main.c bytes", Buffer.byteLength(mainC));
  console.log("ALL PASS");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
