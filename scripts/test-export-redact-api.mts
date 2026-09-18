/**
 * Probe: session JSON export omits API keys.
 * Usage: npx tsx scripts/test-export-redact-api.mts
 */
import {
  SESSION_BACKUP_FORMAT,
  SESSION_BACKUP_VERSION,
  createSessionBackupEnvelope,
  redactSessionApiForExport,
  sanitizeSessionStoreForExport,
} from "../src/lib/storage.ts";
import type { ChatSession, SessionStore } from "../src/types.ts";

const results: Array<{ name: string; pass: boolean }> = [];
function ok(name: string, pass: boolean) {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}`);
}

ok(
  "drops apiKey keeps model",
  JSON.stringify(redactSessionApiForExport({ apiKey: "sk-secret", model: "m" })) ===
    JSON.stringify({ model: "m" }),
);
ok("key-only override → null", redactSessionApiForExport({ apiKey: "x" }) === null);
ok("null stays null", redactSessionApiForExport(null) === null);
ok("undefined stays undefined", redactSessionApiForExport(undefined) === undefined);

const session = {
  id: "s1",
  title: "t",
  createdAt: 1,
  updatedAt: 1,
  thread: null,
  api: { apiKey: "sk-leak", baseUrl: "https://api.example.com", model: "m" },
} as ChatSession;

const store: SessionStore = { sessions: [session], activeSessionId: "s1" };
const sanitized = sanitizeSessionStoreForExport(store);
const json = JSON.stringify(sanitized);
ok("no secret in sanitized JSON", !json.includes("sk-leak"));
ok(
  "keeps non-secret api fields",
  sanitized.sessions[0]?.api?.baseUrl === "https://api.example.com" &&
    sanitized.sessions[0]?.api?.model === "m" &&
    sanitized.sessions[0]?.api?.apiKey === undefined,
);
ok("does not mutate original", session.api?.apiKey === "sk-leak");

const envelope = createSessionBackupEnvelope(
  store,
  new Date("2026-01-02T03:04:05.000Z"),
);
ok("backup has stable format", envelope.format === SESSION_BACKUP_FORMAT);
ok("backup has current version", envelope.version === SESSION_BACKUP_VERSION);
ok("backup has export timestamp", envelope.exportedAt === "2026-01-02T03:04:05.000Z");
ok("backup envelope omits secret", !JSON.stringify(envelope).includes("sk-leak"));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
