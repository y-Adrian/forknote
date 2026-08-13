import type { BranchNode } from "../types";

const MARK_CLASS = "branch-highlight";
const POINT_CLARIFY_ATTR = "clarifyBranchId";
const POINT_CLARIFY_CLASS = "point-has-clarify";
const POINT_CLARIFY_PENDING_CLASS = "point-has-clarify-pending";

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
  root.querySelectorAll(`[data-point-index].${POINT_CLARIFY_CLASS}`).forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    delete el.dataset[POINT_CLARIFY_ATTR];
    el.classList.remove(POINT_CLARIFY_CLASS, POINT_CLARIFY_PENDING_CLASS);
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

/** Strip leading 【N】 so quoted text can match point-card DOM (marker not rendered). */
export function quotedTextForHighlight(quotedText: string): string {
  return quotedText.replace(/^【\d{1,2}】\s*/, "").trim();
}

function markPointClarifyTarget(
  root: HTMLElement,
  pointIndex: number,
  branchId: string,
  pending: boolean,
): boolean {
  const row = root.querySelector(
    `[data-point-index="${pointIndex}"]`,
  ) as HTMLElement | null;
  if (!row) return false;
  row.dataset[POINT_CLARIFY_ATTR] = branchId;
  row.classList.add(POINT_CLARIFY_CLASS);
  row.classList.toggle(POINT_CLARIFY_PENDING_CLASS, pending);
  return true;
}

/**
 * Paint reopenable clarify targets:
 * - Point Ask / 澄 → mark the whole `.point-row` (DOM omits 【N】 markers)
 * - Selection clarify → wrap matching text once the answer exists
 */
export function applyBranchHighlights(
  root: HTMLElement,
  branches: BranchNode[],
): void {
  clearHighlights(root);

  const usedRanges: Range[] = [];

  // Later branches for the same point win (most recent Ask).
  for (const branch of branches) {
    const pointIndex = branch.anchor.pointIndex;
    if (pointIndex != null) {
      markPointClarifyTarget(
        root,
        pointIndex,
        branch.id,
        !branch.assistantMessage.trim(),
      );
      continue;
    }

    if (!branch.assistantMessage.trim()) continue;

    const needle =
      quotedTextForHighlight(branch.anchor.quotedText) ||
      branch.anchor.quotedText;
    const range = findTextRange(root, needle, true);
    if (!range) continue;

    const overlaps = usedRanges.some((r) => rangesOverlap(r, range));
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
  if (mark) return mark.getBoundingClientRect();

  const point = root.querySelector(
    `[data-point-index][data-clarify-branch-id="${branchId}"]`,
  );
  return point?.getBoundingClientRect() ?? null;
}

/** Resolve a click target to a clarify branch id (text mark or point row). */
export function clarifyBranchIdFromEventTarget(
  target: EventTarget | null,
): string | null {
  if (!(target instanceof Element)) return null;
  const mark = target.closest(`mark.${MARK_CLASS}`) as HTMLElement | null;
  if (mark?.dataset.branchId) return mark.dataset.branchId;
  const point = target.closest(
    `[data-point-index].${POINT_CLARIFY_CLASS}`,
  ) as HTMLElement | null;
  return point?.dataset[POINT_CLARIFY_ATTR] ?? null;
}
