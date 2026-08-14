/** Caret placement helpers for the main chat composer. */

export type ComposerCaret = "start" | "end";

export function selectionRangeForCaret(
  textLength: number,
  caret: ComposerCaret = "end",
): { start: number; end: number } {
  const len = Math.max(0, textLength);
  if (caret === "start") return { start: 0, end: 0 };
  return { start: len, end: len };
}
