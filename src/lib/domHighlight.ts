import type { BranchNode } from "../types";

const MARK_CLASS = "branch-highlight";

export function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll(`mark.${MARK_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    // React may have already detached `mark` while we unwrap — never throw.
    try {
      if (mark.parentNode === parent) parent.removeChild(mark);
      else mark.remove();
    } catch {
      /* ignore NotFoundError / HierarchyRequestError */
    }
  });
  try {
    root.normalize();
  } catch {
    /* ignore */
  }
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ");
}

function findTextRange(
  root: HTMLElement,
  searchText: string,
  skipInsideMark: boolean,
): Range | null {
  const needle = searchText.trim();
  if (!needle) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (skipInsideMark && node.parentElement?.closest(`mark.${MARK_CLASS}`)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let full = "";
  const nodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const t = n as Text;
    nodes.push(t);
    full += t.textContent ?? "";
  }

  let idx = full.indexOf(needle);
  if (idx < 0) {
    const nFull = normalizeWs(full);
    const nNeedle = normalizeWs(needle);
    const nIdx = nFull.indexOf(nNeedle);
    if (nIdx < 0) return null;
    idx = nIdx;
  }

  const end = idx + needle.length;
  let count = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;

  for (const text of nodes) {
    const len = text.textContent?.length ?? 0;
    if (!startNode && count + len > idx) {
      startNode = text;
      startOff = idx - count;
    }
    if (!endNode && count + len >= end) {
      endNode = text;
      endOff = end - count;
      break;
    }
    count += len;
  }

  if (!startNode || !endNode) return null;

  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}

function wrapRange(range: Range, branchId: string): boolean {
  const mark = document.createElement("mark");
  mark.className = MARK_CLASS;
  mark.dataset.branchId = branchId;

  try {
    range.surroundContents(mark);
    return true;
  } catch {
    const fragment = range.extractContents();
    mark.appendChild(fragment);
    range.insertNode(mark);
    return true;
  }
}

export function applyBranchHighlights(
  root: HTMLElement,
  branches: BranchNode[],
): void {
  clearHighlights(root);

  const done = branches.filter((b) => b.assistantMessage.trim().length > 0);
  const usedRanges: Range[] = [];

  for (const branch of done) {
    const range = findTextRange(root, branch.anchor.quotedText, true);
    if (!range) continue;

    const overlaps = usedRanges.some((r) =>
      rangesOverlap(r, range),
    );
    if (overlaps) continue;

    if (wrapRange(range, branch.id)) {
      usedRanges.push(range);
    }
  }
}

function rangesOverlap(a: Range, b: Range): boolean {
  const pos = a.compareBoundaryPoints(Range.END_TO_START, b);
  const pos2 = b.compareBoundaryPoints(Range.END_TO_START, a);
  return !(pos <= 0 && pos2 <= 0);
}

export function getHighlightRect(
  root: HTMLElement,
  branchId: string,
): DOMRect | null {
  const mark = root.querySelector(
    `mark.${MARK_CLASS}[data-branch-id="${branchId}"]`,
  );
  return mark?.getBoundingClientRect() ?? null;
}
