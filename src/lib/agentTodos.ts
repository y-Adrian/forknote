/**
 * Model-maintained todo list (`update_todos` tool). The model replaces the
 * whole list on each call; the turn keeps the latest copy, shows progress,
 * and lets approved-plan steps that have no concrete tool call be completed
 * by the model's own status updates.
 */

export type AgentTodoStatus = "pending" | "in_progress" | "completed";

export interface AgentTodo {
  content: string;
  status: AgentTodoStatus;
}

export const MAX_AGENT_TODOS = 20;

const STATUSES = new Set<AgentTodoStatus>(["pending", "in_progress", "completed"]);

/** Validate tool arguments; returns an error string when unusable. */
export function parseTodos(raw: unknown): AgentTodo[] | string {
  if (!Array.isArray(raw)) return "todos must be an array of {content, status}";
  if (raw.length > MAX_AGENT_TODOS) return `at most ${MAX_AGENT_TODOS} todos`;
  const todos: AgentTodo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return "each todo must be an object";
    const { content, status } = item as Record<string, unknown>;
    if (typeof content !== "string" || !content.trim()) {
      return "each todo needs non-empty content";
    }
    const s = typeof status === "string" ? status.trim().toLowerCase() : "pending";
    if (!STATUSES.has(s as AgentTodoStatus)) {
      return `invalid status "${String(status)}" (use pending / in_progress / completed)`;
    }
    todos.push({ content: content.trim(), status: s as AgentTodoStatus });
  }
  return todos;
}

/** Checklist text echoed back to the model and shown in activity. */
export function formatTodos(todos: AgentTodo[]): string {
  if (todos.length === 0) return "(todo list cleared)";
  return todos
    .map((t) => `${t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[>]" : "[ ]"} ${t.content}`)
    .join("\n");
}

/** One-line progress summary, e.g. "Todos 2/5 · Update tests". */
export function summarizeTodos(todos: AgentTodo[]): string {
  const done = todos.filter((t) => t.status === "completed").length;
  const current = todos.find((t) => t.status === "in_progress");
  return `Todos ${done}/${todos.length}${current ? ` · ${current.content}` : ""}`;
}

/** Normalize a step/todo line for loose matching (numbering, case, spaces). */
export function normalizeTodoText(text: string): string {
  return text
    .replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
