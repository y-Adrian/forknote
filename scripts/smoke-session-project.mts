/**
 * Smoke: per-session project binding helpers.
 * Usage: node --experimental-strip-types scripts/smoke-session-project.mts
 *    or: npx --yes tsx scripts/smoke-session-project.mts
 */
import {
  flushActiveSession,
  migrateGlobalProjectBinding,
  patchSessionProject,
} from "../src/lib/sessionProject.ts";
import type { ChatSession, ThreadRoot } from "../src/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function session(
  id: string,
  projectRoot?: string | null,
): ChatSession {
  const now = Date.now();
  return {
    id,
    title: id,
    thread: null,
    createdAt: now,
    updatedAt: now,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  };
}

function upsert(
  sessions: ChatSession[],
  activeSessionId: string | null,
  thread: ThreadRoot | null,
): ChatSession[] {
  if (!activeSessionId) return sessions;
  return sessions.map((s) =>
    s.id === activeSessionId ? { ...s, thread, updatedAt: Date.now() } : s,
  );
}

// Two sessions, different roots — patch only active
let sessions = [session("a", null), session("b", null)];
sessions = patchSessionProject(sessions, "a", "/proj/a");
sessions = patchSessionProject(sessions, "b", "/proj/b");
assert(sessions[0].projectRoot === "/proj/a", "session a root");
assert(sessions[1].projectRoot === "/proj/b", "session b root");

// Switch A → B: flush A keeps /proj/a, display target is B
const afterFlush = flushActiveSession(
  sessions,
  "a",
  null,
  "/proj/a",
  upsert,
);
const target = afterFlush.find((s) => s.id === "b");
assert(target?.projectRoot === "/proj/b", "switch restores B");
assert(
  afterFlush.find((s) => s.id === "a")?.projectRoot === "/proj/a",
  "A still bound after flush",
);

// New session starts unbound
const fresh = session("c", null);
assert(fresh.projectRoot === null, "new session null project");

// Legacy migration: global lastPath → active only
const legacy = migrateGlobalProjectBinding(
  {
    sessions: [session("x"), session("y")],
    activeSessionId: "y",
  },
  "/legacy/root",
);
assert(
  legacy.sessions.find((s) => s.id === "y")?.projectRoot === "/legacy/root",
  "migrate active",
);
assert(
  legacy.sessions.find((s) => s.id === "x")?.projectRoot === null,
  "migrate inactive null",
);

// Already-migrated sessions untouched by lastPath
const already = migrateGlobalProjectBinding(
  {
    sessions: [session("x", "/keep"), session("y", null)],
    activeSessionId: "x",
  },
  "/should-not-apply",
);
assert(
  already.sessions.find((s) => s.id === "x")?.projectRoot === "/keep",
  "skip migrated",
);
assert(
  already.sessions.find((s) => s.id === "y")?.projectRoot === null,
  "skip migrated null",
);

console.log("smoke-session-project: ok");
