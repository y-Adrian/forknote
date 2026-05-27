import { useEffect, useMemo, useRef, useState } from "react";
import { countBranches } from "../lib/branches";
import { useAppStore } from "../store/useAppStore";
import { ChatComposer } from "./ChatComposer";
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

  const [input, setInput] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const branchCount = useMemo(
    () => (thread ? countBranches(thread.children) : 0),
    [thread],
  );

  useEffect(() => {
    setInput("");
    setCommentsOpen(false);
  }, [thread?.id]);

  useEffect(() => {
    if (branchCount > 0) setCommentsOpen(true);
  }, [branchCount, thread?.id]);

  useEffect(() => {
    if (focus.type === "branch") setCommentsOpen(true);
  }, [focus]);

  useEffect(() => {
    if (focus.type === "root") {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.getElementById(`branch-${focus.branchId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focus]);

  const submit = () => {
    void askMain(input).then(() => setInput(""));
  };

  if (!thread) {
    return (
      <main className="ds-main ds-main-empty">
        <div className="ds-empty-center">
          <div className="ds-empty-logo" aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3c4.5 2 7 5.5 7 9.5S16.5 19 12 21 5 16 5 12.5 7.5 5 12 3z"
                fill="currentColor"
              />
            </svg>
          </div>
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            loading={loadingMain}
          />
          {error && <p className="ds-error">{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="ds-main">
      <header className="ds-chat-header">
        <h1 className="ds-chat-title">{thread.userQuestion}</h1>
        {branchCount > 0 && (
          <button
            type="button"
            className={`ds-comments-toggle${commentsOpen ? " active" : ""}`}
            onClick={() => setCommentsOpen((v) => !v)}
          >
            批注 {branchCount}
          </button>
        )}
      </header>

      <div className="ds-chat-body">
        <div className="ds-chat-scroll" ref={scrollRef}>
          <div className="ds-messages">
            <div className="ds-bubble ds-bubble-user">
              <p>{thread.userQuestion}</p>
            </div>

            <div className="ds-bubble ds-bubble-assistant">
              {thread.assistantMessage ? (
                <SelectableAnswer
                  parentId={thread.id}
                  parentContent={thread.assistantMessage}
                  content={thread.assistantMessage}
                  onAskBranch={askBranch}
                  branchLoading={loadingBranchId !== null}
                  compact
                />
              ) : (
                <p className="ds-muted">正在思考…</p>
              )}
            </div>
          </div>
        </div>

        {commentsOpen && branchCount > 0 && (
          <>
            <button
              type="button"
              className="ds-drawer-backdrop"
              aria-label="关闭批注"
              onClick={() => setCommentsOpen(false)}
            />
            <aside className="ds-comments-drawer">
              <div className="ds-drawer-header">
                <h2>批注</h2>
                <button
                  type="button"
                  className="ds-icon-btn"
                  onClick={() => setCommentsOpen(false)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </div>
              <TreeSidebar
                thread={thread}
                focus={focus}
                onFocus={setFocus}
                compact
              />
              <CommentsRail
                thread={thread}
                loadingBranchId={loadingBranchId}
                focusBranchId={
                  focus.type === "branch" ? focus.branchId : undefined
                }
                onAskBranch={askBranch}
                onFocus={(id) => setFocus({ type: "branch", branchId: id })}
                embedded
              />
            </aside>
          </>
        )}
      </div>

      {error && <p className="ds-error ds-error-bar">{error}</p>}
    </main>
  );
}
