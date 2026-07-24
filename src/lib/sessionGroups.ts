import type { ChatSession } from "../types";

export interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

export function groupSessionsByDate(
  sessions: ChatSession[],
  labels?: { today: string; previous7: string },
): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const today: ChatSession[] = [];
  const week: ChatSession[] = [];
  const older = new Map<string, ChatSession[]>();

  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  for (const session of sorted) {
    if (session.updatedAt >= startOfToday) {
      today.push(session);
    } else if (session.updatedAt >= sevenDaysAgo) {
      week.push(session);
    } else {
      const d = new Date(session.updatedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const list = older.get(key) ?? [];
      list.push(session);
      older.set(key, list);
    }
  }

  const todayLabel = labels?.today ?? "Today";
  const weekLabel = labels?.previous7 ?? "Previous 7 days";

  const groups: SessionGroup[] = [];
  if (today.length) groups.push({ label: todayLabel, sessions: today });
  if (week.length) groups.push({ label: weekLabel, sessions: week });
  for (const [label, list] of [...older.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  )) {
    groups.push({ label, sessions: list });
  }
  return groups;
}
