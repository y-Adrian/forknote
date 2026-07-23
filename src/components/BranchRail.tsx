import { useEffect, useRef, useState, type RefObject } from "react";
import type { BranchNode, ThreadRoot } from "../types";
import { useAppStore } from "../store/useAppStore";

// ── Types ──────────────────────────────────────────────────
interface RailMsg { msgId: string; y: number; branches: BranchNode[] }

interface LayoutNode {
  branch:   BranchNode;
  x:        number;
  y:        number;
  parentX:  number;
  parentY:  number;
  children: LayoutNode[];
}

interface Props {
  thread:    ThreadRoot;
  scrollRef: RefObject<HTMLDivElement | null>;
}

// ── Layout constants ───────────────────────────────────────
const RAIL_W  = 160;
const TRUNK_X = 12;   // trunk line x (left side)
const X_STEP  = 32;   // horizontal shift per depth level
const Y_START = 22;   // first branch offset below forkY
const Y_GAP   = 28;   // vertical gap between DFS-ordered nodes
const TRUNK_R = 5.5;
const NODE_R  = 4.5;

// ── Colors ─────────────────────────────────────────────────
const C_TRUNK_LINE  = "rgba(45,212,191,0.18)";
const C_TRUNK_NODE  = "#2dd4bf";
const C_TRUNK_PLAIN = "rgba(45,180,160,0.28)";
const C_CURVE       = "rgba(45,212,191,0.55)";
const C_CURVE_OPEN  = "rgba(94,234,212,0.95)";
const C_LEAF        = "rgba(20,184,166,0.65)";
const C_LEAF_OPEN   = "#2dd4bf";
const C_LEAF_RING   = "rgba(153,246,228,0.70)";

// ── DFS layout ─────────────────────────────────────────────
/**
 * Assign positions in depth-first order.
 * - x = TRUNK_X + depth * X_STEP  (deeper → further right)
 * - y = counter.y, incremented by Y_GAP after each node
 * DFS traversal ensures a node and ALL its descendants
 * appear together before the next sibling, matching git-graph semantics.
 */
function buildDFS(
  branches: BranchNode[],
  parentX:  number,
  parentY:  number,
  depth:    number,
  counter:  { y: number },
): LayoutNode[] {
  return branches.map((branch) => {
    const x = TRUNK_X + depth * X_STEP;
    const y = counter.y;
    counter.y += Y_GAP;
    const children = buildDFS(branch.children, x, y, depth + 1, counter);
    return { branch, x, y, parentX, parentY, children };
  });
}

function flatAll(nodes: LayoutNode[]): LayoutNode[] {
  const out: LayoutNode[] = [];
  for (const n of nodes) { out.push(n); out.push(...flatAll(n.children)); }
  return out;
}

// ── Curve ──────────────────────────────────────────────────
/**
 * "Branch off trunk" curve:
 * goes straight down from parent, then curves right to child.
 * Uses cubic bezier with both control points at (parentX, childY),
 * creating a clean elbow that looks like a git branch.
 */
function branchCurve(px: number, py: number, cx: number, cy: number): string {
  // Control points: pull down first, then arrive horizontally at child
  return `M ${px} ${py} C ${px} ${cy}, ${px} ${cy}, ${cx} ${cy}`;
}

// ── Component ──────────────────────────────────────────────
export function BranchRail({ thread, scrollRef }: Props) {
  const [msgs,      setMsgs]      = useState<RailMsg[]>([]);
  const [totalH,    setTotalH]    = useState(600);
  const [scrollTop, setScrollTop] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  const openBranchFloat  = useAppStore((s) => s.openBranchFloat);
  const closeBranchFloat = useAppStore((s) => s.closeBranchFloat);
  const branchFloatStack = useAppStore((s) => s.branchFloatStack);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const measure = () => {
      setScrollTop(scroll.scrollTop);
      setTotalH(scroll.scrollHeight);
      const next: RailMsg[] = [];
      for (const msg of thread.messages) {
        if (msg.role !== "assistant") continue;
        const el = scroll.querySelector(`[data-msg-id="${msg.id}"]`) as HTMLElement | null;
        if (!el) continue;
        next.push({ msgId: msg.id, y: el.offsetTop, branches: msg.children });
      }
      setMsgs(next);
    };
    measure();
    scroll.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(scroll);
    const mo = new MutationObserver(measure);
    mo.observe(scroll, { childList: true, subtree: true, characterData: false });
    return () => { scroll.removeEventListener("scroll", measure); ro.disconnect(); mo.disconnect(); };
  }, [thread, scrollRef]);

  const isOpen = (id: string) => branchFloatStack.some((e) => e.branchId === id);

  const handleClick = (branch: BranchNode, msgId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen(branch.id)) { closeBranchFloat(branch.id); return; }
    const el = scrollRef.current?.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    const rect = el?.getBoundingClientRect() ?? new DOMRect(0, 0, 300, 40);
    openBranchFloat(branch.id, rect, null);
  };

  if (msgs.length === 0) return null;

  return (
    <div className="ds-branch-rail" aria-label="Fork structure">
      <svg
        ref={svgRef}
        width={RAIL_W}
        height={totalH}
        style={{ transform: `translateY(${-scrollTop}px)` }}
        overflow="visible"
      >
        <defs>
          <filter id="branchGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* ── Trunk vertical line ── */}
        <line
          x1={TRUNK_X} y1={0} x2={TRUNK_X} y2={totalH}
          stroke={C_TRUNK_LINE} strokeWidth="2" strokeLinecap="round"
        />

        {msgs.map((msg) => {
          const forkY     = msg.y + 20;
          const hasBranch = msg.branches.length > 0;

          // Build DFS-ordered layout starting below the trunk node
          const counter     = { y: forkY + Y_START };
          const layoutRoots = buildDFS(msg.branches, TRUNK_X, forkY, 1, counter);
          const allNodes    = flatAll(layoutRoots);

          return (
            <g key={msg.msgId}>
              {/* ── Trunk / fork node ── */}
              <circle
                cx={TRUNK_X} cy={forkY} r={TRUNK_R}
                fill={hasBranch ? C_TRUNK_NODE : C_TRUNK_PLAIN}
                stroke={hasBranch ? "rgba(153,246,228,0.5)" : "none"}
                strokeWidth="1.5"
              />
              {/* Small horizontal tick when there are branches */}
              {hasBranch && (
                <line
                  x1={TRUNK_X} y1={forkY}
                  x2={TRUNK_X + X_STEP * 0.6} y2={forkY}
                  stroke="rgba(45,212,191,0.35)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              )}

              {/* ── Branch nodes + curves ── */}
              {allNodes.map((n) => {
                const open  = isOpen(n.branch.id);
                const label = n.branch.userQuestion.slice(0, 10);

                return (
                  <g
                    key={n.branch.id}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => handleClick(n.branch, msg.msgId, e)}
                  >
                    {/* Parent → child curve */}
                    <path
                      d={branchCurve(n.parentX, n.parentY, n.x, n.y)}
                      stroke={open ? C_CURVE_OPEN : C_CURVE}
                      strokeWidth={open ? 2.8 : 2.2}
                      strokeLinecap="round"
                      fill="none"
                      filter={open ? "url(#branchGlow)" : undefined}
                    />

                    {/* Node circle */}
                    <circle
                      cx={n.x} cy={n.y} r={NODE_R}
                      fill={open ? C_LEAF_OPEN : C_LEAF}
                      stroke={open ? C_LEAF_RING : "none"}
                      strokeWidth="1.5"
                      style={{ pointerEvents: "all" }}
                    />

                    {/* Short label to the right of the node */}
                    <text
                      x={n.x + NODE_R + 5}
                      y={n.y + 3.5}
                      fontSize="9"
                      fontFamily="system-ui,sans-serif"
                      fill={open ? "rgba(204,251,241,0.9)" : "rgba(130,180,170,0.7)"}
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {label}{n.branch.userQuestion.length > 10 ? "…" : ""}
                    </text>

                    <title>{n.branch.userQuestion}</title>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
