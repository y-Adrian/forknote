/** Detect fenced languages we treat as diagrams (not plain code). */
export function diagramKindFromLanguage(
  language: string | null | undefined,
): "mermaid" | "plantuml" | null {
  if (!language) return null;
  const lang = language.toLowerCase();
  if (lang === "mermaid") return "mermaid";
  if (lang === "plantuml" || lang === "puml") return "plantuml";
  return null;
}
