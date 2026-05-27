import type { BranchNode, FocusTarget, ThreadRoot } from "../types";

interface Props {
  thread: ThreadRoot;
  focus: FocusTarget;
  onFocus: (focus: FocusTarget) => void;
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
    <ul className="tree-children">
      {nodes.map((node) => {
        const active =
          focus.type === "branch" && focus.branchId === node.id;
        return (
          <li key={node.id}>
            <button
              type="button"
              className={`tree-item${active ? " active" : ""}`}
              onClick={() => onFocus({ type: "branch", branchId: node.id })}
              title={node.userQuestion}
            >
              <span className="tree-quote">
                {node.anchor.quotedText.slice(0, 36)}
                {node.anchor.quotedText.length > 36 ? "…" : ""}
              </span>
              <span className="tree-q">{node.userQuestion}</span>
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

export function TreeSidebar({ thread, focus, onFocus }: Props) {
  const rootActive = focus.type === "root";

  return (
    <aside className="tree-sidebar">
      <h2>批注目录</h2>
      <ul className="tree-root">
        <li>
          <button
            type="button"
            className={`tree-item root${rootActive ? " active" : ""}`}
            onClick={() => onFocus({ type: "root" })}
            title={thread.userQuestion}
          >
            <span className="tree-q">{thread.userQuestion}</span>
          </button>
          {thread.children.length > 0 && (
            <BranchTreeItems
              nodes={thread.children}
              focus={focus}
              onFocus={onFocus}
            />
          )}
        </li>
      </ul>
      {thread.children.length === 0 && (
        <p className="hint sidebar-hint">
          在正文拖选文字添加批注，会出现在右侧批注栏。
        </p>
      )}
    </aside>
  );
}
