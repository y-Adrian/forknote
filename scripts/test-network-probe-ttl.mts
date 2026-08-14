/**
 * Probe #363: /net/status reachability probes are cached per sidecar URL with
 * a short TTL and busted by invalidateNetworkProbeCache (connectivity changes).
 *
 * Usage: npx tsx scripts/test-network-probe-ttl.mts
 */
import assert from "node:assert/strict";
import {
  invalidateNetworkProbeCache,
  NETWORK_PROBE_TTL_MS,
  peekNetworkProbeCache,
  probeNetworkReachable,
  setNetworkProbeNowForTests,
} from "../src/lib/networkAccess.ts";

const URL_A = "http://127.0.0.1:8787";
const URL_B = "http://127.0.0.1:9797";

let now = 1_000_000;
setNetworkProbeNowForTests(() => now);

let fetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetches += 1;
  const href = String(input);
  if (href.includes("/net/status")) {
    const online = href.includes("8787");
    return new Response(JSON.stringify({ online }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  throw new Error(`unexpected fetch ${href}`);
}) as typeof fetch;

try {
  invalidateNetworkProbeCache();
  fetches = 0;

  const first = await probeNetworkReachable(URL_A);
  assert.equal(first, true);
  assert.equal(fetches, 1);
  assert.equal(peekNetworkProbeCache(URL_A), true);

  const second = await probeNetworkReachable(URL_A);
  assert.equal(second, true);
  assert.equal(fetches, 1, "TTL hit must not re-fetch");

  const other = await probeNetworkReachable(URL_B);
  assert.equal(other, false);
  assert.equal(fetches, 2, "different sidecar URL is a separate cache key");

  invalidateNetworkProbeCache(URL_A);
  assert.equal(peekNetworkProbeCache(URL_A), undefined);
  const afterInvalidate = await probeNetworkReachable(URL_A);
  assert.equal(afterInvalidate, true);
  assert.equal(fetches, 3);

  now += NETWORK_PROBE_TTL_MS + 1;
  assert.equal(peekNetworkProbeCache(URL_A), undefined, "expired entry is a miss");
  const afterTtl = await probeNetworkReachable(URL_A);
  assert.equal(afterTtl, true);
  assert.equal(fetches, 4, "expired TTL must re-probe");

  console.log("[PASS] network reachability probe TTL cache");
  console.log("test-network-probe-ttl: ok");
} finally {
  globalThis.fetch = originalFetch;
  setNetworkProbeNowForTests(() => Date.now());
  invalidateNetworkProbeCache();
}
