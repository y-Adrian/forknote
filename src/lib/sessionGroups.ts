import type { ChatSession } from "../types";

export interface SessionGroup {
  label: string;
  sessions: ChatSession[];
}

function isPinned(session: ChatSession): boolean {
  return typeof session.pinnedAt === "number" && session.pinnedAt > 0;
}

/**
 * Sidebar order is fixed by creation time (oldest → newest / top → bottom).
 * Selecting a session must not reshuffle; pin still floats a separate group.
 */
export function sortSessionsForSidebar(sessions: ChatSession[]): ChatSession[] {
  const pinned: ChatSession[] = [];
  const unpinned: ChatSession[] = [];
  for (const session of sessions) {
    if (isPinned(session)) pinned.push(session);
    else unpinned.push(session);
  }
  const byCreatedAsc = (a: ChatSession, b: ChatSession) => {
    const createdDiff = a.createdAt - b.createdAt;
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  };
  pinned.sort(byCreatedAsc);
  unpinned.sort(byCreatedAsc);
  return [...pinned, ...unpinned];
}

export function groupSessionsByDate(
  sessions: ChatSession[],
  labels?: { today: string; previous7: string; pinned?: string },
): SessionGroup[] {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const sevenDaysAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const pinned: ChatSession[] = [];
  const today: ChatSession[] = [];
  const week: ChatSession[] = [];
  const older = new Map<string, ChatSession[]>();

  const sorted = sortSessionsForSidebar(sessions);

  for (const session of sorted) {
    if (isPinned(session)) {
      pinned.push(session);
      continue;
    }
    // Bucket by creation day so activity / selection never moves a note between groups.
    const at = session.createdAt;
    if (at >= startOfToday) {
      today.push(session);
    } else if (at >= sevenDaysAgo) {
      week.push(session);
    } else {
      const d = new Date(at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const list = older.get(key) ?? [];
      list.push(session);
      older.set(key, list);
    }
  }

  const todayLabel = labels?.today ?? "Today";
  const weekLabel = labels?.previous7 ?? "Previous 7 days";
  const pinnedLabel = labels?.pinned ?? "Pinned";

  const groups: SessionGroup[] = [];
  if (pinned.length) groups.push({ label: pinnedLabel, sessions: pinned });
  if (today.length) groups.push({ label: todayLabel, sessions: today });
  if (week.length) groups.push({ label: weekLabel, sessions: week });
  for (const [label, list] of [...older.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  )) {
    groups.push({ label, sessions: list });
  }
  return groups;
}
