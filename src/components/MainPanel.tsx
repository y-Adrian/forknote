import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { CommentsRail } from "./CommentsRail";
import { SelectableAnswer } from "./SelectableAnswer";
import { TreeSidebar } from "./TreeSidebar";

export function MainPanel() {
  const thread = useAppStore((s) => s.thread);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const loadingBranchId = useAppStore((s) => s.loadingBranchId);
  const error = useAppStore((s) => s.error);
  const focus = useAppStore((s) => s.focus);
  const askMain = useAppStore((s) => s.askMain);
  const askBranch = useAppStore((s) => s.askBranch);
  const setFocus = useAppStore((s) => s.setFocus);
  const createSession = useAppStore((s) => s.createSession);

  const [input, setInput] = useState("");
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setInput("");
  }, [thread?.id]);

  useEffect(() => {
    if (focus.type === "root") {
      mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const el = document.getElementById(`branch-${focus.branchId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focus]);

  if (!thread) {
    return (
      <section className="welcome workspace-welcome">
        <h1>开始对话</h1>
        <p>
          在下方输入问题开始本会话。可点击左侧「新建」开启另一条独立会话；
          需要时在正文中选中片段添加批注追问。
        </p>
        <form
          className="main-form"
          onSubmit={(e) => {
            e.preventDefault();
            void askMain(input).then(() => setInput(""));
          }}
        >
          <textarea
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入你的问题…"
          />
          <button
            type="submit"
            className="btn primary"
            disabled={loadingMain || !input.trim()}
          >
            {loadingMain ? "生成中…" : "发送"}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <div className="conversation-layout">
      <TreeSidebar thread={thread} focus={focus} onFocus={setFocus} />

      <main className="conversation-main">
        <header className="conversation-header">
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => createSession()}
          >
            新建会话
          </button>
        </header>

        <div className="document-with-comments">
          <section className="document-sheet" ref={mainRef}>
            <div className="document-sheet-inner">
              <div className="message-role user">主问题</div>
              <p className="user-question">{thread.userQuestion}</p>

              <div className="message-role assistant">正文</div>
              {thread.assistantMessage ? (
                <SelectableAnswer
                  parentId={thread.id}
                  parentContent={thread.assistantMessage}
                  content={thread.assistantMessage}
                  onAskBranch={askBranch}
                  branchLoading={loadingBranchId !== null}
                />
              ) : (
                <p className="muted">正在生成主回答…</p>
              )}
            </div>
          </section>

          <CommentsRail
            thread={thread}
            loadingBranchId={loadingBranchId}
            focusBranchId={
              focus.type === "branch" ? focus.branchId : undefined
            }
            onAskBranch={askBranch}
            onFocus={(id) => setFocus({ type: "branch", branchId: id })}
          />
        </div>

        {error && <p className="error">{error}</p>}
      </main>
    </div>
  );
}
