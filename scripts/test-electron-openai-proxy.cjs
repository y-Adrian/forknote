const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const appRoot = process.env.FORKNOTE_PACKAGED_ROOT
  ? path.resolve(process.env.FORKNOTE_PACKAGED_ROOT)
  : path.resolve(__dirname, "..");
const {
  assertSafeApiTarget,
  isBlockedIp,
  isPrivateLanIp,
  parseApiTarget,
} = require(path.join(appRoot, "shared", "apiTargetPolicy.cjs"));
const { startUiServer } = require(path.join(appRoot, "electron", "uiServer.cjs"));

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function firstPrivateLanIpv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family === "IPv4" || entry.family === 4;
      if (family && !entry.internal && isPrivateLanIp(entry.address)) {
        return entry.address;
      }
    }
  }
  return null;
}

async function post(origin, target, apiKey = "secret-test-key") {
  const res = await fetch(`${origin}/openai/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Forknote-Target": target,
    },
    body: JSON.stringify({ model: "local-test", messages: [] }),
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  assert.equal(
    isBlockedIp("198.18.0.10"),
    false,
    "VPN fake-IP range must not be treated as blocked special-use",
  );
  assert.equal(isBlockedIp("192.168.1.20"), true);
  assert.equal(isBlockedIp("127.0.0.1"), true);

  const publicTarget = await assertSafeApiTarget(
    "https://api.placeholder.example/openai/v1",
    {
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    },
  );
  assert.equal(publicTarget.url.pathname, "/openai/v1");
  assert.deepEqual(publicTarget.addresses, [
    { address: "93.184.216.34", family: 4 },
  ]);

  for (const allowed of [
    "http://127.0.0.1:11434/v1",
    "http://localhost:11434/v1",
    "http://[::1]:11434/v1",
    "http://192.168.1.20:1234/v1",
    "http://10.0.0.7:1234/v1",
    "http://172.16.4.8:1234/v1",
    "http://[fd12:3456:789a::1]:1234/v1",
  ]) {
    const result = await assertSafeApiTarget(allowed, {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    assert.ok(result.addresses.length > 0, allowed);
  }

  for (const blocked of [
    "http://169.254.169.254/latest/meta-data",
    "http://metadata.google.internal/computeMetadata/v1",
    "http://metadata/latest",
    "http://0.0.0.0/v1",
    "http://224.0.0.1/v1",
    "http://2130706433/v1",
    "http://0x7f000001/v1",
    "http://0177.0.0.1/v1",
    "http://[::ffff:127.0.0.1]/v1",
    "http://[::ffff:192.168.1.20]/v1",
    "http://user:pass@api.example.com/v1",
  ]) {
    await assert.rejects(
      () => assertSafeApiTarget(blocked),
      (err) => err?.code === "ERR_UNSAFE_API_TARGET",
      blocked,
    );
  }

  await assert.rejects(
    () =>
      assertSafeApiTarget("http://rebinding.example/v1", {
        lookup: async () => [{ address: "192.168.1.20", family: 4 }],
      }),
    (err) =>
      err?.code === "ERR_UNSAFE_API_TARGET" &&
      /private or special-use/i.test(err.message),
    "hostname resolving to private LAN must stay blocked",
  );

  // VPN fake-IP: public API host → 198.18 (+ optional ULA) must be allowed so
  // desktop /openai works; web_search still uses sidecar /net/search separately.
  const fakeIpOnly = await assertSafeApiTarget(
    "https://api.placeholder.example/v1",
    {
      lookup: async () => [{ address: "198.18.0.10", family: 4 }],
    },
  );
  assert.deepEqual(fakeIpOnly.addresses, [
    { address: "198.18.0.10", family: 4 },
  ]);

  const fakeIpDual = await assertSafeApiTarget(
    "https://api.placeholder.example/v1",
    {
      lookup: async () => [
        { address: "198.18.0.10", family: 4 },
        { address: "fdfe:dcba:9876::9", family: 6 },
      ],
    },
  );
  assert.deepEqual(fakeIpDual.addresses, [
    { address: "198.18.0.10", family: 4 },
  ]);

  await assert.rejects(
    () =>
      assertSafeApiTarget("https://ula-only.example/v1", {
        lookup: async () => [{ address: "fdfe:dcba:9876::9", family: 6 }],
      }),
    (err) => err?.code === "ERR_UNSAFE_API_TARGET",
    "ULA-only resolution must stay blocked",
  );

  assert.throws(
    () => parseApiTarget("file:///tmp/model.sock"),
    /HTTP\(S\)/i,
  );

  let allowedRequest;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      allowedRequest = {
        path: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true,"source":"loopback"}');
    });
  });
  const upstreamPort = await listen(upstream);

  let lanRequest;
  const lanIp = firstPrivateLanIpv4();
  let lanUpstream;
  let lanPort;
  if (lanIp) {
    lanUpstream = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        lanRequest = {
          path: req.url,
          authorization: req.headers.authorization,
          body: Buffer.concat(chunks).toString("utf8"),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true,"source":"private-lan"}');
      });
    });
    lanPort = await listen(lanUpstream, lanIp);
  }

  let blockedUpstreamHit = false;
  const blockedUpstream = http.createServer((_req, res) => {
    blockedUpstreamHit = true;
    res.writeHead(500).end();
  });
  const blockedPort = await listen(blockedUpstream);

  const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "forknote-ui-proxy-"));
  await fs.writeFile(path.join(distDir, "index.html"), "<!doctype html><title>test</title>");

  const { server: uiServer, origin } = await startUiServer({
    distDir,
    host: "127.0.0.1",
    port: 0,
    sidecarToken: "test-sidecar-token",
    apiTargetLookup: async (hostname) => {
      if (hostname === "blocked.example") {
        return [{ address: "127.0.0.1", family: 4 }];
      }
      if (hostname === "lan-rebinding.example") {
        return [{ address: "192.168.1.20", family: 4 }];
      }
      throw new Error(`unexpected lookup: ${hostname}`);
    },
  });

  try {
    const local = await post(
      origin,
      `http://127.0.0.1:${upstreamPort}/models/llama/v1`,
      "local-model-key",
    );
    assert.equal(local.status, 200, local.body);
    assert.match(local.body, /"source":"loopback"/);
    assert.equal(allowedRequest.path, "/models/llama/v1/chat/completions");
    assert.equal(allowedRequest.authorization, "Bearer local-model-key");
    assert.match(allowedRequest.body, /"local-test"/);

    if (lanIp && lanPort) {
      const lan = await post(
        origin,
        `http://${lanIp}:${lanPort}/models/lab/v1`,
        "lan-model-key",
      );
      assert.equal(lan.status, 200, lan.body);
      assert.match(lan.body, /"source":"private-lan"/);
      assert.equal(lanRequest.path, "/models/lab/v1/chat/completions");
      assert.equal(lanRequest.authorization, "Bearer lan-model-key");
    } else {
      console.log(
        "test-electron-openai-proxy: skipping live private-LAN proxy hop (no RFC1918 iface)",
      );
    }

    for (const blocked of [
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/v1",
      "http://2130706433/v1",
      `http://blocked.example:${blockedPort}/v1`,
      `http://lan-rebinding.example:${blockedPort}/v1`,
    ]) {
      const result = await post(origin, blocked, "must-not-leak");
      assert.equal(result.status, 403, `${blocked}: ${result.body}`);
      assert.match(result.body, /blocked unsafe API target/i);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      blockedUpstreamHit,
      false,
      "Authorization header reached a DNS-resolved blocked upstream",
    );
  } finally {
    await Promise.all(
      [
        close(uiServer),
        close(upstream),
        close(blockedUpstream),
        lanUpstream ? close(lanUpstream) : Promise.resolve(),
      ],
    );
    await fs.rm(distDir, { recursive: true, force: true });
  }

  console.log("test-electron-openai-proxy: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
