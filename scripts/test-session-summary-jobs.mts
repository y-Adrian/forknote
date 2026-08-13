/**
 * Probe session-keyed archive/compress ownership.
 * Usage: npx tsx scripts/test-session-summary-jobs.mts
 */
import {
  projectSessionJobUi,
  resolveSessionJobTarget,
  SessionJobRegistry,
} from "../src/lib/sessionJobRegistry.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

const archives = new SessionJobRegistry();
const compressions = new SessionJobRegistry();

const archiveA = archives.start("A");
const archiveB = archives.start("B");
ok("A+B archives run concurrently", archives.has("A") && archives.has("B"));

archives.abort("A");
ok(
  "stop A aborts A and leaves B",
  archiveA.signal.aborted && !archiveB.signal.aborted && archives.has("B"),
);

const oldA = archives.start("A");
const newA = archives.start("A");
ok(
  "restart A invalidates only old A",
  oldA.signal.aborted &&
    archives.owns("A", newA) &&
    archives.owns("B", archiveB),
);
ok(
  "stale A completion cannot clear replacement",
  !archives.release("A", oldA) && archives.owns("A", newA),
);

const followUpTarget = resolveSessionJobTarget("B", "A");
const compressA = compressions.start(followUpTarget!);
ok(
  "archive follow-up keeps originating session after switch",
  followUpTarget === "A" && compressions.owns("A", compressA),
);

archives.abort("A");
compressions.abort("A");
ok(
  "delete A aborts owned archive and compress jobs",
  newA.signal.aborted &&
    compressA.signal.aborted &&
    !archives.has("A") &&
    !compressions.has("A"),
);
ok("delete A leaves B archive running", archives.owns("B", archiveB));

const compressB = compressions.start("B");
archives.abortAll();
compressions.abortAll();
ok(
  "clear/import teardown aborts every owned job",
  archiveB.signal.aborted &&
    compressB.signal.aborted &&
    !archives.has("B") &&
    !compressions.has("B"),
);

const archiveLoading = { A: true, B: true };
const compressLoading = { A: true };
const drafts = { A: "draft A", B: "draft B" };
const uiA = projectSessionJobUi(
  "A",
  archiveLoading,
  compressLoading,
  drafts,
);
const uiB = projectSessionJobUi(
  "B",
  archiveLoading,
  compressLoading,
  drafts,
);
ok(
  "loading indicators project the active session",
  uiA.loadingArchiveSessionId === "A" &&
    uiA.loadingCompressSessionId === "A" &&
    uiA.archiveDraft === "draft A" &&
    uiB.loadingArchiveSessionId === "B" &&
    uiB.loadingCompressSessionId === null &&
    uiB.archiveDraft === "draft B",
);

delete archiveLoading.A;
delete compressLoading.A;
delete drafts.A;
const settledA = projectSessionJobUi(
  "A",
  archiveLoading,
  compressLoading,
  drafts,
);
ok(
  "loading indicators resolve independently",
  settledA.loadingArchiveSessionId === null &&
    settledA.loadingCompressSessionId === null &&
    settledA.archiveDraft === "" &&
    projectSessionJobUi("B", archiveLoading, compressLoading, drafts)
      .loadingArchiveSessionId === "B",
);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
