/**
 * User-defined terminal command rules (Settings → Project):
 * - deny: matching commands never run, even after approval.
 * - allow: matching commands skip the approval card (in or outside project).
 *
 * Rules are command prefixes matched at word boundaries ("npm test" matches
 * "npm test -- --watch" but not "npm tester"). Compound commands are split on
 * shell operators: one denied segment denies the whole command, and it is
 * only auto-allowed when every segment is allowed. Command substitution is
 * never auto-allowed. Heuristic policy, not a sandbox.
 */
import type { ApiSettings } from "../types";
import { normalizeTerminalCommand } from "./terminalDenyList";

export type CommandPermission = "allow" | "deny" | "ask";

/** Normalize a user-entered rule list: trim, drop blanks and duplicates. */
export function normalizeCommandRules(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const rule = normalizeTerminalCommand(item);
    if (rule && !out.includes(rule)) out.push(rule);
  }
  return out;
}

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => normalizeTerminalCommand(s))
    .filter(Boolean);
}

function matchesRule(segment: string, rule: string): boolean {
  return segment === rule || segment.startsWith(`${rule} `);
}

/** Decide a command against allow/deny rules; deny always wins. */
export function resolveCommandPermission(
  command: string | undefined | null,
  rules: { allow?: string[]; deny?: string[] },
): CommandPermission {
  const normalized = normalizeTerminalCommand(command ?? "");
  if (!normalized) return "ask";
  const segments = splitSegments(normalized);
  const deny = rules.deny ?? [];
  const allow = rules.allow ?? [];
  if (segments.some((seg) => deny.some((rule) => matchesRule(seg, rule)))) {
    return "deny";
  }
  if (/\$\(|`/.test(normalized)) return "ask";
  if (
    segments.length > 0 &&
    segments.every((seg) => allow.some((rule) => matchesRule(seg, rule)))
  ) {
    return "allow";
  }
  return "ask";
}

export function commandPermissionFromSettings(
  command: string | undefined | null,
  settings: Pick<ApiSettings, "agentCommandAllow" | "agentCommandDeny">,
): CommandPermission {
  return resolveCommandPermission(command, {
    allow: settings.agentCommandAllow,
    deny: settings.agentCommandDeny,
  });
}

/** Result text for a denied call; "not allowed" classifies as a permission error. */
export function deniedCommandMessage(command: string): string {
  return `Error: command not allowed by a user deny rule (Settings → Project): ${command}. Do not retry it; tell the user or choose a different approach.`;
}
