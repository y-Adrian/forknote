import { useEffect, useRef, useState } from "react";
import { firstUserMessage } from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";
import { BranchLogo } from "./BranchLogo";
import { BranchRail } from "./BranchRail";
import { ChatComposer } from "./ChatComposer";
import { SelectableAnswer } from "./SelectableAnswer";

export function MainPanel() {
  const thread = useAppStore((s) => s.thread);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const loadingBranchId = useAppStore((s) => s.loadingBranchId);
  const error = useAppStore((s) => s.error);
  const askMain = useAppStore((s) => s.askMain);
  const askBranch = useAppStore((s) => s.askBranch);
  const stopGeneration = useAppStore((s) => s.stopGeneration);

  const [input, setInput] = useState("");
  const [openBranchId, setOpenBranchId] = useState<NodeId | null>(null);
  const closeAllBranchFloats = useAppStore((s) => s.closeAllBranchFloats);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInput("");
    setOpenBranchId(null);
    closeAllBranchFloats();
  }, [activeSessionId, closeAllBranchFloats]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length, loadingMain]);

  useEffect(() => {
    if (!loadingBranchId && openBranchId) {
      requestAnimationFrame(() => {
        const mark = document.querySelector(
          `mark.branch-highlight[data-branch-id="${openBranchId}"]`,
        );
        mark?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, [loadingBranchId, openBranchId]);

  const toggleBranch = (branchId: NodeId | null) => {
    setOpenBranchId(branchId);
  };

  const submit = () => {
    void askMain(input).then(() => setInput(""));
  };

  if (!thread) {
    return (
      <main className="ds-main ds-main-empty">
        <div className="ds-empty-center">
          <BranchLogo iconOnly className="ds-empty-brand" />
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onStop={stopGeneration}
            loading={loadingMain}
          />
          {error && <p className="ds-error">{error}</p>}
        </div>
      </main>
    );
  }

  const title = firstUserMessage(thread) || "对话";

  return (
    <main className="ds-main ds-main-chat">
      <header className="ds-chat-header">
        <h1 className="ds-chat-title">{title}</h1>
      </header>

      <div className="ds-chat-body">
        <div className="ds-chat-scroll" ref={scrollRef}>
          <div className="ds-messages">
            {thread.messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} data-msg-id={msg.id} className="ds-bubble ds-bubble-user">
                  <p>{msg.content}</p>
                </div>
              ) : (
                <div key={msg.id} data-msg-id={msg.id} className="ds-bubble ds-bubble-assistant">
                  {msg.content ? (
                    <SelectableAnswer
                      parentId={msg.id}
                      parentContent={msg.content}
                      content={msg.content}
                      branches={msg.children}
                      onAskBranch={askBranch}
                      branchLoading={loadingBranchId !== null}
                      activeBranchId={openBranchId}
                      onToggleBranch={toggleBranch}
                      compact
                      pointVerdicts={msg.pointVerdicts}
                    />
                  ) : (
                    <div className="ds-typing" aria-label="正在思考">
                      <span /><span /><span />
                    </div>
                  )}
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>
        </div>
        <BranchRail thread={thread} scrollRef={scrollRef} />
      </div>

      <footer className="ds-chat-footer">
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onStop={stopGeneration}
          loading={loadingMain}
          compact
          placeholder="继续对话…"
        />
      </footer>

      {error && <p className="ds-error ds-error-bar">{error}</p>}
    </main>
  );
}
