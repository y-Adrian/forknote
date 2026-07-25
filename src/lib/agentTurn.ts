/**
 * Shared agent turn runner used by askMain and askBranch.
 * Streams into a write-target callback (main ChatMessage or Fork BranchNode).
 */
import {
  agentCallFromOpenAI,
  alignOfficeToolCall,
  buildCodingToolsSystem,
  buildMinimalCreatePlanHint,
  buildMinimalOfficePlanHint,
  buildNextPlanChunkPrompt,
  buildPlanningPhaseSystem,
  collectToolCalls,
  executeToolCall,
  inferCreateFilePath,
  inferExploreIntent,
  inferMultiStepPlan,
  inferOfficeCreateIntent,
  limitPlanForApproval,
  multiStepFollowUpHint,
  multiStepSystemHint,
  parseAgentPlan,
  pathsMatch,
  planNeedsToolApproval,
  synthesizeExploreToolCall,
  synthesizeOfficeFromIntent,
  nativeToolResultMessage,
  PROJECT_OPENAI_TOOLS,
  stripToolCalls,
  synthesizeWriteFromReply,
  toolResultMessage,
  type AgentActivity,
  type AgentFileChange,
  type AgentToolCall,
} from "./agentTools";
import { buildConversationMessages } from "./contextBuilder";
import { buildAgentMemoryAddendum } from "./contextMemory";
import { resolveConversationContext } from "./conversationContext";
import type { Locale } from "./i18n";
import { createId } from "./id";
import {
  isToolsUnsupportedError,
  streamChat,
  type ChatMessage as ApiChatMessage,
  type ToolCall,
} from "./openai";
import { mergeReasoningChannels } from "./reasoning";
import {
  resolveAgentMaxRounds,
  resolveAgentRequireApproval,
} from "./settings";
import type { ApiSettings, ChatSession, ThreadRoot } from "../types";

export type AgentContentPatch = {
  content?: string;
  reasoning?: string;
};

export type AgentTurnOutcome =
  | "completed"
  | "waiting_plan"
  | "aborted"
  | "need_project";

export type RunAgentTurnOptions = {
  llm: ApiSettings;
  settings: ApiSettings;
  locale: Locale;
  session: ChatSession | undefined;
  userText: string;
  thread: ThreadRoot;
  projectRoot: string | null;
  sidecarUrl: string;
  signal: AbortSignal;
  /** Appended after buildConversationMessages (e.g. clarify selection addendum). */
  extraMessages?: ApiChatMessage[];
  isOwned: () => boolean;
  patchContent: (patch: AgentContentPatch) => void;
  onAgentActivity: (activity: AgentActivity) => void;
  onAgentChange: (change: AgentFileChange & { at: number }) => void;
  /** Persist live-mode repair when archive id is stale. */
  onRepairContextToLive?: () => void;
  /**
   * Plan needs user approval. Caller registers `continueExecution` and shows
   * AgentPlanReview. Runner returns `waiting_plan` without clearing ownership.
   */
  onAwaitPlanApproval: (args: {
    planText: string;
    steps: string[];
    /** Total steps before chunking (for UI “showing N of M”). */
    totalStepCount?: number;
    continueExecution: () => Promise<void>;
  }) => void;
};

/** Reject when `signal` aborts so tool fetches can be interrupted promptly. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

export async function runAgentTurn(
  options: RunAgentTurnOptions,
): Promise<AgentTurnOutcome> {
  const {
    llm,
    settings,
    locale,
    session,
    userText,
    thread,
    projectRoot,
    sidecarUrl,
    signal,
    extraMessages,
    isOwned,
    patchContent,
    onAgentActivity,
    onAgentChange,
    onRepairContextToLive,
    onAwaitPlanApproval,
  } = options;

  const trimmed = userText.trim();
  const createPathEarly = inferCreateFilePath(trimmed);
  const officeIntentEarly = inferOfficeCreateIntent(trimmed);
  if ((createPathEarly || officeIntentEarly) && !projectRoot) {
    return "need_project";
  }

  const agentMaxRounds = resolveAgentMaxRounds(settings);
  const codingToolsSystem = projectRoot
    ? buildCodingToolsSystem(projectRoot)
    : null;
  const resolved = resolveConversationContext(session);
  if (resolved.repairedToLive) {
    onRepairContextToLive?.();
  }

  const memoryAddendum = await buildAgentMemoryAddendum({
    settings,
    query: trimmed,
    session,
    projectRoot,
    sidecarUrl,
    signal,
  });

  if (signal.aborted || !isOwned()) {
    return "aborted";
  }

  const apiMessages: ApiChatMessage[] = buildConversationMessages(thread, {
    projectRoot,
    codingToolsSystem,
    contextMode: resolved.mode,
    activeArchive: resolved.archive,
    locale,
    memoryAddendum,
  });

  if (extraMessages?.length) {
    apiMessages.push(...extraMessages);
  }

  const createPath = projectRoot ? inferCreateFilePath(trimmed) : null;
  const officeIntent = projectRoot ? inferOfficeCreateIntent(trimmed) : null;
  const multiStepPlan = projectRoot ? inferMultiStepPlan(trimmed) : [];
  const exploreIntent =
    projectRoot && !createPath && !officeIntent
      ? inferExploreIntent(trimmed)
      : null;
  const explorePlaceholder =
    exploreIntent?.kind === "list"
      ? `Listing ${exploreIntent.path}…`
      : exploreIntent?.kind === "read"
        ? `Reading ${exploreIntent.path}…`
        : exploreIntent?.kind === "search"
          ? `Searching ${exploreIntent.query}…`
          : null;
  const requireApproval =
    Boolean(projectRoot) && resolveAgentRequireApproval(settings);

  const addExecutionHints = () => {
    if (createPath) {
      apiMessages.push({
        role: "system",
        content: `用户要求在项目中创建文件。你必须调用函数 write_file：path 必须精确为 "${createPath}"（相对项目根），content 为完整源码。禁止只输出 Markdown 代码块而不调用工具。`,
      });
    } else if (officeIntent) {
      apiMessages.push({
        role: "system",
        content:
          officeIntent.tool === "write_xlsx"
            ? `用户要求创建 Excel。你必须调用函数 write_xlsx：path="${officeIntent.path}"，rows 为二维数组（首行可为表头）。禁止只把 JSON/表格贴在 Markdown 里让用户自己执行。禁止用 write_file。`
            : `用户要求创建 Word。你必须调用函数 write_docx：path="${officeIntent.path}"，paragraphs 为段落数组（空白文档用 [] 或 [""]）。禁止只把 JSON 贴在 Markdown 里；禁止未调用工具就声称已创建。禁止用 write_file。`,
      });
    } else if (exploreIntent) {
      apiMessages.push({
        role: "system",
        content:
          exploreIntent.kind === "list"
            ? `用户要求查看目录。你必须调用函数 list_dir：path 必须为 "${exploreIntent.path}"（相对项目根；根目录用 "."）。禁止凭猜测罗列文件。`
            : exploreIntent.kind === "read"
              ? `用户要求阅读文件。你必须调用函数 read_file：path 必须为 "${exploreIntent.path}"。禁止编造文件内容。`
              : `用户要求搜索代码。你必须调用函数 search_files：query 必须为 "${exploreIntent.query}"。禁止凭记忆假装已搜索。`,
      });
    } else if (multiStepPlan.length >= 2) {
      apiMessages.push({
        role: "system",
        content: multiStepSystemHint(multiStepPlan),
      });
    }
  };

  let visibleContent = "";
  let round = 0;
  let useNativeTools = Boolean(projectRoot);
  let forcedWrite = Boolean(createPath && projectRoot);
  let forcedExploreTool =
    exploreIntent?.kind === "list"
      ? "list_dir"
      : exploreIntent?.kind === "read"
        ? "read_file"
        : exploreIntent?.kind === "search"
          ? "search_files"
          : null;
  let officeFallbackUsed = false;
  let exploreFallbackUsed = false;
  let officeToolFailed = false;
  let officeTargetWritten = false;
  let toolBatchesExecuted = 0;
  let apiReasoning = "";

  const patchAssistantContent = (content: string) => {
    if (!isOwned() || signal.aborted) return;
    patchContent({ content });
  };

  const patchAssistantState = (patch: AgentContentPatch) => {
    if (!isOwned() || signal.aborted) return;
    patchContent(patch);
  };

  const executeTools = async (): Promise<string> => {
    addExecutionHints();

    const preflightList =
      projectRoot &&
      !signal.aborted &&
      (exploreIntent?.kind === "list" ||
        multiStepPlan[0]?.tool === "list_dir");
    if (preflightList) {
      const listCall: AgentToolCall =
        exploreIntent?.kind === "list"
          ? synthesizeExploreToolCall(exploreIntent)
          : { tool: "list_dir", path: multiStepPlan[0]?.path ?? "." };
      patchAssistantContent("Listing project root…");
      const pre = await abortable(
        executeToolCall(listCall, sidecarUrl, signal, projectRoot),
        signal,
      );
      if (!signal.aborted) {
        onAgentActivity({
          id: createId(),
          at: Date.now(),
          ...pre.activity,
        });
        toolBatchesExecuted = 1;
        exploreFallbackUsed = true;
        forcedExploreTool = null;
        apiMessages.push({
          role: "user",
          content: pre.ok
            ? `【工具结果：list_dir path="${listCall.path ?? "."}"】\n${pre.resultText}\n\n（以上为真实磁盘 listing，不是猜测。）\n用户任务：${trimmed}\n请据此继续后续步骤（如 read_file package.json、修改 README）；未完成则继续调工具，完成后再中文总结。`
            : `【list_dir 失败】${pre.resultText}\n\n请向用户说明 sidecar/项目绑定问题，不要编造目录内容。`,
        });
        if (!pre.ok) {
          patchAssistantContent(
            `Could not list directory: ${pre.resultText}`,
          );
        }
      }
    }

    if (multiStepPlan.length >= 2 && projectRoot && !signal.aborted) {
      for (const step of multiStepPlan) {
        if (step.tool !== "read_file" || !step.path) continue;
        patchAssistantContent(`Reading ${step.path}…`);
        const readExec = await abortable(
          executeToolCall(step, sidecarUrl, signal, projectRoot),
          signal,
        );
        if (signal.aborted) break;
        onAgentActivity({
          id: createId(),
          at: Date.now(),
          ...readExec.activity,
        });
        toolBatchesExecuted += 1;
        apiMessages.push({
          role: "user",
          content: `【工具结果：read_file path="${step.path}"】\n${readExec.resultText}`,
        });
      }
      const followUp = multiStepFollowUpHint(trimmed);
      if (followUp) {
        apiMessages.push({ role: "user", content: followUp });
      }
    }

    const forcedOfficeTool = officeIntent?.tool ?? null;

    while (round < agentMaxRounds) {
      if (signal.aborted) break;

      let roundText = "";
      let streamResult: Awaited<ReturnType<typeof streamChat>>;
      try {
        streamResult = await streamChat(
          llm,
          apiMessages,
          (delta) => {
            roundText += delta;
            const cleaned = stripToolCalls(roundText);
            if (cleaned.length > 0) {
              patchAssistantState({
                content: visibleContent
                  ? `${visibleContent}\n\n${cleaned}`.trim()
                  : cleaned,
                ...(apiReasoning.trim()
                  ? { reasoning: apiReasoning }
                  : {}),
              });
            } else if (!visibleContent && projectRoot) {
              patchAssistantContent(
                createPath
                  ? `Creating ${createPath}…`
                  : officeIntent
                    ? `Creating ${officeIntent.path}…`
                    : explorePlaceholder || "Using project tools…",
              );
            }
          },
          {
            signal,
            temperature: projectRoot ? 0.2 : 0.6,
            tools: useNativeTools ? PROJECT_OPENAI_TOOLS : undefined,
            toolChoice:
              useNativeTools && forcedWrite && round === 0
                ? { type: "function", function: { name: "write_file" } }
                : useNativeTools && forcedOfficeTool && round === 0
                  ? {
                      type: "function",
                      function: { name: forcedOfficeTool },
                    }
                  : useNativeTools && forcedExploreTool && round === 0
                    ? {
                        type: "function",
                        function: { name: forcedExploreTool },
                      }
                    : useNativeTools
                      ? "auto"
                      : undefined,
            onReasoningDelta: (piece) => {
              apiReasoning += piece;
              if (apiReasoning.trim()) {
                patchAssistantState({ reasoning: apiReasoning });
              }
            },
          },
        );
      } catch (e) {
        if (useNativeTools && isToolsUnsupportedError(e)) {
          useNativeTools = false;
          forcedWrite = false;
          continue;
        }
        throw e;
      }

      if (signal.aborted) break;

      roundText = streamResult.content || roundText;
      if (streamResult.reasoning.length >= apiReasoning.length) {
        apiReasoning = streamResult.reasoning;
      }
      {
        const merged = mergeReasoningChannels(
          apiReasoning,
          stripToolCalls(roundText),
        );
        apiReasoning = merged.reasoning;
        roundText = merged.content;
        if (apiReasoning.trim()) {
          patchAssistantState({
            reasoning: apiReasoning,
            ...(roundText
              ? {
                  content: visibleContent
                    ? `${visibleContent}\n\n${roundText}`.trim()
                    : roundText,
                }
              : {}),
          });
        }
      }

      type PendingCall = {
        agent: AgentToolCall;
        native?: ToolCall;
      };
      const pending: PendingCall[] = [];

      if (streamResult.toolCalls.length > 0) {
        for (const tc of streamResult.toolCalls) {
          let agent = agentCallFromOpenAI(tc);
          if (agent) {
            if (
              createPath &&
              agent.tool === "write_file" &&
              (!agent.path || agent.path === "." || agent.path === "file")
            ) {
              agent.path = createPath;
            }
            if (officeIntent && agent.tool === officeIntent.tool) {
              agent = alignOfficeToolCall(agent, officeIntent, trimmed);
            }
            if (
              exploreIntent?.kind === "list" &&
              agent.tool === "list_dir" &&
              (!agent.path || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "read" &&
              agent.tool === "read_file" &&
              (!agent.path || agent.path === "." || agent.path === "file")
            ) {
              agent.path = exploreIntent.path;
            }
            if (
              exploreIntent?.kind === "search" &&
              agent.tool === "search_files" &&
              !agent.query?.trim()
            ) {
              agent.query = exploreIntent.query;
            }
            pending.push({ agent, native: tc });
          }
        }
      } else if (projectRoot) {
        for (const raw of collectToolCalls(
          roundText,
          trimmed,
          apiReasoning,
        )) {
          let agent = raw;
          if (officeIntent && agent.tool === officeIntent.tool) {
            agent = alignOfficeToolCall(agent, officeIntent, trimmed);
          }
          if (
            exploreIntent?.kind === "list" &&
            agent.tool === "list_dir" &&
            (!agent.path || agent.path === "file")
          ) {
            agent.path = exploreIntent.path;
          }
          if (
            exploreIntent?.kind === "read" &&
            agent.tool === "read_file" &&
            (!agent.path || agent.path === "." || agent.path === "file")
          ) {
            agent.path = exploreIntent.path;
          }
          if (
            exploreIntent?.kind === "search" &&
            agent.tool === "search_files" &&
            !agent.query?.trim()
          ) {
            agent.query = exploreIntent.query;
          }
          pending.push({ agent });
        }
      }

      if (
        createPath &&
        projectRoot &&
        !pending.some((p) => p.agent.tool === "write_file")
      ) {
        const synthetic = synthesizeWriteFromReply(trimmed, roundText);
        if (synthetic) {
          pending.push({ agent: synthetic });
        }
      }

      if (
        exploreIntent &&
        projectRoot &&
        !exploreFallbackUsed &&
        toolBatchesExecuted === 0 &&
        !pending.some(
          (p) =>
            p.agent.tool ===
            (exploreIntent.kind === "list"
              ? "list_dir"
              : exploreIntent.kind === "read"
                ? "read_file"
                : "search_files"),
        )
      ) {
        pending.push({
          agent: synthesizeExploreToolCall(exploreIntent),
        });
        exploreFallbackUsed = true;
      }

      if (
        officeIntent &&
        projectRoot &&
        !officeFallbackUsed &&
        !officeToolFailed &&
        !pending.some((p) => p.agent.tool === officeIntent.tool)
      ) {
        pending.push({
          agent: synthesizeOfficeFromIntent(officeIntent, trimmed),
        });
        officeFallbackUsed = true;
      }

      const cleanedRound = stripToolCalls(roundText);

      if (pending.length === 0) {
        if (createPath && projectRoot && round === 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content: `请立刻调用 write_file，path="${createPath}"，content=完整源码。不要只贴代码。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || `Creating ${createPath}…`,
          );
          round += 1;
          forcedWrite = useNativeTools;
          continue;
        }
        if (
          officeIntent &&
          projectRoot &&
          round === 0 &&
          toolBatchesExecuted === 0
        ) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              officeIntent.tool === "write_xlsx"
                ? `不要把工具 JSON 贴给用户。请立刻调用函数 write_xlsx，path="${officeIntent.path}"，rows=完整二维数组。`
                : `不要把工具 JSON 贴给用户。请立刻调用函数 write_docx，path="${officeIntent.path}"，paragraphs 为段落数组（空白文档可用 []）。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || `Creating ${officeIntent.path}…`,
          );
          round += 1;
          continue;
        }
        if (exploreIntent && projectRoot && round === 0) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              exploreIntent.kind === "list"
                ? `请立刻调用 list_dir，path="${exploreIntent.path}"。不要凭猜测列目录。`
                : exploreIntent.kind === "read"
                  ? `请立刻调用 read_file，path="${exploreIntent.path}"。不要编造文件内容。`
                  : `请立刻调用 search_files，query="${exploreIntent.query}"。不要假装已搜索。`,
          });
          visibleContent = cleanedRound;
          patchAssistantContent(
            visibleContent || explorePlaceholder || "Using project tools…",
          );
          round += 1;
          continue;
        }

        if (projectRoot && toolBatchesExecuted === 0 && round < 2) {
          apiMessages.push({
            role: "assistant",
            content: cleanedRound || roundText || "",
          });
          apiMessages.push({
            role: "user",
            content:
              "请立刻调用工具执行（list_dir / read_file / write_file / search_replace / write_docx 等），根据工具返回结果继续；全部完成后再用中文总结。不要只描述计划或假装已完成。",
          });
          visibleContent = cleanedRound;
          patchAssistantContent(visibleContent || "Using project tools…");
          round += 1;
          continue;
        }

        if (
          projectRoot &&
          toolBatchesExecuted > 0 &&
          !cleanedRound.trim() &&
          round < agentMaxRounds - 1
        ) {
          apiMessages.push({
            role: "user",
            content:
              "工具已执行。请根据上述工具结果给出最终中文总结，不要再调用工具。",
          });
          round += 1;
          continue;
        }

        visibleContent = cleanedRound || visibleContent;
        patchAssistantContent(visibleContent);
        break;
      }

      if (streamResult.toolCalls.length > 0) {
        apiMessages.push({
          role: "assistant",
          content: cleanedRound || "",
          tool_calls: streamResult.toolCalls,
        });
      } else {
        apiMessages.push({ role: "assistant", content: roundText || "" });
      }

      if (cleanedRound) {
        visibleContent = visibleContent
          ? `${visibleContent}\n\n${cleanedRound}`.trim()
          : cleanedRound;
        patchAssistantContent(visibleContent);
      } else {
        patchAssistantContent(
          visibleContent ||
            (createPath
              ? `Creating ${createPath}…`
              : officeIntent
                ? `Creating ${officeIntent.path}…`
                : explorePlaceholder || "Using project tools…"),
        );
      }

      let wroteTarget = false;
      let batchHadTools = pending.length > 0;
      let batchHadSuccess = false;
      for (const item of pending) {
        if (signal.aborted) break;
        const executed = await abortable(
          executeToolCall(item.agent, sidecarUrl, signal, projectRoot),
          signal,
        );
        if (signal.aborted) break;
        if (executed.ok) {
          batchHadSuccess = true;
        }
        if (
          item.agent.tool === "write_file" &&
          executed.ok &&
          (pathsMatch(item.agent.path, createPath, projectRoot) ||
            (!createPath && Boolean(item.agent.path)))
        ) {
          wroteTarget = true;
        }
        if (
          officeIntent &&
          item.agent.tool === officeIntent.tool &&
          executed.ok &&
          pathsMatch(item.agent.path, officeIntent.path, projectRoot)
        ) {
          wroteTarget = true;
          officeTargetWritten = true;
        }
        if (
          officeIntent &&
          item.agent.tool === officeIntent.tool &&
          !executed.ok
        ) {
          officeToolFailed = true;
        }
        const activity: AgentActivity = {
          id: createId(),
          at: Date.now(),
          ...executed.activity,
        };
        onAgentActivity(activity);
        if (executed.change) {
          onAgentChange({ ...executed.change, at: Date.now() });
        }

        if (item.native) {
          apiMessages.push(
            nativeToolResultMessage(
              item.native.id,
              item.native.function.name,
              executed.resultText,
              executed.ok,
            ),
          );
        } else {
          apiMessages.push(
            toolResultMessage(item.agent, executed.resultText, executed.ok),
          );
        }
      }

      if (batchHadTools) {
        toolBatchesExecuted += 1;
      }

      if (signal.aborted) break;

      if (createPath && wroteTarget) {
        apiMessages.push({
          role: "user",
          content: `文件 ${createPath} 已写入。请用一两句中文确认路径与作用，不要再调用工具。`,
        });
        forcedWrite = false;
      } else if (officeIntent && wroteTarget) {
        apiMessages.push({
          role: "user",
          content: `文件 ${officeIntent.path} 已写入磁盘。请用一两句中文确认路径，不要再调用工具，也不要把工具 JSON 贴给用户。`,
        });
      } else if (
        officeIntent &&
        batchHadTools &&
        !wroteTarget &&
        pending.some((p) => p.agent.tool === officeIntent.tool)
      ) {
        // Wrong-path or failed office write — do not let the model claim success
        apiMessages.push({
          role: "user",
          content: `目标文件 ${officeIntent.path} 尚未成功写入磁盘。禁止声称创建成功。请立即调用 ${officeIntent.tool}，path 必须精确为 "${officeIntent.path}"。`,
        });
      } else if (
        projectRoot &&
        toolBatchesExecuted > 0 &&
        batchHadTools &&
        batchHadSuccess &&
        !wroteTarget &&
        !createPath &&
        !officeIntent
      ) {
        apiMessages.push({
          role: "user",
          content:
            "请根据上述工具结果判断：若用户任务已完成，请给出最终中文总结且不要再调用工具；仅当原请求仍有未完成的必要步骤时才继续调工具。禁止添加用户未要求的验证操作（如多余的 list_dir）。",
        });
      } else if (officeIntent && officeToolFailed && !officeTargetWritten) {
        visibleContent =
          (visibleContent || cleanedRound) +
          `\n\n（创建 ${officeIntent.path} 失败：${officeIntent.tool} 未成功写入。请确认 npm run dev 已启动 sidecar，或重启 dev 后再试。）`;
        patchAssistantContent(visibleContent.trim());
        break;
      }

      round += 1;
      if (round >= agentMaxRounds) {
        if (officeIntent && !officeTargetWritten) {
          const failNote = `\n\n（未能确认 ${officeIntent.path} 已写入磁盘。请重试，或检查 sidecar / 项目绑定。）`;
          visibleContent = (visibleContent || cleanedRound) + failNote;
          patchAssistantContent(visibleContent.trim());
        } else {
          const note = `\n\n(Reached the tool-round limit (${agentMaxRounds}). Continue from the results so far, or send another message.)`;
          visibleContent = (visibleContent || cleanedRound) + note;
          patchAssistantContent(visibleContent.trim());
        }
      }
    }

    if (
      officeIntent &&
      projectRoot &&
      !officeTargetWritten &&
      toolBatchesExecuted === 0 &&
      !signal.aborted
    ) {
      // Last-resort write so a skipped tool loop cannot end as fake success
      const synth = synthesizeOfficeFromIntent(officeIntent, trimmed);
      patchAssistantContent(`Creating ${officeIntent.path}…`);
      const executed = await abortable(
        executeToolCall(synth, sidecarUrl, signal, projectRoot),
        signal,
      );
      onAgentActivity({
        id: createId(),
        at: Date.now(),
        ...executed.activity,
      });
      if (executed.change) {
        onAgentChange({ ...executed.change, at: Date.now() });
      }
      toolBatchesExecuted += 1;
      if (executed.ok) {
        officeTargetWritten = true;
        visibleContent =
          (visibleContent ? `${visibleContent}\n\n` : "") +
          `已创建 ${officeIntent.path}。`;
      } else {
        visibleContent =
          (visibleContent ? `${visibleContent}\n\n` : "") +
          `创建 ${officeIntent.path} 失败：${executed.resultText}`;
      }
      patchAssistantContent(visibleContent.trim());
    } else if (
      officeIntent &&
      !officeTargetWritten &&
      toolBatchesExecuted > 0 &&
      visibleContent &&
      !/未能确认|失败：|未成功写入/.test(visibleContent)
    ) {
      visibleContent =
        `${visibleContent}\n\n（未能确认 ${officeIntent.path} 已写入磁盘——请勿当作创建成功。）`.trim();
      patchAssistantContent(visibleContent);
    }

    return visibleContent;
  };

  if (requireApproval && !signal.aborted) {
    apiMessages.push({
      role: "system",
      content: buildPlanningPhaseSystem(locale),
    });
    if (createPath) {
      apiMessages.push({
        role: "system",
        content: buildMinimalCreatePlanHint(createPath, locale),
      });
    } else if (officeIntent) {
      apiMessages.push({
        role: "system",
        content: buildMinimalOfficePlanHint(officeIntent, locale),
      });
    }

    type DraftedPlan = {
      displayPlan: string;
      steps: string[];
      deferredSteps: string[];
      totalSteps: number;
      wasChunked: boolean;
    };

    const draftPlanFromModel = async (): Promise<DraftedPlan | null> => {
      patchAssistantContent(
        locale === "zh" ? "正在制定计划…" : "Drafting plan…",
      );

      let planRaw = "";
      await streamChat(
        llm,
        apiMessages,
        (delta) => {
          planRaw += delta;
          const cleaned = stripToolCalls(planRaw);
          if (cleaned.length > 0) {
            patchAssistantContent(cleaned);
          }
        },
        { signal, temperature: 0.3 },
      );

      if (signal.aborted) return null;

      const { planText, steps } = parseAgentPlan(planRaw);
      const limited = limitPlanForApproval(
        planText || planRaw.trim(),
        steps,
        locale,
      );
      const displayPlan = limited.planText || planRaw.trim();
      patchAssistantContent(displayPlan);
      apiMessages.push({ role: "assistant", content: displayPlan });
      return {
        displayPlan,
        steps: limited.steps,
        deferredSteps: limited.deferredSteps,
        totalSteps: limited.totalSteps,
        wasChunked: limited.wasChunked,
      };
    };

    const approvalExecutePrompt = (approvedPlanText: string): string =>
      locale === "zh"
        ? `用户已批准以下计划（仅本轮步骤）。请立即按计划执行，只调用完成该计划所必需的工具；不要额外添加验证步骤（如未经要求的 list_dir），也不要擅自执行未列出的后续步骤。若计划写明无需工具，则只总结、不要调工具。\n\n${approvedPlanText}`
        : `User approved the following plan (this round's steps only). Execute it now with only the tools required by the plan; do not add extra verification steps (e.g. unrequested list_dir), and do not run steps that were not listed. If the plan says no tools are needed, summarize only and do not call tools.\n\n${approvedPlanText}`;

    const presentPlanForApproval = (drafted: DraftedPlan): void => {
      const approvedPlanText = drafted.displayPlan;
      const deferredSteps = drafted.deferredSteps;
      onAwaitPlanApproval({
        planText: drafted.displayPlan,
        steps: drafted.steps,
        totalStepCount: drafted.totalSteps,
        continueExecution: async () => {
          apiMessages.push({
            role: "user",
            content: approvalExecutePrompt(approvedPlanText),
          });
          await executeTools();

          // Approve → run → plan next chunk when steps were deferred.
          if (deferredSteps.length === 0 || signal.aborted) return;

          apiMessages.push({
            role: "user",
            content: buildNextPlanChunkPrompt(deferredSteps, locale),
          });
          const next = await draftPlanFromModel();
          if (!next || signal.aborted) return;
          if (!planNeedsToolApproval(next.displayPlan, next.steps)) return;
          presentPlanForApproval(next);
        },
      });
    };

    const first = await draftPlanFromModel();
    if (!first) {
      return signal.aborted ? "aborted" : "completed";
    }

    // Clear create/office intents must still run tools — never treat a
    // hallucinated "already created" plan as a finished turn.
    if (!planNeedsToolApproval(first.displayPlan, first.steps)) {
      if (createPath || officeIntent) {
        visibleContent = await executeTools();
        return signal.aborted ? "aborted" : "completed";
      }
      return "completed";
    }

    presentPlanForApproval(first);
    return "waiting_plan";
  }

  visibleContent = await executeTools();
  return signal.aborted ? "aborted" : "completed";
}
