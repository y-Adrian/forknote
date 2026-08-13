import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";
import {
  decodeSharePayload,
  sharePayloadToMarkdown,
  type SharePayload,
} from "../lib/sessionShare";
import { MarkdownBody } from "./MarkdownBody";
import { GlassMessageBubble } from "./GlassMessageBubble";
interface Props {
  token: string;
  onExit: () => void;
}

export function ShareViewer({ token, onExit }: Props) {
  const { t } = useLocale();
  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void decodeSharePayload(token).then((decoded) => {
      if (cancelled) return;
      if (!decoded || decoded.messages.length === 0) {
        setPayload(null);
        setStatus("error");
        return;
      }
      setPayload(decoded);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copyMarkdown = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(sharePayloadToMarkdown(payload));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fn-share-viewer">
      <header className="fn-share-viewer-header">
        <div className="fn-share-viewer-brand">
          <span className="fn-share-viewer-mark" aria-hidden>
            F
          </span>
          <div>
            <p className="fn-share-viewer-kicker">{t("share.viewerKicker")}</p>
            <h1 className="fn-share-viewer-title">
              {status === "ready" && payload
                ? payload.title || t("share.untitled")
                : t("share.viewerLoading")}
            </h1>
          </div>
        </div>
        <div className="fn-share-viewer-actions">
          {status === "ready" ? (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void copyMarkdown()}
            >
              {copied ? t("share.copied") : t("share.copyContent")}
            </button>
          ) : null}
          <button type="button" className="btn primary sm" onClick={onExit}>
            {t("share.openApp")}
          </button>
        </div>
      </header>

      <main className="fn-share-viewer-main">
        {status === "loading" ? (
          <p className="fn-share-viewer-status">{t("share.viewerLoading")}</p>
        ) : null}
        {status === "error" ? (
          <p className="fn-share-viewer-status is-error" role="alert">
            {t("share.viewerInvalid")}
          </p>
        ) : null}
        {status === "ready" && payload
          ? payload.messages.map((msg, i) => (
              <article
                key={`${msg.role}-${i}`}
                className={`fn-share-viewer-msg fn-share-viewer-msg-${msg.role}`}
              >
                <p className="fn-share-viewer-role">
                  {msg.role === "user"
                    ? t("share.roleUser")
                    : t("share.roleAssistant")}
                </p>
                {msg.role === "user" ? (
                  <GlassMessageBubble>
                    <p>{msg.content}</p>
                  </GlassMessageBubble>
                ) : (
                  <div className="ds-bubble ds-bubble-assistant markdown-body">
                    <MarkdownBody content={msg.content} />
                  </div>
                )}
              </article>
            ))
          : null}
      </main>
    </div>
  );
}
