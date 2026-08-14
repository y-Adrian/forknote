/** Copy text to the clipboard; falls back to execCommand when the async API is blocked. */

export type CopyTextFeedback = "idle" | "copied" | "failed";

/**
 * Copy plain text. Tries `navigator.clipboard.writeText`, then a temporary
 * textarea + `document.execCommand("copy")` selection path.
 * Returns true only when a copy API reported success.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to legacy selection / execCommand path
    }
  }

  return copyTextViaExecCommand(text);
}

/** Legacy selection + execCommand path (also used as the safe fallback). */
export function copyTextViaExecCommand(text: string): boolean {
  if (!text || typeof document === "undefined") return false;

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.tabIndex = -1;
    // iOS / Safari often ignore off-screen nodes; keep in-viewport but invisible.
    Object.assign(ta.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "0",
      border: "none",
      outline: "none",
      opacity: "0",
      pointerEvents: "none",
    });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
