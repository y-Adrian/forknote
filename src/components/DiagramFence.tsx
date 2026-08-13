import {
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
    container?: Element,
  ) => Promise<{ svg: string }>;
};

let mermaidMod: MermaidApi | null = null;
let mermaidTheme: string | null = null;
let mermaidRenderSeq = 0;

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

function ensureMermaidHost(): HTMLDivElement {
  const existing = document.querySelector<HTMLDivElement>(
    "[data-fn-mermaid-host]",
  );
  if (existing) return existing;
  const host = document.createElement("div");
  host.setAttribute("data-fn-mermaid-host", "");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
  document.body.appendChild(host);
  return host;
}

/** Shared chrome for source fallback / plantuml / mermaid error / source view. */
function SourceFence({
  className,
  children,
  hint,
  toolbarExtra,
}: FenceCodeProps & {
  hint?: string;
  toolbarExtra?: ReactNode;
}) {
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
        <div className="fn-code-toolbar-actions">
          {toolbarExtra}
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

function DiagramToolbar({
  language,
  showSource,
  onToggleSource,
  onCopy,
  copied,
  canToggle,
}: {
  language: string;
  showSource: boolean;
  onToggleSource?: () => void;
  onCopy: () => void;
  copied: boolean;
  canToggle: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="fn-code-toolbar">
      <span className="fn-code-lang">{language}</span>
      <div className="fn-code-toolbar-actions">
        {canToggle && onToggleSource ? (
          <button
            type="button"
            className="fn-code-copy"
            onClick={onToggleSource}
            aria-pressed={showSource}
            title={
              showSource
                ? t("chat.diagram.viewDiagram")
                : t("chat.diagram.viewSource")
            }
          >
            {showSource
              ? t("chat.diagram.viewDiagram")
              : t("chat.diagram.viewSource")}
          </button>
        ) : null}
        <button
          type="button"
          className="fn-code-copy"
          onClick={onCopy}
          aria-label={copied ? t("chat.copied") : t("chat.copySource")}
          title={copied ? t("chat.copied") : t("chat.copySource")}
        >
          {copied ? t("chat.copied") : t("chat.copySource")}
        </button>
      </div>
    </div>
  );
}

const MermaidDiagram = memo(function MermaidDiagram({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) {
  const { t } = useLocale();
  const { theme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const renderGenRef = useRef(0);

  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source.trimEnd());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (streaming) {
      // Keep last good SVG if any; avoid parse-error flash on partial fences.
      setError(null);
      return;
    }

    const gen = ++renderGenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        const host = ensureMermaidHost();
        try {
          const mermaid = await getMermaid(theme);
          // Fresh id every call — Mermaid v11 caches / temps by id; reuse races
          // StrictMode + React commits into removeChild NotFoundError.
          const id = `fn-mmd-${++mermaidRenderSeq}-${Math.random()
            .toString(36)
            .slice(2, 9)}`;
          host.replaceChildren();
          const { svg: rendered } = await mermaid.render(
            id,
            source.trim(),
            host,
          );
          if (gen !== renderGenRef.current) return;
          setSvg(rendered);
          setError(null);
        } catch (e) {
          if (gen !== renderGenRef.current) return;
          const message = e instanceof Error ? e.message : String(e);
          // Transient DOM races from Mermaid temp-node cleanup — retry once
          // with a new id rather than surfacing removeChild to the user.
          if (/removeChild|NotFoundError/i.test(message)) {
            try {
              const mermaid = await getMermaid(theme);
              const id = `fn-mmd-${++mermaidRenderSeq}-${Math.random()
                .toString(36)
                .slice(2, 9)}`;
              host.replaceChildren();
              const { svg: rendered } = await mermaid.render(
                id,
                source.trim(),
                host,
              );
              if (gen !== renderGenRef.current) return;
              setSvg(rendered);
              setError(null);
              return;
            } catch (e2) {
              if (gen !== renderGenRef.current) return;
              setError(e2 instanceof Error ? e2.message : String(e2));
              return;
            }
          }
          setError(message);
        } finally {
          try {
            host.replaceChildren();
          } catch {
            // ignore
          }
        }
      })();
    }, 180);

    return () => {
      renderGenRef.current += 1;
      window.clearTimeout(timer);
      try {
        document
          .querySelector<HTMLDivElement>("[data-fn-mermaid-host]")
          ?.replaceChildren();
      } catch {
        // ignore
      }
    };
  }, [source, theme, streaming]);

  const sourceToggle = (
    <button
      type="button"
      className="fn-code-copy"
      onClick={() => setShowSource((v) => !v)}
      aria-pressed={showSource}
      title={
        showSource
          ? t("chat.diagram.viewDiagram")
          : t("chat.diagram.viewSource")
      }
    >
      {showSource
        ? t("chat.diagram.viewDiagram")
        : t("chat.diagram.viewSource")}
    </button>
  );

  if (error && !streaming) {
    return (
      <SourceFence
        className="language-mermaid"
        hint={t("chat.diagram.renderFailed", { detail: error })}
        toolbarExtra={svg ? sourceToggle : undefined}
      >
        {source}
      </SourceFence>
    );
  }

  if (showSource || streaming) {
    return (
      <SourceFence
        className="language-mermaid"
        hint={streaming ? t("chat.diagram.rendering") : undefined}
        toolbarExtra={
          !streaming && svg ? (
            <button
              type="button"
              className="fn-code-copy"
              onClick={() => setShowSource(false)}
              title={t("chat.diagram.viewDiagram")}
            >
              {t("chat.diagram.viewDiagram")}
            </button>
          ) : undefined
        }
      >
        {source}
      </SourceFence>
    );
  }

  if (!svg) {
    return (
      <div className="fn-diagram-block" aria-busy="true">
        <DiagramToolbar
          language="mermaid"
          showSource={false}
          onCopy={() => void copySource()}
          copied={copied}
          canToggle={false}
        />
        <p className="fn-diagram-hint muted">{t("chat.diagram.rendering")}</p>
      </div>
    );
  }

  return (
    <div className="fn-diagram-block">
      <DiagramToolbar
        language="mermaid"
        showSource={false}
        onToggleSource={() => setShowSource(true)}
        onCopy={() => void copySource()}
        copied={copied}
        canToggle
      />
      <div
        className="fn-diagram-svg"
        // Mermaid SVG is sanitized under securityLevel: "strict"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
});

/**
 * Fenced ```mermaid / ```plantuml blocks: render Mermaid; PlantUML stays source
 * (no client PlantUML engine bundled) with copyable source.
 */
export const DiagramFence = memo(function DiagramFence({
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
});

export function isDiagramFenceClass(className?: string): boolean {
  return diagramKindFromLanguage(languageFromClass(className)) != null;
}
