import type { SelectionInfo } from "../types";

export function getSelectionInContainer(
  container: HTMLElement,
): SelectionInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const quotedText = sel.toString().trim();
  if (!quotedText) return null;

  const startOffset = getTextOffset(container, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(container, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null || startOffset >= endOffset) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  return { quotedText, startOffset, endOffset, rect };
}

function getTextOffset(
  root: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (current === node) {
      return total + offset;
    }
    total += current.textContent?.length ?? 0;
  }
  return null;
}

export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
}
