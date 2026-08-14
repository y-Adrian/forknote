/** Visibility helpers for deferred point Markdown mounts. */

export function shouldMountHeavyMarkdown(options: {
  visible: boolean;
  /** Force full mount (e.g. streaming parent already collapsed to one body). */
  force?: boolean;
}): boolean {
  if (options.force) return true;
  return options.visible;
}

/** Plain placeholder keeps skim text without ReactMarkdown / diagram init. */
export function deferredMarkdownPreview(content: string, maxChars = 280): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trimEnd()}…`;
}
