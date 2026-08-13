/**
 * Unit tests for network access helpers (SSRF + reachability logic).
 */
import assert from "node:assert/strict";
import {
  assertPublicHttpUrl,
  hasPublicResolvedAddress,
  htmlToText,
  isPrivateIp,
  STATUS_PROBE_URLS,
} from "../sidecar/network.mjs";
import {
  formatNetworkStatusSystem,
  resolveAgentAllowNetwork,
  estimateWebTaskComplexity,
  resolveWebToolRoundBudget,
  WEB_TOOL_ROUND_BUDGET_SIMPLE,
  WEB_TOOL_ROUND_BUDGET_MULTI,
} from "../src/lib/networkAccess.ts";
import {
  NETWORK_OPENAI_TOOLS,
  getProjectOpenAITools,
  agentCallFromOpenAI,
  buildNetworkToolsSystem,
} from "../src/lib/agentTools.ts";

function testPrivateIpClassification() {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("10.0.0.1"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("169.254.169.254"), true);
  assert.equal(isPrivateIp("100.64.0.1"), true);
  assert.equal(isPrivateIp("0.0.0.0"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("fdfe:dcba:9876::b"), true); // ULA / fake-IP v6
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  // Public / proxy fake-IP v4 must stay non-private so dual-stack lookups work.
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("198.18.0.10"), false);
  assert.equal(isPrivateIp("1.1.1.1"), false);
  console.log("ok private IP classification");
}

function testHasPublicResolvedAddress() {
  // Clash-style dual stack: public-ish A + private AAAA → allow
  assert.equal(
    hasPublicResolvedAddress([
      { address: "198.18.0.10" },
      { address: "fdfe:dcba:9876::b" },
    ]),
    true,
  );
  // Pure private → block
  assert.equal(
    hasPublicResolvedAddress([
      { address: "127.0.0.1" },
      { address: "::1" },
    ]),
    false,
  );
  // Pure public → allow
  assert.equal(
    hasPublicResolvedAddress([{ address: "93.184.216.34" }]),
    true,
  );
  assert.equal(hasPublicResolvedAddress([]), false);
  console.log("ok hasPublicResolvedAddress any-public rule");
}

async function testSsrfBlocksPrivate() {
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://localhost/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://[::1]/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://169.254.169.254/"), /private|local|IP/i);
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"), /http/i);
  await assert.rejects(() => assertPublicHttpUrl("ftp://example.com"), /http/i);
  await assert.rejects(() => assertPublicHttpUrl("not-a-url"), /Invalid URL/i);

  // Hostname lookup: with any-public rule, ambient fake-IP dual-stack should
  // allow example.com when at least one address is non-private (198.18.x).
  const ok = await assertPublicHttpUrl("https://example.com/path");
  assert.equal(ok.hostname, "example.com");
  console.log("ok ssrf blocks private + allows dual-stack public hosts");
}

function testHtmlToText() {
  const text = htmlToText(
    "<html><script>evil()</script><h1>Hello</h1><p>World &amp; friends</p></html>",
  );
  assert.match(text, /Hello/);
  assert.match(text, /World & friends/);
  assert.doesNotMatch(text, /evil/);
  console.log("ok htmlToText");
}

function testToolsSchema() {
  const names = NETWORK_OPENAI_TOOLS.map((t) => t.function.name).sort();
  assert.deepEqual(names, ["web_fetch", "web_search"]);
  const withNet = getProjectOpenAITools({ allowNetwork: true });
  assert.ok(withNet.some((t) => t.function.name === "web_search"));
  const without = getProjectOpenAITools({ allowNetwork: false });
  assert.ok(!without.some((t) => t.function.name === "web_search"));

  const call = agentCallFromOpenAI({
    id: "1",
    type: "function",
    function: {
      name: "web_fetch",
      arguments: JSON.stringify({ url: "https://example.com" }),
    },
  });
  assert.equal(call?.tool, "web_fetch");
  assert.equal(call?.url, "https://example.com");
  console.log("ok tools schema");
}

function testSettingsToggle() {
  assert.equal(resolveAgentAllowNetwork({} as never), false);
  assert.equal(
    resolveAgentAllowNetwork({
      baseUrl: "",
      apiKey: "",
      model: "",
      useProxy: true,
      agentAllowNetwork: true,
    }),
    true,
  );
  const off = formatNetworkStatusSystem(
    {
      wanted: false,
      browserOnline: true,
      probedOnline: null,
      toolsAllowed: false,
      reason: "off",
    },
    "zh",
  );
  assert.match(off, /未开启联网/);
  const offline = formatNetworkStatusSystem(
    {
      wanted: true,
      browserOnline: false,
      probedOnline: null,
      toolsAllowed: false,
      reason: "offline",
    },
    "zh",
  );
  assert.match(offline, /不可用|离线/);
  console.log("ok settings toggle messaging");
}

function testWhenToSearchPromptRules() {
  const zh = formatNetworkStatusSystem(
    {
      wanted: true,
      browserOnline: true,
      probedOnline: true,
      toolsAllowed: true,
      reason: "ok",
    },
    "zh",
  );
  assert.match(zh, /何时搜索/);
  assert.match(zh, /何时不搜索/);
  assert.match(zh, /例1/);
  assert.match(zh, /无独立分类器|由你（主模型）/);
  assert.match(zh, /Reflect/);

  const en = formatNetworkStatusSystem(
    {
      wanted: true,
      browserOnline: true,
      probedOnline: true,
      toolsAllowed: true,
      reason: "ok",
    },
    "en",
  );
  assert.match(en, /When to search/i);
  assert.match(en, /When not to/i);
  assert.match(en, /Ex1/);
  assert.match(en, /no separate classifier/i);
  assert.match(en, /Reflect/);

  assert.match(zh, /!\[描述\]\(url\)/);
  assert.match(zh, /无法显示图片/);
  assert.match(en, /!\[description\]\(url\)/);
  assert.match(en, /cannot show images/i);

  const toolsZh = buildNetworkToolsSystem("zh");
  assert.match(toolsZh, /是否搜索/);
  assert.match(toolsZh, /搜几次/);
  assert.match(toolsZh, /例：/);
  assert.match(toolsZh, /!\[描述\]\(url\)/);
  const toolsEn = buildNetworkToolsSystem("en");
  assert.match(toolsEn, /Whether to search/i);
  assert.match(toolsEn, /How many/i);
  assert.match(toolsEn, /!\[description\]\(url\)/);
  console.log("ok when-to-search prompt rules");
}

function testWebComplexityBudget() {
  assert.equal(estimateWebTaskComplexity("什么是递归？"), "simple");
  assert.equal(
    estimateWebTaskComplexity("对比 React 与 Vue 2024 生态并列出多方来源"),
    "multi",
  );
  assert.equal(WEB_TOOL_ROUND_BUDGET_SIMPLE, 8);
  assert.equal(WEB_TOOL_ROUND_BUDGET_MULTI, 16);
  assert.equal(resolveWebToolRoundBudget("simple", 50), WEB_TOOL_ROUND_BUDGET_SIMPLE);
  assert.equal(resolveWebToolRoundBudget("multi", 50), WEB_TOOL_ROUND_BUDGET_MULTI);
  assert.equal(resolveWebToolRoundBudget("simple", 12), WEB_TOOL_ROUND_BUDGET_SIMPLE);
  assert.equal(resolveWebToolRoundBudget("multi", 12), 12);
  assert.equal(resolveWebToolRoundBudget("multi", 2), 2);
  assert.equal(resolveWebToolRoundBudget("simple", 4), 4);
  console.log("ok web complexity budget");
}

function testStatusProbesAreHeadlessFetchOnly() {
  assert.ok(Array.isArray(STATUS_PROBE_URLS) && STATUS_PROBE_URLS.length >= 2);
  for (const url of STATUS_PROBE_URLS) {
    assert.match(url, /^https:\/\//);
    assert.doesNotMatch(url, /google\.com|gstatic\.com/i);
  }
  console.log("ok /net/status probes are https-only and non-Google");
}

await testPrivateIpClassification();
testHasPublicResolvedAddress();
await testSsrfBlocksPrivate();
testHtmlToText();
testToolsSchema();
testSettingsToggle();
testWhenToSearchPromptRules();
testWebComplexityBudget();
testStatusProbesAreHeadlessFetchOnly();
console.log("all network-access tests passed");
