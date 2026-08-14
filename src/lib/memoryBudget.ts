/**
 * Token budgets for layered memory assembly.
 * Approx chars ≈ tokens * 4 (English-ish); Chinese is denser — we budget in chars.
 */
export const MEMORY_CHAR_BUDGETS = {
  /** Soft total for the composed addendum. */
  total: 32_000,
  /** Working memory (current turn plan / observe / reflect). */
  working: 16_000,
  /** Long-term / project pack retrieval. */
  longTerm: 8_000,
  /** Session memory. */
  session: 6_000,
  /** Preferences + policy + user model. */
  preferences: 4_000,
  /** Explicitly attached / @mentioned file excerpts (distinct from long-term pack). */
  files: 8_000,
} as const;

export type MemoryLayerKind =
  | "working"
  | "longTerm"
  | "session"
  | "preferences"
  | "files";

/**
 * Assembly / truncation hierarchy (earlier kinds yield first when over total).
 * Attached files are last so user-pinned context survives total trim.
 */
export const MEMORY_LAYER_ORDER: readonly MemoryLayerKind[] = [
  "preferences",
  "longTerm",
  "session",
  "working",
  "files",
] as const;

const KIND_RANK: Record<MemoryLayerKind, number> = {
  preferences: 0,
  longTerm: 1,
  session: 2,
  working: 3,
  files: 4,
};

export function truncateToBudget(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 24))}\n…(memory budget)`;
}

/**
 * Assemble layers with per-layer caps, then a total cap.
 * Layers are normalized to MEMORY_LAYER_ORDER regardless of push order from callers.
 * Total-budget trim keeps later kinds (working / files) preferentially.
 */
export function assembleMemoryLayers(
  layers: Array<{ kind: MemoryLayerKind; text: string }>,
): string | null {
  const perKind: Record<MemoryLayerKind, number> = {
    working: MEMORY_CHAR_BUDGETS.working,
    longTerm: MEMORY_CHAR_BUDGETS.longTerm,
    session: MEMORY_CHAR_BUDGETS.session,
    preferences: MEMORY_CHAR_BUDGETS.preferences,
    files: MEMORY_CHAR_BUDGETS.files,
  };

  // Merge same-kind fragments in hierarchy order so caller push order cannot
  // invert survival priority under the total cap.
  const buckets: Record<MemoryLayerKind, string[]> = {
    preferences: [],
    longTerm: [],
    session: [],
    working: [],
    files: [],
  };
  for (const layer of layers) {
    const body = layer.text.trim();
    if (!body) continue;
    buckets[layer.kind].push(body);
  }

  const capped: string[] = [];
  for (const kind of MEMORY_LAYER_ORDER) {
    const merged = buckets[kind].join("\n\n").trim();
    if (!merged) continue;
    capped.push(truncateToBudget(merged, perKind[kind]));
  }
  if (capped.length === 0) return null;

  let joined = capped.join("\n\n");
  if (joined.length <= MEMORY_CHAR_BUDGETS.total) return joined;

  // Degrade from the front (prefs/project) so working/files survive longer.
  const kept: string[] = [];
  let used = 0;
  for (let i = capped.length - 1; i >= 0; i--) {
    const piece = capped[i]!;
    if (used + piece.length + 2 > MEMORY_CHAR_BUDGETS.total) {
      const remain = MEMORY_CHAR_BUDGETS.total - used - 2;
      if (remain > 200) kept.unshift(truncateToBudget(piece, remain));
      break;
    }
    kept.unshift(piece);
    used += piece.length + 2;
  }
  joined = kept.join("\n\n");
  return joined || null;
}

/** Exported for probes — rank of a layer kind in the hierarchy. */
export function memoryLayerRank(kind: MemoryLayerKind): number {
  return KIND_RANK[kind];
}
