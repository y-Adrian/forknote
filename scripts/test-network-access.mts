/**
 * Unit tests for network access helpers (SSRF + reachability logic).
 */
import assert from "node:assert/strict";
import {
  assertPublicHttpUrl,
  htmlToText,
} from "../sidecar/network.mjs";
import {
  formatNetworkStatusSystem,
  resolveAgentAllowNetwork,
} from "../src/lib/networkAccess.ts";
import {
  NETWORK_OPENAI_TOOLS,
  getProjectOpenAITools,
  agentCallFromOpenAI,
} from "../src/lib/agentTools.ts";

async function testSsrfBlocksPrivate() {
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://localhost/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://[::1]/x"), /private|local/i);
  await assert.rejects(() => assertPublicHttpUrl("http://169.254.169.254/"), /private|local|IP/i);
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"), /http/i);
  await assert.rejects(() => assertPublicHttpUrl("ftp://example.com"), /http/i);
  await assert.rejects(() => assertPublicHttpUrl("not-a-url"), /Invalid URL/i);
  // Positive public hostname check depends on ambient DNS; sandboxes may rewrite
  // public names to private IPs. Accept either success or a clear SSRF/DNS reject.
  try {
    const ok = await assertPublicHttpUrl("https://example.com/path");
    assert.equal(ok.hostname, "example.com");
  } catch (e) {
    assert.match(
      e instanceof Error ? e.message : String(e),
      /private|resolve|blocked/i,
    );
  }
  console.log("ok ssrf blocks private");
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

await testSsrfBlocksPrivate();
testHtmlToText();
testToolsSchema();
testSettingsToggle();
console.log("all network-access tests passed");
