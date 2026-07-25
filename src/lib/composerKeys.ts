import type { KeyboardEvent } from "react";

/** True while an IME composition is active (Enter confirms composition, must not send). */
export function isImeComposing(
  e: KeyboardEvent<HTMLTextAreaElement>,
  composing: boolean,
): boolean {
  return Boolean(
    e.nativeEvent.isComposing || e.keyCode === 229 || composing,
  );
}

/**
 * Main-composer parity: Enter sends, Shift+Enter inserts a newline.
 * Returns true when the event was handled as submit.
 */
export function handleComposerEnterKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  opts: {
    composing: boolean;
    canSubmit: boolean;
    onSubmit: () => void;
  },
): boolean {
  if (isImeComposing(e, opts.composing)) return false;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (opts.canSubmit) opts.onSubmit();
    return true;
  }
  return false;
}
