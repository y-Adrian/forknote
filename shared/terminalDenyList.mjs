/**
 * Dangerous-shell deny-list for ForkNote `run_terminal` / sidecar POST /fs/run.
 *
 * KEEP IN SYNC with `src/lib/terminalDenyList.ts` (client executeToolCall).
 *
 * Policy notes:
 * - Blocks ALL `sudo` in the agent terminal (safer than allowing elevated forms).
 * - Heuristic only — not a sandbox. Obfuscation can bypass; prefer plan approval + trust.
 * - Must not false-positive common dev: `rm -rf node_modules`, `rm dist`, `npm test`, `git status`, `ls`.
 */

/**
 * @typedef {{ denied: boolean, reason?: string }} DenyTerminalResult
 */

/**
 * Normalize for matching: flatten line continuations / whitespace.
 * @param {string} cmd
 */
export function normalizeTerminalCommand(cmd) {
  return String(cmd ?? "")
    .replace(/\\\r?\n/g, " ")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Force-push targeting main/master (token, not substring of feature-main).
 * @param {string} s
 */
function isGitForceToMain(s) {
  if (!/\bgit\b/.test(s) || !/\bpush\b/.test(s)) return false;
  const force =
    /--force-with-lease\b/.test(s) ||
    /--force\b/.test(s) ||
    /(?:^|[\s])-f(?:\s|$)/.test(s);
  if (!force) return false;
  // argv token or remote/branch ref — not "feature-main"
  return /(?:^|[\s/])(?:main|master)(?:\s|$)/i.test(s);
}

/**
 * @type {ReadonlyArray<{ id: string, test: (s: string) => boolean }>}
 */
const RULES = [
  {
    id: "rm-no-preserve-root",
    test: (s) => /\brm\b[\s\S]*--no-preserve-root\b/i.test(s),
  },
  {
    id: "rm-root",
    // rm … / or /* or /. or /.. (not /tmp, /Users/…, node_modules)
    test: (s) =>
      /\brm\b(?:\s+(?:-[^\s]+|--[^\s]+))*\s+\/(?:\*|\.\.?)?(?:\s|$)/i.test(s),
  },
  { id: "mkfs", test: (s) => /\bmkfs(?:\.\w+)?\b/i.test(s) },
  { id: "fdisk", test: (s) => /\bfdisk\b/i.test(s) },
  {
    id: "dd-dev",
    test: (s) => /\bdd\b[\s\S]*\bof\s*=\s*\/dev\//i.test(s),
  },
  {
    id: "shred-dev",
    test: (s) => /\bshred\b[\s\S]*\/dev\//i.test(s),
  },
  {
    id: "fork-bomb",
    test: (s) => /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/.test(s),
  },
  {
    id: "fork-bomb-alt",
    test: (s) => /\(\s*\)\s*\{\s*\w*\s*\|\s*\w*\s*&\s*\}\s*;/.test(s),
  },
  {
    id: "pipe-to-shell",
    test: (s) =>
      /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i.test(s),
  },
  // Privilege — block all sudo in agent terminal
  {
    id: "sudo",
    test: (s) => /(^|[\s;|&`(])sudo\b/i.test(s),
  },
  {
    id: "chmod-777-root",
    // Note: `-R` has no word-boundary before `-` (space + hyphen).
    test: (s) =>
      /\bchmod\b[\s\S]*-R\b[\s\S]*\b777\b[\s\S]*\s\/(?:\s|$)/i.test(s) ||
      /\bchmod\b[\s\S]*\b777\b[\s\S]*-R\b[\s\S]*\s\/(?:\s|$)/i.test(s),
  },
  {
    id: "chown-root",
    test: (s) => /\bchown\b[\s\S]*-R\b[\s\S]*\s\/(?:\s|$)/i.test(s),
  },
  {
    id: "power",
    test: (s) => /\b(?:shutdown|reboot|halt|poweroff)\b/i.test(s),
  },
  {
    id: "init-0",
    test: (s) => /\b(?:init|telinit)\s+0\b/i.test(s),
  },
  {
    id: "kill-all",
    test: (s) => /\bkill\b(?:\s+-\w+)*\s+(?:--\s+)?-1\b/i.test(s),
  },
  { id: "git-force-main", test: isGitForceToMain },
  {
    id: "redir-system",
    test: (s) =>
      /(?:^|[^>])>{1,2}\s*\/(?:etc|System|usr)(?:\/|\s|$)/i.test(s),
  },
  {
    id: "tee-system",
    test: (s) => /\btee\b[\s\S]*\/(?:etc|System|usr)(?:\/|\s|$)/i.test(s),
  },
];

/**
 * @param {string} cmd
 * @returns {DenyTerminalResult}
 */
export function isDeniedTerminalCommand(cmd) {
  const normalized = normalizeTerminalCommand(cmd);
  if (!normalized) return { denied: false };

  for (const rule of RULES) {
    if (rule.test(normalized)) {
      return {
        denied: true,
        reason: `Command blocked as dangerous by terminal deny-list (${rule.id})`,
      };
    }
  }
  return { denied: false };
}
