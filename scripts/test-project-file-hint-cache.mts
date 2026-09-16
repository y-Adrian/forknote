/**
 * Probe #365: project @file mention hints cache shallow listings per root,
 * debounce/coalesce refreshes, and invalidate after filesystem mutations.
 *
 * Usage: npx tsx scripts/test-project-file-hint-cache.mts
 */
import assert from "node:assert/strict";
import type { FsEntry } from "../src/lib/sidecar.ts";
import {
  invalidateProjectFileHintCache,
  listProjectFileHints,
  peekProjectFileHintCache,
  peekProjectFileHintRefreshCount,
  PROJECT_FILE_HINT_TTL_MS,
  resetProjectFileHintStatsForTests,
  setProjectFileHintListDirForTests,
  setProjectFileHintNowForTests,
} from "../src/lib/repoFileHints.ts";

const ROOT_A = "/tmp/forknote-project-a";
const ROOT_B = "/tmp/forknote-project-b";
const SIDECAR = "http://127.0.0.1:8787";

let now = 1_000_000;
setProjectFileHintNowForTests(() => now);

let listCalls = 0;
setProjectFileHintListDirForTests(async (relPath, _url, _signal, expectedRoot) => {
  listCalls += 1;
  const root = expectedRoot ?? ROOT_A;
  if (relPath === "." || relPath === "") {
    const entries: FsEntry[] =
      root === ROOT_A
        ? [
            { name: "src", type: "dir", path: "src" },
            { name: "readme.md", type: "file", path: "readme.md" },
          ]
        : [{ name: "lib", type: "dir", path: "lib" }];
    return { path: ".", entries };
  }
  if (relPath === "src") {
    return {
      path: "src",
      entries: [
        { name: "main.ts", type: "file", path: "src/main.ts" },
        { name: "util.ts", type: "file", path: "src/util.ts" },
      ],
    };
  }
  if (relPath === "lib") {
    return {
      path: "lib",
      entries: [{ name: "index.ts", type: "file", path: "lib/index.ts" }],
    };
  }
  return { path: relPath, entries: [] };
});

try {
  resetProjectFileHintStatsForTests();
  setProjectFileHintNowForTests(() => now);
  setProjectFileHintListDirForTests(
    // re-bind after reset
    async (relPath, _url, _signal, expectedRoot) => {
      listCalls += 1;
      const root = expectedRoot ?? ROOT_A;
      if (relPath === "." || relPath === "") {
        const entries: FsEntry[] =
          root === ROOT_A
            ? [
                { name: "src", type: "dir", path: "src" },
                { name: "readme.md", type: "file", path: "readme.md" },
              ]
            : [{ name: "lib", type: "dir", path: "lib" }];
        return { path: ".", entries };
      }
      if (relPath === "src") {
        return {
          path: "src",
          entries: [
            { name: "main.ts", type: "file", path: "src/main.ts" },
            { name: "util.ts", type: "file", path: "src/util.ts" },
          ],
        };
      }
      if (relPath === "lib") {
        return {
          path: "lib",
          entries: [{ name: "index.ts", type: "file", path: "lib/index.ts" }],
        };
      }
      return { path: relPath, entries: [] };
    },
  );
  listCalls = 0;

  const burst = await Promise.all([
    listProjectFileHints({ sidecarUrl: SIDECAR, projectRoot: ROOT_A, query: "mai" }),
    listProjectFileHints({ sidecarUrl: SIDECAR, projectRoot: ROOT_A, query: "mai" }),
    listProjectFileHints({ sidecarUrl: SIDECAR, projectRoot: ROOT_A, query: "util" }),
  ]);
  assert.ok(burst[0].includes("src/main.ts"));
  assert.equal(peekProjectFileHintRefreshCount(), 1, "bursty @mentions share one refresh");
  assert.equal(listCalls, 2, "one root list + one nested dir list");

  listCalls = 0;
  const warm = await listProjectFileHints({
    sidecarUrl: SIDECAR,
    projectRoot: ROOT_A,
    query: "readme",
  });
  assert.ok(warm.includes("readme.md"));
  assert.equal(peekProjectFileHintRefreshCount(), 1, "TTL hit must not re-collect");
  assert.equal(listCalls, 0);
  assert.ok(peekProjectFileHintCache(ROOT_A, SIDECAR)?.includes("src/main.ts"));

  invalidateProjectFileHintCache(ROOT_A);
  assert.equal(peekProjectFileHintCache(ROOT_A, SIDECAR), undefined);
  listCalls = 0;
  await listProjectFileHints({
    sidecarUrl: SIDECAR,
    projectRoot: ROOT_A,
    query: "main",
  });
  assert.equal(peekProjectFileHintRefreshCount(), 2, "invalidate forces refresh");
  assert.equal(listCalls, 2);

  listCalls = 0;
  await listProjectFileHints({
    sidecarUrl: SIDECAR,
    projectRoot: ROOT_B,
    query: "index",
  });
  assert.equal(peekProjectFileHintRefreshCount(), 3, "different root is a separate cache");
  assert.equal(listCalls, 2);

  now += PROJECT_FILE_HINT_TTL_MS + 1;
  assert.equal(peekProjectFileHintCache(ROOT_A, SIDECAR), undefined, "expired is a miss");
  listCalls = 0;
  await listProjectFileHints({
    sidecarUrl: SIDECAR,
    projectRoot: ROOT_A,
    query: "main",
  });
  assert.equal(peekProjectFileHintRefreshCount(), 4, "TTL expiry refreshes");
  assert.equal(listCalls, 2);

  console.log("[PASS] project file mention hint cache");
  console.log("test-project-file-hint-cache: ok");
} finally {
  resetProjectFileHintStatsForTests();
}
