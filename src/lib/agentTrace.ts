/**
 * Agent loop trace: a bounded, redacted record of one Agent turn (phases,
 * model calls, tool calls, Reflect decisions, approvals, errors) for bug
 * reports. Summary mode keeps short snippets; detailed mode also keeps the
 * prompts and model replies, still size-capped.
 */
import type { ToolCall } from "./openai";

export const AGENT_TRACE_VERSION = 1;
export const MAX_TRACE_EVENTS = 600;
const SUMMARY_SNIP = 600;
const DETAILED_SNIP = 20_000;
/** Total characters kept for detailed prompt/reply bodies per trace. */
const DETAILED_BUDGET = 1_500_000;

export type AgentTraceEventKind =
  | "turn_start"
  | "phase"
  | "llm_call"
  | "tool_call"
  | "reflect"
  | "activity"
  | "approval_requested"
  | "approval_resumed"
  | "segment_end"
  | "paused"
  | "route"
  | "error"
  | "turn_end";

export type AgentTraceEvent = {
  /** Milliseconds since the turn started. */
  t: number;
  kind: AgentTraceEventKind;
  data: Record<string, unknown>;
};

export type AgentTrace = {
  version: typeof AGENT_TRACE_VERSION;
  /** The assistant reply message id this turn wrote into. */
  id: string;
  sessionId: string | null;
  startedAt: number;
  updatedAt: number;
  detailed: boolean;
  env: {
    model: string;
    baseUrlHost: string;
    locale: string;
    projectBound: boolean;
    appVersion?: string;
  };
  userText: string;
  outcome: string | null;
  events: AgentTraceEvent[];
  droppedEvents: number;
};

const SECRET_RES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bjv_live_[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer)\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\b(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',}]{8,}/gi,
];

/** Strip API-key-like strings so a trace is safe to paste. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_RES[0]!, "sk-[redacted]");
  out = out.replace(SECRET_RES[1]!, "jv_live_[redacted]");
  out = out.replace(SECRET_RES[2]!, "$1 [redacted]");
  out = out.replace(SECRET_RES[3]!, "$1$2[redacted]");
  return out;
}

export function snip(text: unknown, max: number): string {
  const raw = typeof text === "string" ? text : JSON.stringify(text ?? "");
  const t = redactSecrets(raw ?? "");
  return t.length <= max ? t : `${t.slice(0, max)}…(+${t.length - max} chars)`;
}

export function safeUrlHost(url: string | undefined | null): string {
  try {
    return url ? new URL(url).host : "(empty)";
  } catch {
    return "(invalid)";
  }
}

type TraceMessage = { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown };

export class AgentTraceRecorder {
  private readonly trace: AgentTrace;
  private readonly now: () => number;
  private detailedChars = 0;
  /** Current loop phase, stamped on model calls. */
  phase = "plan";

  constructor(init: {
    id: string;
    sessionId: string | null;
    userText: string;
    detailed: boolean;
    env: AgentTrace["env"];
    now?: () => number;
  }) {
    this.now = init.now ?? Date.now;
    const startedAt = this.now();
    this.trace = {
      version: AGENT_TRACE_VERSION,
      id: init.id,
      sessionId: init.sessionId,
      startedAt,
      updatedAt: startedAt,
      detailed: init.detailed,
      env: init.env,
      userText: snip(init.userText, 4000),
      outcome: null,
      events: [],
      droppedEvents: 0,
    };
  }

  get detailed(): boolean {
    return this.trace.detailed;
  }

  private get snipMax(): number {
    return this.trace.detailed ? DETAILED_SNIP : SUMMARY_SNIP;
  }

  /** Detailed bodies draw from a per-trace budget, then fall back to summary snippets. */
  private body(text: unknown): string {
    if (!this.trace.detailed) return snip(text, SUMMARY_SNIP);
    const out = snip(text, this.detailedChars < DETAILED_BUDGET ? DETAILED_SNIP : SUMMARY_SNIP);
    this.detailedChars += out.length;
    return out;
  }

  event(kind: AgentTraceEventKind, data: Record<string, unknown> = {}): void {
    const at = this.now();
    this.trace.updatedAt = at;
    if (this.trace.events.length >= MAX_TRACE_EVENTS) {
      // Keep the start of the turn and the newest events; drop the middle.
      this.trace.events.splice(1, 1);
      this.trace.droppedEvents += 1;
    }
    this.trace.events.push({ t: at - this.trace.startedAt, kind, data });
  }

  enterPhase(from: string, to: string, summary?: string): void {
    this.phase = to;
    if (from === to) return;
    this.event("phase", { from, to, ...(summary ? { summary: snip(summary, 300) } : {}) });
  }

  llmCall(args: {
    messages: TraceMessage[];
    durationMs: number;
    toolsOffered?: number;
    toolChoice?: unknown;
    result?: {
      content: string;
      reasoning?: string;
      toolCalls: ToolCall[];
      finishReason: string | null;
      usage?: unknown;
    };
    error?: unknown;
  }): void {
    const last = args.messages[args.messages.length - 1];
    const data: Record<string, unknown> = {
      phase: this.phase,
      durationMs: Math.round(args.durationMs),
      messageCount: args.messages.length,
      lastMessageRole: last?.role ?? null,
      ...(args.toolsOffered !== undefined ? { toolsOffered: args.toolsOffered } : {}),
      ...(args.toolChoice !== undefined ? { toolChoice: args.toolChoice } : {}),
    };
    if (this.trace.detailed) {
      data.messages = args.messages.map((m) => ({
        role: m.role,
        content: this.body(m.content ?? ""),
        ...(m.tool_calls ? { tool_calls: this.body(m.tool_calls) } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      }));
    } else if (last) {
      data.lastMessage = snip(last.content ?? "", SUMMARY_SNIP);
    }
    if (args.result) {
      data.finishReason = args.result.finishReason;
      data.content = this.body(args.result.content);
      if (args.result.reasoning && this.trace.detailed) {
        data.reasoning = this.body(args.result.reasoning);
      }
      data.toolCalls = args.result.toolCalls.map((c) => ({
        name: c.function?.name,
        arguments: snip(c.function?.arguments ?? "", this.snipMax),
      }));
      if (args.result.usage) data.usage = args.result.usage;
    }
    if (args.error !== undefined) data.error = errorText(args.error);
    this.event("llm_call", data);
  }

  toolCall(args: {
    call: Record<string, unknown> & { tool: string };
    durationMs: number;
    ok?: boolean;
    resultText?: string;
    errorType?: string;
    error?: unknown;
  }): void {
    const callArgs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.call)) {
      if (k === "tool" || v === undefined) continue;
      callArgs[k] = snip(v, this.snipMax);
    }
    this.event("tool_call", {
      phase: this.phase,
      tool: args.call.tool,
      args: callArgs,
      durationMs: Math.round(args.durationMs),
      ...(args.ok !== undefined ? { ok: args.ok } : {}),
      ...(args.errorType ? { errorType: args.errorType } : {}),
      ...(args.resultText !== undefined ? { result: this.body(args.resultText) } : {}),
      ...(args.error !== undefined ? { error: errorText(args.error) } : {}),
    });
  }

  error(where: string, err: unknown): void {
    this.event("error", { where, error: errorText(err) });
  }

  finish(outcome: string): void {
    this.trace.outcome = outcome;
    this.event("turn_end", { outcome });
  }

  /** Detached copy for storage or export. */
  snapshot(): AgentTrace {
    return JSON.parse(JSON.stringify(this.trace)) as AgentTrace;
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return snip(`${err.name}: ${err.message}`, 1000);
  return snip(String(err), 1000);
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** One line per event — the part of a trace that is pasted into chat. */
export function formatAgentTraceSummary(trace: AgentTrace, maxChars = 14_000): string {
  const lines: string[] = [
    `- trace: ${trace.id} · ${trace.detailed ? "detailed" : "summary"} · outcome: ${trace.outcome ?? "(running or paused)"}`,
    `- env: model=${trace.env.model} host=${trace.env.baseUrlHost} locale=${trace.env.locale} project=${trace.env.projectBound ? "yes" : "no"}`,
    `- startedAt: ${new Date(trace.startedAt).toISOString()} · events: ${trace.events.length}${trace.droppedEvents ? ` (+${trace.droppedEvents} dropped)` : ""}`,
    "",
  ];
  for (const e of trace.events) {
    const d = e.data;
    const at = `+${fmtMs(e.t)}`;
    let line: string;
    switch (e.kind) {
      case "phase":
        line = `${at} phase ${d.from}→${d.to}${d.summary ? ` (${d.summary})` : ""}`;
        break;
      case "llm_call": {
        const calls = Array.isArray(d.toolCalls) && d.toolCalls.length
          ? ` tools=[${(d.toolCalls as Array<{ name?: string; arguments?: string }>)
              .map((c) => `${c.name}(${snip(c.arguments ?? "", 160)})`).join(", ")}]`
          : "";
        line = `${at} llm[${d.phase}] ${fmtMs(Number(d.durationMs) || 0)} msgs=${d.messageCount}` +
          `${d.toolChoice !== undefined ? ` choice=${JSON.stringify(d.toolChoice)}` : ""}` +
          `${d.finishReason ? ` finish=${d.finishReason}` : ""}${calls}` +
          `${d.content ? ` reply=${JSON.stringify(snip(d.content, 200))}` : ""}` +
          `${d.error ? ` ERROR=${d.error}` : ""}`;
        break;
      }
      case "tool_call":
        line = `${at} tool ${d.tool}(${snip(JSON.stringify(d.args ?? {}), 240)}) ${fmtMs(Number(d.durationMs) || 0)}` +
          ` ${d.ok === false ? "FAIL" : d.ok ? "ok" : ""}${d.errorType ? `[${d.errorType}]` : ""}` +
          `${d.result !== undefined ? ` → ${JSON.stringify(snip(d.result, 240))}` : ""}` +
          `${d.error ? ` ERROR=${d.error}` : ""}`;
        break;
      case "reflect":
        line = `${at} reflect ${d.decision} via ${d.source}${d.expected ? ` expected=${JSON.stringify(snip(d.expected, 160))}` : ""}`;
        break;
      case "activity":
        line = `${at} activity ${d.kind}${d.message ? `: ${snip(d.message, 200)}` : ""}`;
        break;
      default:
        line = `${at} ${e.kind}${Object.keys(d).length ? ` ${snip(JSON.stringify(d), 300)}` : ""}`;
    }
    lines.push(line.trimEnd());
  }
  const text = lines.join("\n");
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n…(truncated; save the trace file for the full record)`;
}

export function agentTraceFilename(trace: AgentTrace): string {
  const stamp = new Date(trace.startedAt).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `forknote-agent-trace-${stamp}.json`;
}
