import { useEffect, useMemo, useRef, useState } from "react";
import { countBranchesInThread } from "../lib/branches";
import { firstUserMessage } from "../lib/thread";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";
import { ForkNoteLogo } from "./BranchLogo";
import { BranchRail } from "./BranchRail";
import { ChatComposer } from "./ChatComposer";
import { ProjectStatusBar } from "./ProjectStatusBar";
import { SelectableAnswer } from "./SelectableAnswer";

interface Props {
  onOpenProject: () => void;
}

export function MainPanel({ onOpenProject }: Props) {
  const thread = useAppStore((s) => s.thread);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const loadingMain = useAppStore((s) => s.loadingMain);
  const loadingBranchId = useAppStore((s) => s.loadingBranchId);
  const error = useAppStore((s) => s.error);
  const projectRoot = useAppStore((s) => s.projectRoot);
  const askMain = useAppStore((s) => s.askMain);
  const askBranch = useAppStore((s) => s.askBranch);
  const stopGeneration = useAppStore((s) => s.stopGeneration);

  const [input, setInput] = useState("");
  const [openBranchId, setOpenBranchId] = useState<NodeId | null>(null);
  const closeAllBranchFloats = useAppStore((s) => s.closeAllBranchFloats);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSentPromptRef = useRef("");

  const forkCount = useMemo(
    () => (thread ? countBranchesInThread(thread) : 0),
    [thread],
  );

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
    const saved = input.trim();
    if (!saved) return;
    lastSentPromptRef.current = saved;
    setInput("");
    void (async () => {
      const pending = askMain(saved);
      // askMain runs sync until first await; early exits (auth) leave loadingMain false
      await Promise.resolve();
      if (!useAppStore.getState().loadingMain) {
        setInput(saved);
        return;
      }
      await pending;
    })();
  };

  const handleStop = () => {
    stopGeneration();
    const last = lastSentPromptRef.current;
    if (last) setInput(last);
  };

  if (!thread) {
    return (
      <main className="ds-main ds-main-empty fn-main-empty">
        <div className="fn-empty">
          <div className="fn-empty-brand">
            <ForkNoteLogo showWordmark className="fn-empty-logo" iconHeight={48} />
            <p className="fn-empty-tagline">Clarify as you read</p>
          </div>

          <ol className="fn-empty-steps" aria-label="How to use">
            <li>
              <span className="fn-step-num">1</span>
              <span>Ask a development or research question</span>
            </li>
            <li>
              <span className="fn-step-num">2</span>
              <span>Select unfamiliar text and clarify instantly</span>
            </li>
            <li>
              <span className="fn-step-num">3</span>
              <span>Verdict each point — reject errors, keep what you accept</span>
            </li>
          </ol>

          <ProjectStatusBar onOpenProject={onOpenProject} />

          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            onStop={handleStop}
            loading={loadingMain}
            placeholder={
              projectRoot
                ? "Ask about the project, e.g. read package.json and add a note to the README…"
                : undefined
            }
          />
          {error && <p className="ds-error">{error}</p>}
        </div>
      </main>
    );
  }

  const title = firstUserMessage(thread) || "Untitled";

  return (
    <main className="ds-main ds-main-chat">
      <header className="fn-chat-header">
        <div className="fn-chat-header-main">
          <span className="fn-chat-kicker">notes</span>
          <h1 className="fn-chat-title" title={title}>
            {title}
          </h1>
        </div>
        <div className="fn-chat-header-meta">
          {projectRoot && (
            <button
              type="button"
              className="fn-project-chip is-connected"
              title={projectRoot}
              onClick={onOpenProject}
            >
              <span className="fn-project-dot" aria-hidden />
              <span className="fn-project-chip-label">
                {projectRoot.split(/[/\\]/).filter(Boolean).slice(-2).join("/")}
              </span>
            </button>
          )}
          {forkCount > 0 && (
            <span
              className="fn-fork-chip"
              title="Open fork nodes from the graph on the right"
            >
              {forkCount} forks
            </span>
          )}
        </div>
      </header>

      <div className="ds-chat-body">
        <div className="ds-chat-column">
          <div className="ds-chat-scroll" ref={scrollRef}>
            <div className="ds-messages">
              {thread.messages.map((msg) =>
                msg.role === "user" ? (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    className="ds-bubble ds-bubble-user"
                  >
                    <p>{msg.content}</p>
                  </div>
                ) : (
                  <div
                    key={msg.id}
                    data-msg-id={msg.id}
                    className="ds-bubble ds-bubble-assistant"
                  >
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
                        pointDoubts={msg.pointDoubts}
                      />
                    ) : (
                      <div className="ds-typing" aria-label="Thinking">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                  </div>
                ),
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <footer className="ds-chat-footer">
            <ProjectStatusBar onOpenProject={onOpenProject} />
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={submit}
              onStop={handleStop}
              loading={loadingMain}
              compact
              placeholder={
                projectRoot
                  ? "Continue the main thread, or ask the assistant to read/write project files…"
                  : "Continue the main thread…"
              }
            />
          </footer>
        </div>
        <BranchRail thread={thread} scrollRef={scrollRef} />
      </div>

      {error && <p className="ds-error ds-error-bar">{error}</p>}
    </main>
  );
}
