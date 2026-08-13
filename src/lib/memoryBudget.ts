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
} as const;

export type MemoryLayerKind =
  | "working"
  | "longTerm"
  | "session"
  | "preferences"
  | "files";

export function truncateToBudget(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 24))}\n…(memory budget)`;
}

/**
 * Assemble layers with per-layer caps, then a total cap.
 * Order: preferences → longTerm → session → working → files
 * (stable prefs first; working memory last so it survives total trim better if we
 * trim from the middle — actually we trim each layer first, then total from end
 * of earlier layers if needed).
 */
export function assembleMemoryLayers(
  layers: Array<{ kind: MemoryLayerKind; text: string }>,
): string | null {
  const perKind: Record<MemoryLayerKind, number> = {
    working: MEMORY_CHAR_BUDGETS.working,
    longTerm: MEMORY_CHAR_BUDGETS.longTerm,
    session: MEMORY_CHAR_BUDGETS.session,
    preferences: MEMORY_CHAR_BUDGETS.preferences,
    files: MEMORY_CHAR_BUDGETS.longTerm,
  };

  const capped: string[] = [];
  for (const layer of layers) {
    const body = layer.text.trim();
    if (!body) continue;
    capped.push(truncateToBudget(body, perKind[layer.kind]));
  }
  if (capped.length === 0) return null;

  let joined = capped.join("\n\n");
  if (joined.length <= MEMORY_CHAR_BUDGETS.total) return joined;

  // Degrade from the front (prefs/project) so recent working/session survive longer.
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
