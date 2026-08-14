import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../lib/i18n";
import { isActivationKey } from "../lib/keyboard";
import { useAppStore } from "../store/useAppStore";
import type { BranchNode, ChatMessage, ThreadRoot } from "../types";

interface Props {
  thread: ThreadRoot;
  open: boolean;
  onClose: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

interface LayoutBranch {
  branch: BranchNode;
  x: number;
  y: number;
  parentX: number;
  parentY: number;
  hostMsgId: string;
}

interface LayoutTrunk {
  msg: ChatMessage;
  y: number;
  label: string;
}

const PAD_X = 28;
const PAD_Y = 28;
const TRUNK_X = 44;
const X_STEP = 42;
const TRUNK_GAP = 64;
const BRANCH_GAP = 34;
const TRUNK_R = 7;
const NODE_R = 6;

const C_TRUNK_LINE = "rgba(168,152,200,0.28)";
const C_TRUNK = "#a995c4";
const C_CURVE = "rgba(168,152,200,0.55)";
const C_LEAF = "rgba(140,120,175,0.75)";
const C_LEAF_ADOPTED = "#6b8f71";

function previewLabel(text: string, max = 22): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "…";
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function branchCurve(px: number, py: number, cx: number, cy: number): string {
  return `M ${px} ${py} C ${px} ${cy}, ${px} ${cy}, ${cx} ${cy}`;
}

function buildMapLayout(thread: ThreadRoot): {
  trunks: LayoutTrunk[];
  branches: LayoutBranch[];
  width: number;
  height: number;
} {
  const trunks: LayoutTrunk[] = [];
  const branches: LayoutBranch[] = [];
  let y = PAD_Y + TRUNK_R;
  let maxX = TRUNK_X;

  const placeBranches = (
    nodes: BranchNode[],
    parentX: number,
    parentY: number,
    depth: number,
    hostMsgId: string,
    cursor: { y: number },
  ) => {
    for (const branch of nodes) {
      const x = TRUNK_X + depth * X_STEP;
      const by = cursor.y;
      cursor.y += BRANCH_GAP;
      maxX = Math.max(maxX, x);
      branches.push({
        branch,
        x,
        y: by,
        parentX,
        parentY,
        hostMsgId,
      });
      placeBranches(branch.children, x, by, depth + 1, hostMsgId, cursor);
    }
  };

  for (const msg of thread.messages) {
    if (msg.role !== "assistant") continue;
    trunks.push({
      msg,
      y,
      label: previewLabel(msg.content, 28),
    });
    if (msg.children.length > 0) {
      const cursor = { y: y + BRANCH_GAP };
      placeBranches(msg.children, TRUNK_X, y, 1, msg.id, cursor);
      y = Math.max(cursor.y, y + TRUNK_GAP);
    } else {
      y += TRUNK_GAP;
    }
  }

  return {
    trunks,
    branches,
    width: Math.max(320, maxX + 220 + PAD_X),
    height: Math.max(180, y + PAD_Y),
  };
}

export function ForkHistoryMap({ thread, open, onClose, scrollRef }: Props) {
  const { t } = useLocale();
  const openBranchFloat = useAppStore((s) => s.openBranchFloat);
  const dialogRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => buildMapLayout(thread), [thread]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const openFork = (branch: BranchNode, hostMsgId: string) => {
    const host =
      (scrollRef.current?.querySelector(
        `[data-msg-id="${hostMsgId}"]`,
      ) as HTMLElement | null) ?? null;
    const rect =
      host?.getBoundingClientRect() ??
      new DOMRect(
        Math.max(16, window.innerWidth / 2 - 160),
        Math.max(16, window.innerHeight * 0.28),
        320,
        40,
      );
    onClose();
    // Let the modal unmount before stacking the float.
    window.requestAnimationFrame(() => {
      openBranchFloat(branch.id, rect, null);
      host?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const focusMain = (msgId: string) => {
    const host =
      (scrollRef.current?.querySelector(
        `[data-msg-id="${msgId}"]`,
      ) as HTMLElement | null) ?? null;
    onClose();
    window.requestAnimationFrame(() => {
      host?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return createPortal(
    <div
      className="modal-backdrop fn-fork-map-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal fn-fork-map-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fn-fork-map-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ss-header">
          <h2 id="fn-fork-map-title">{t("fork.mapTitle")}</h2>
          <button
            type="button"
            className="ss-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <p className="ss-panel-lead ss-panel-hint">{t("fork.mapLead")}</p>

        <div className="fn-fork-map-scroll">
          {layout.trunks.length === 0 ? (
            <p className="fn-fork-map-empty">{t("fork.mapEmpty")}</p>
          ) : (
            <svg
              className="fn-fork-map-svg"
              width={layout.width}
              height={layout.height}
              role="img"
              aria-label={t("fork.mapAria")}
            >
              {layout.trunks.length > 1 ? (
                <line
                  x1={TRUNK_X}
                  y1={layout.trunks[0].y}
                  x2={TRUNK_X}
                  y2={layout.trunks[layout.trunks.length - 1].y}
                  stroke={C_TRUNK_LINE}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              ) : null}

              {layout.branches.map((n) => (
                <g key={n.branch.id}>
                  <path
                    d={branchCurve(n.parentX, n.parentY, n.x, n.y)}
                    stroke={C_CURVE}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    fill="none"
                  />
                  <g
                    className="fn-fork-map-node"
                    role="button"
                    tabIndex={0}
                    aria-label={t("fork.openNodeAria", {
                      question: n.branch.userQuestion.slice(0, 80),
                    })}
                    style={{ cursor: "pointer" }}
                    onClick={() => openFork(n.branch, n.hostMsgId)}
                    onKeyDown={(e: ReactKeyboardEvent) => {
                      if (!isActivationKey(e.key)) return;
                      e.preventDefault();
                      openFork(n.branch, n.hostMsgId);
                    }}
                  >
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={NODE_R + 8}
                      fill="transparent"
                    />
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={NODE_R}
                      fill={n.branch.adoptedAt ? C_LEAF_ADOPTED : C_LEAF}
                      stroke={
                        n.branch.adoptedAt
                          ? "rgba(140,180,145,0.85)"
                          : "rgba(220,210,235,0.7)"
                      }
                      strokeWidth="1.5"
                    />
                    <text
                      x={n.x + NODE_R + 8}
                      y={n.y + 4}
                      fontSize="12"
                      fill="currentColor"
                      style={{ fill: "var(--ds-text)" }}
                    >
                      {(n.branch.adoptedAt ? "✓ " : "") +
                        previewLabel(n.branch.userQuestion, 26)}
                    </text>
                    <title>{n.branch.userQuestion}</title>
                  </g>
                </g>
              ))}

              {layout.trunks.map((trunk, i) => (
                <g
                  key={trunk.msg.id}
                  className="fn-fork-map-node"
                  role="button"
                  tabIndex={0}
                  aria-label={t("fork.mapMainStepAria", {
                    n: i + 1,
                    label: trunk.label,
                  })}
                  style={{ cursor: "pointer" }}
                  onClick={() => focusMain(trunk.msg.id)}
                  onKeyDown={(e: ReactKeyboardEvent) => {
                    if (!isActivationKey(e.key)) return;
                    e.preventDefault();
                    focusMain(trunk.msg.id);
                  }}
                >
                  <circle
                    cx={TRUNK_X}
                    cy={trunk.y}
                    r={TRUNK_R + 8}
                    fill="transparent"
                  />
                  <circle
                    cx={TRUNK_X}
                    cy={trunk.y}
                    r={TRUNK_R}
                    fill={C_TRUNK}
                    stroke="rgba(210,198,230,0.55)"
                    strokeWidth="1.5"
                  />
                  <text
                    x={TRUNK_X + TRUNK_R + 12}
                    y={trunk.y + 4}
                    fontSize="12"
                    fontWeight={600}
                    style={{ fill: "var(--ds-text-dim)" }}
                  >
                    {t("fork.mapMainStep", { n: i + 1 })} · {trunk.label}
                  </text>
                  <title>{trunk.msg.content.slice(0, 200)}</title>
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
