import { useEffect, useState } from "react";
import {
  copyTextToClipboard,
  type CopyTextFeedback,
} from "../lib/clipboard";
import { useLocale } from "../lib/i18n";
import {
  decodeSharePayload,
  sharePayloadToMarkdown,
  type SharePayload,
} from "../lib/sessionShare";
import { AsyncMarkdownBody } from "./AsyncMarkdownBody";
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
  const [feedback, setFeedback] = useState<CopyTextFeedback>("idle");

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
    const ok = await copyTextToClipboard(sharePayloadToMarkdown(payload));
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), 1600);
  };

  const copyLabel =
    feedback === "copied"
      ? t("share.copied")
      : feedback === "failed"
        ? t("share.copyFailed")
        : t("share.copyContent");

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
              className={`btn ghost sm${feedback === "failed" ? " is-copy-failed" : ""}`}
              onClick={() => void copyMarkdown()}
              aria-label={copyLabel}
              title={copyLabel}
            >
              {copyLabel}
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
                    <AsyncMarkdownBody content={msg.content} />
                  </div>
                )}
              </article>
            ))
          : null}
      </main>
    </div>
  );
}
