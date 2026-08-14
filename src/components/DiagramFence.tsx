import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  copyDiagramImage,
  type CopyDiagramImageResult,
} from "../lib/copyDiagramImage";
import {
  copyTextToClipboard,
  type CopyTextFeedback,
} from "../lib/clipboard";
import { diagramKindFromLanguage } from "../lib/diagramFence";
import { useLocale } from "../lib/i18n";
import {
  resolvePlantumlJavaPath,
  resolvePlantumlLocalPath,
  resolvePlantumlRenderMode,
  resolvePlantumlServerUrl,
} from "../lib/settings";
import { renderPlantuml } from "../lib/sidecar";
import { plantumlSvgToObjectUrl } from "../lib/sanitizePlantumlSvg";
import { useTheme, type Theme } from "../lib/theme";
import { useAppStore } from "../store/useAppStore";

type CopyImageFeedback = "idle" | CopyDiagramImageResult;

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
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");
  const text = String(children).replace(/\n$/, "");
  const lines = text.length === 0 ? [""] : text.split("\n");
  const language = languageFromClass(className);

  const copy = async () => {
    const ok = await copyTextToClipboard(text);
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1400);
  };

  const label =
    feedback === "copied"
      ? t("chat.copied")
      : feedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.copy");

  return (
    <div className="fn-code-block">
      <div className="fn-code-toolbar">
        <span className="fn-code-lang">{language ?? "text"}</span>
        <div className="fn-code-toolbar-actions">
          {toolbarExtra}
          <button
            type="button"
            className={`fn-code-copy${feedback === "failed" ? " is-copy-failed" : ""}`}
            onClick={() => void copy()}
            aria-label={label}
            title={label}
          >
            {label}
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
  copyFeedback,
  canToggle,
  onCopyImage,
  copyImageFeedback = "idle",
  canCopyImage = false,
}: {
  language: string;
  showSource: boolean;
  onToggleSource?: () => void;
  onCopy: () => void;
  copyFeedback: CopyTextFeedback;
  canToggle: boolean;
  onCopyImage?: () => void;
  copyImageFeedback?: CopyImageFeedback;
  canCopyImage?: boolean;
}) {
  const { t } = useLocale();
  const imageLabel =
    copyImageFeedback === "copied"
      ? t("chat.diagram.imageCopied")
      : copyImageFeedback === "downloaded"
        ? t("chat.diagram.imageDownloaded")
        : copyImageFeedback === "failed"
          ? t("chat.diagram.copyImageFailed")
          : t("chat.diagram.copyImage");
  const sourceLabel =
    copyFeedback === "copied"
      ? t("chat.copied")
      : copyFeedback === "failed"
        ? t("chat.copyFailed")
        : t("chat.copySource");
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
            aria-label={
              showSource
                ? t("chat.diagram.viewDiagram")
                : t("chat.diagram.viewSource")
            }
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
        {canCopyImage && onCopyImage ? (
          <button
            type="button"
            className="fn-code-copy"
            onClick={onCopyImage}
            aria-label={imageLabel}
            title={imageLabel}
          >
            {imageLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={`fn-code-copy${copyFeedback === "failed" ? " is-copy-failed" : ""}`}
          onClick={onCopy}
          aria-label={sourceLabel}
          title={sourceLabel}
        >
          {sourceLabel}
        </button>
      </div>
    </div>
  );
}

/** Accessible figure wrapper: type label + screen-reader source relationship. */
function DiagramAccessibleFrame({
  kind,
  source,
  toolbar,
  children,
}: {
  kind: "mermaid" | "plantuml";
  source: string;
  toolbar: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const labelId = useId();
  const descId = useId();
  const label =
    kind === "mermaid"
      ? t("chat.diagram.mermaidLabel")
      : t("chat.diagram.plantumlLabel");
  const sourcePreview = source.trim().replace(/\s+/g, " ").slice(0, 280);
  return (
    <figure
      className="fn-diagram-block"
      aria-labelledby={labelId}
      aria-describedby={descId}
    >
      {toolbar}
      <figcaption id={labelId} className="sr-only">
        {label}
      </figcaption>
      <div className="fn-diagram-svg" aria-hidden="true">
        {children}
      </div>
      <p id={descId} className="sr-only">
        {t("chat.diagram.sourceDescription", { source: sourcePreview })}
      </p>
    </figure>
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
  const [copyFeedback, setCopyFeedback] = useState<CopyTextFeedback>("idle");
  const [copyImageFeedback, setCopyImageFeedback] =
    useState<CopyImageFeedback>("idle");
  const renderGenRef = useRef(0);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const copyImageTimerRef = useRef<number | null>(null);

  const copySource = async () => {
    const ok = await copyTextToClipboard(source.trimEnd());
    setCopyFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyFeedback("idle"), 1400);
  };

  const handleCopyImage = () => {
    void (async () => {
      const svgEl = svgHostRef.current?.querySelector("svg");
      const result = await copyDiagramImage({
        svgElement: svgEl ?? null,
        downloadName: "mermaid-diagram.png",
      });
      setCopyImageFeedback(result);
      if (copyImageTimerRef.current != null) {
        window.clearTimeout(copyImageTimerRef.current);
      }
      copyImageTimerRef.current = window.setTimeout(() => {
        setCopyImageFeedback("idle");
        copyImageTimerRef.current = null;
      }, 1600);
    })();
  };

  useEffect(() => {
    return () => {
      if (copyImageTimerRef.current != null) {
        window.clearTimeout(copyImageTimerRef.current);
      }
    };
  }, []);

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
      <div
        className="fn-diagram-block"
        aria-busy="true"
        aria-label={t("chat.diagram.mermaidLabel")}
      >
        <DiagramToolbar
          language="mermaid"
          showSource={false}
          onCopy={() => void copySource()}
          copyFeedback={copyFeedback}
          canToggle={false}
        />
        <p className="fn-diagram-hint muted">{t("chat.diagram.rendering")}</p>
      </div>
    );
  }

  return (
    <DiagramAccessibleFrame
      kind="mermaid"
      source={source}
      toolbar={
        <DiagramToolbar
          language="mermaid"
          showSource={false}
          onToggleSource={() => setShowSource(true)}
          onCopy={() => void copySource()}
          copyFeedback={copyFeedback}
          canToggle
          canCopyImage
          onCopyImage={handleCopyImage}
          copyImageFeedback={copyImageFeedback}
        />
      }
    >
      <div
        ref={svgHostRef}
        // Mermaid SVG is sanitized under securityLevel: "strict"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </DiagramAccessibleFrame>
  );
});

type PlantumlVisual =
  | { kind: "image"; src: string; revoke?: () => void };

const PlantumlDiagram = memo(function PlantumlDiagram({
  source,
  streaming = false,
}: {
  source: string;
  streaming?: boolean;
}) {
  const { t } = useLocale();
  const settings = useAppStore((s) => s.settings);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const mode = resolvePlantumlRenderMode(settings);
  const [visual, setVisual] = useState<PlantumlVisual | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyTextFeedback>("idle");
  const [copyImageFeedback, setCopyImageFeedback] =
    useState<CopyImageFeedback>("idle");
  const renderGenRef = useRef(0);
  const visualHostRef = useRef<HTMLDivElement>(null);
  const copyImageTimerRef = useRef<number | null>(null);
  const visualRevokeRef = useRef<(() => void) | null>(null);

  const replaceVisual = (next: PlantumlVisual | null) => {
    visualRevokeRef.current?.();
    visualRevokeRef.current = next?.revoke ?? null;
    setVisual(next);
  };

  const copySource = async () => {
    const ok = await copyTextToClipboard(source.trimEnd());
    setCopyFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyFeedback("idle"), 1400);
  };

  const handleCopyImage = () => {
    void (async () => {
      const host = visualHostRef.current;
      const imgEl = host?.querySelector("img") ?? null;
      const result = await copyDiagramImage({
        svgElement: null,
        imageElement: imgEl,
        pngDataUrl: visual?.src ?? imgEl?.src ?? null,
        downloadName: "plantuml-diagram.png",
      });
      setCopyImageFeedback(result);
      if (copyImageTimerRef.current != null) {
        window.clearTimeout(copyImageTimerRef.current);
      }
      copyImageTimerRef.current = window.setTimeout(() => {
        setCopyImageFeedback("idle");
        copyImageTimerRef.current = null;
      }, 1600);
    })();
  };

  useEffect(() => {
    return () => {
      if (copyImageTimerRef.current != null) {
        window.clearTimeout(copyImageTimerRef.current);
      }
      visualRevokeRef.current?.();
      visualRevokeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode === "off") {
      replaceVisual(null);
      setError(null);
      return;
    }
    if (streaming) {
      setError(null);
      return;
    }

    const gen = ++renderGenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await renderPlantuml(
            {
              mode,
              source,
              serverUrl: resolvePlantumlServerUrl(settings),
              localPath: resolvePlantumlLocalPath(settings),
              javaPath: resolvePlantumlJavaPath(settings),
              format: "svg",
            },
            sidecarUrl,
          );
          if (gen !== renderGenRef.current) return;
          if (result.format === "svg" && result.svg) {
            const src = plantumlSvgToObjectUrl(result.svg);
            replaceVisual({
              kind: "image",
              src,
              revoke: () => URL.revokeObjectURL(src),
            });
          } else if (result.format === "png" && result.imageBase64) {
            replaceVisual({
              kind: "image",
              src: `data:image/png;base64,${result.imageBase64}`,
            });
          } else {
            setError("Empty PlantUML render result");
            return;
          }
          setError(null);
        } catch (e) {
          if (gen !== renderGenRef.current) return;
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 220);

    return () => {
      renderGenRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [source, streaming, mode, settings, sidecarUrl]);

  if (mode === "off") {
    return (
      <SourceFence
        className="language-plantuml"
        hint={t("chat.diagram.plantumlFallback")}
      >
        {source}
      </SourceFence>
    );
  }

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
        className="language-plantuml"
        hint={t("chat.diagram.renderFailed", { detail: error })}
        toolbarExtra={visual ? sourceToggle : undefined}
      >
        {source}
      </SourceFence>
    );
  }

  if (showSource || streaming) {
    return (
      <SourceFence
        className="language-plantuml"
        hint={streaming ? t("chat.diagram.rendering") : undefined}
        toolbarExtra={
          !streaming && visual ? (
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

  if (!visual) {
    return (
      <div
        className="fn-diagram-block"
        aria-busy="true"
        aria-label={t("chat.diagram.plantumlLabel")}
      >
        <DiagramToolbar
          language="plantuml"
          showSource={false}
          onCopy={() => void copySource()}
          copyFeedback={copyFeedback}
          canToggle={false}
        />
        <p className="fn-diagram-hint muted">{t("chat.diagram.rendering")}</p>
      </div>
    );
  }

  return (
    <DiagramAccessibleFrame
      kind="plantuml"
      source={source}
      toolbar={
        <DiagramToolbar
          language="plantuml"
          showSource={false}
          onToggleSource={() => setShowSource(true)}
          onCopy={() => void copySource()}
          copyFeedback={copyFeedback}
          canToggle
          canCopyImage
          onCopyImage={handleCopyImage}
          copyImageFeedback={copyImageFeedback}
        />
      }
    >
      <div ref={visualHostRef}>
        <img src={visual.src} alt="" />
      </div>
    </DiagramAccessibleFrame>
  );
});

/**
 * Fenced ```mermaid / ```plantuml blocks: Mermaid always renders client-side;
 * PlantUML renders when Settings → plantumlRenderMode is server/local.
 */
export const DiagramFence = memo(function DiagramFence({
  className,
  children,
  streaming = false,
}: FenceCodeProps) {
  const language = languageFromClass(className);
  const kind = diagramKindFromLanguage(language);
  const text = String(children).replace(/\n$/, "");

  if (kind === "mermaid") {
    return <MermaidDiagram source={text} streaming={streaming} />;
  }

  if (kind === "plantuml") {
    return <PlantumlDiagram source={text} streaming={streaming} />;
  }

  return <SourceFence className={className}>{children}</SourceFence>;
});

export function isDiagramFenceClass(className?: string): boolean {
  return diagramKindFromLanguage(languageFromClass(className)) != null;
}
