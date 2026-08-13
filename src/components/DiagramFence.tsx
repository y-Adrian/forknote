import { useEffect, useId, useState, type ReactNode } from "react";
import { diagramKindFromLanguage } from "../lib/diagramFence";
import { useLocale } from "../lib/i18n";
import { useTheme, type Theme } from "../lib/theme";

function languageFromClass(className?: string): string | null {
  if (!className) return null;
  const m = /(?:^|\s)language-([a-zA-Z0-9_+-]+)/.exec(className);
  return m?.[1] ?? null;
}

type FenceCodeProps = {
  className?: string;
  children: ReactNode;
  /** While the parent answer is still streaming, defer Mermaid render. */
  streaming?: boolean;
};

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (
    id: string,
    text: string,
  ) => Promise<{ svg: string }>;
};

let mermaidMod: MermaidApi | null = null;
let mermaidTheme: string | null = null;

async function getMermaid(theme: Theme): Promise<MermaidApi> {
  if (!mermaidMod) {
    mermaidMod = (await import("mermaid")).default as MermaidApi;
  }
  const themeName = theme === "dark" ? "dark" : "default";
  if (mermaidTheme !== themeName) {
    mermaidMod.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: themeName,
    });
    mermaidTheme = themeName;
  }
  return mermaidMod;
}

/** Shared chrome for source fallback / plantuml / mermaid error. */
function SourceFence({
  className,
  children,
  hint,
}: FenceCodeProps & { hint?: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, "");
  const lines = text.length === 0 ? [""] : text.split("\n");
  const language = languageFromClass(className);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fn-code-block">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">{language ?? "text"}</span>
        <button
          type="button"
          className="fn-code-copy"
          onClick={() => void copy()}
          aria-label={copied ? t("chat.copied") : t("chat.copy")}
          title={copied ? t("chat.copied") : t("chat.copy")}
        >
          {copied ? t("chat.copied") : t("chat.copy")}
        </button>
      </div>
      {hint ? <p className="fn-diagram-hint">{hint}</p> : null}
      <div className="fn-code-body">
        <div className="fn-code-gutter" aria-hidden>
          {lines.map((_, i) => (
            <span key={i} className="fn-code-line-num">
              {i + 1}
            </span>
          ))}
        </div>
        <pre className="fn-code-pre">
          <code className={className}>{text}</code>
        </pre>
      </div>
    </div>
  );
}

function MermaidDiagram({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) {
  const { t } = useLocale();
  const { theme } = useTheme();
  const reactId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (streaming) {
      // Keep last good SVG if any; avoid parse-error flash on partial fences.
      setError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const mermaid = await getMermaid(theme);
          const { svg: rendered } = await mermaid.render(
            `fn-mermaid-${reactId}`,
            source.trim(),
          );
          if (!cancelled) {
            setSvg(rendered);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, theme, reactId, streaming]);

  if (error && !streaming) {
    return (
      <SourceFence
        className="language-mermaid"
        hint={t("chat.diagram.renderFailed", { detail: error })}
      >
        {source}
      </SourceFence>
    );
  }

  if (!svg) {
    return (
      <div className="fn-diagram-block" aria-busy="true">
        <div className="fn-code-toolbar">
          <span className="fn-code-lang">mermaid</span>
        </div>
        <p className="fn-diagram-hint muted">{t("chat.diagram.rendering")}</p>
      </div>
    );
  }

  return (
    <div className="fn-diagram-block">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">mermaid</span>
      </div>
      <div
        className="fn-diagram-svg"
        // Mermaid SVG is sanitized under securityLevel: "strict"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}

/**
 * Fenced ```mermaid / ```plantuml blocks: render Mermaid; PlantUML stays source
 * (no client PlantUML engine bundled).
 */
export function DiagramFence({
  className,
  children,
  streaming = false,
}: FenceCodeProps) {
  const { t } = useLocale();
  const language = languageFromClass(className);
  const kind = diagramKindFromLanguage(language);
  const text = String(children).replace(/\n$/, "");

  if (kind === "mermaid") {
    return <MermaidDiagram source={text} streaming={streaming} />;
  }

  if (kind === "plantuml") {
    return (
      <SourceFence className={className} hint={t("chat.diagram.plantumlFallback")}>
        {children}
      </SourceFence>
    );
  }

  return <SourceFence className={className}>{children}</SourceFence>;
}

export function isDiagramFenceClass(className?: string): boolean {
  return diagramKindFromLanguage(languageFromClass(className)) != null;
}
