import type { BranchNode, FocusTarget, ThreadRoot } from "../types";

interface Props {
  thread: ThreadRoot;
  focus: FocusTarget;
  onFocus: (focus: FocusTarget) => void;
  compact?: boolean;
}

function BranchTreeItems({
  nodes,
  focus,
  onFocus,
}: {
  nodes: BranchNode[];
  focus: FocusTarget;
  onFocus: (focus: FocusTarget) => void;
}) {
  return (
    <ul className="ds-tree-children">
      {nodes.map((node) => {
        const active =
          focus.type === "branch" && focus.branchId === node.id;
        return (
          <li key={node.id}>
            <button
              type="button"
              className={`ds-tree-item${active ? " active" : ""}`}
              onClick={() => onFocus({ type: "branch", branchId: node.id })}
              title={node.userQuestion}
            >
              <span className="ds-tree-quote">
                {node.anchor.quotedText.slice(0, 36)}
                {node.anchor.quotedText.length > 36 ? "…" : ""}
              </span>
              <span className="ds-tree-q">{node.userQuestion}</span>
            </button>
            {node.children.length > 0 && (
              <BranchTreeItems
                nodes={node.children}
                focus={focus}
                onFocus={onFocus}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TreeSidebar({ thread, focus, onFocus, compact }: Props) {
  const rootActive = focus.type === "root";
  const assistantWithBranches = thread.messages.filter(
    (m) => m.role === "assistant" && m.children.length > 0,
  );

  if (assistantWithBranches.length === 0 && compact) {
    return null;
  }

  return (
    <div className={`ds-tree-nav${compact ? " compact" : ""}`}>
      {!compact && <h3 className="ds-tree-heading">目录</h3>}
      <ul className="ds-tree-root">
        <li>
          <button
            type="button"
            className={`ds-tree-item${rootActive ? " active" : ""}`}
            onClick={() => onFocus({ type: "root" })}
          >
            <span className="ds-tree-q">对话正文</span>
          </button>
          {assistantWithBranches.map((msg) => (
            <li key={msg.id}>
              <BranchTreeItems
                nodes={msg.children}
                focus={focus}
                onFocus={onFocus}
              />
            </li>
          ))}
        </li>
      </ul>
    </div>
  );
}
