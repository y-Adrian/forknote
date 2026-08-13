/**
 * Probe: sidebar sessions stay ordered by createdAt (oldest → newest).
 * Usage: npx tsx scripts/test-session-sidebar-order.mts
 */
import assert from "node:assert/strict";
import {
  groupSessionsByDate,
  sortSessionsForSidebar,
} from "../src/lib/sessionGroups.ts";
import type { ChatSession } from "../src/types.ts";

function session(
  id: string,
  createdAt: number,
  updatedAt: number,
  pinnedAt?: number | null,
): ChatSession {
  return {
    id,
    title: id,
    thread: null,
    createdAt,
    updatedAt,
    pinnedAt,
  };
}

const a = session("a", 100, 900);
const b = session("b", 200, 800);
const c = session("c", 300, 700);

const sorted = sortSessionsForSidebar([c, a, b]);
assert.deepEqual(
  sorted.map((s) => s.id),
  ["a", "b", "c"],
  "oldest created first (top), newest last (bottom)",
);

// Touching updatedAt must not change order
const resorted = sortSessionsForSidebar([
  { ...a, updatedAt: Date.now() },
  { ...c, updatedAt: 1 },
  { ...b, updatedAt: Date.now() + 1 },
]);
assert.deepEqual(
  resorted.map((s) => s.id),
  ["a", "b", "c"],
);

const pin = session("p", 50, 999, 1000);
const withPin = sortSessionsForSidebar([c, pin, a]);
assert.deepEqual(
  withPin.map((s) => s.id),
  ["p", "a", "c"],
  "pinned group first, still createdAsc within groups",
);

const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);
const t0 = startOfToday.getTime() + 60_000;
const t1 = startOfToday.getTime() + 120_000;
const groups = groupSessionsByDate([
  session("new", t1, Date.now()),
  session("old", t0, 1),
]);
const today = groups.find((g) => g.label === "Today");
assert.ok(today);
assert.deepEqual(
  today!.sessions.map((s) => s.id),
  ["old", "new"],
);

console.log("test-session-sidebar-order: ok");
