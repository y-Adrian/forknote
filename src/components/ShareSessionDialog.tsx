import { useEffect, useMemo, useState } from "react";
import { useLocale } from "../lib/i18n";
import {
  SHARE_HARD_LIMIT,
  SHARE_SOFT_LIMIT,
  buildShareMarkdownFilename,
  buildShareHtmlFilename,
  buildSharePayload,
  buildShareUrl,
  downloadShareHtml,
  downloadShareMarkdown,
  encodeSharePayload,
  getShareableMessages,
  previewText,
  sessionToExportMarkdown,
  sharePayloadToHtml,
  type ShareableMessage,
} from "../lib/sessionShare";
import { copyTextToClipboard } from "../lib/clipboard";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";
import { AccessibleModal } from "./AccessibleModal";

interface Props {
  sessionId: NodeId;
  onClose: () => void;
}

export function ShareSessionDialog({ sessionId, onClose }: Props) {
  const { t } = useLocale();
  const session = useAppStore((s) =>
    s.sessions.find((item) => item.id === sessionId),
  );
  const messages = useMemo(
    () => (session ? getShareableMessages(session) : []),
    [session],
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(messages.map((m) => m.id)),
  );
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnSoft, setWarnSoft] = useState(false);
  const [copiedKind, setCopiedKind] = useState<"link" | "content" | null>(null);
  const [includeClarifications, setIncludeClarifications] = useState(true);
  const [includeArchives, setIncludeArchives] = useState(false);
  const [includeTimestamps, setIncludeTimestamps] = useState(false);

  useEffect(() => {
    if (!session) onClose();
  }, [session, onClose]);

  // Drop selections for messages that disappeared; keep new live messages unchecked.
  useEffect(() => {
    const liveIds = new Set(messages.map((m) => m.id));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [messages]);

  const selectedCount = messages.reduce(
    (count, msg) => count + (selected.has(msg.id) ? 1 : 0),
    0,
  );
  const allSelected =
    messages.length > 0 && selectedCount === messages.length;

  const resetFeedback = () => {
    setLink(null);
    setError(null);
    setWarnSoft(false);
    setCopiedKind(null);
  };

  const toggle = (id: string) => {
    resetFeedback();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    resetFeedback();
    setSelected(new Set(messages.map((m) => m.id)));
  };

  const clearAll = () => {
    resetFeedback();
    setSelected(new Set());
  };

  const selectedMessages = (): ShareableMessage[] =>
    messages.filter((m) => selected.has(m.id));

  const exportHtml = () => {
    if (!session) return;
    if (selectedCount === 0 && messages.length > 0) {
      setError(t("share.noneSelected"));
      return;
    }
    setError(null);
    setCopiedKind(null);
    try {
      const payload = buildSharePayload(session.title, selectedMessages());
      const html = sharePayloadToHtml(payload, {
        brand: "ForkNote",
        roleUser: t("share.roleUser"),
        roleAssistant: t("share.roleAssistant"),
        empty: t("share.empty"),
        footerNote: t("share.htmlFooter"),
      });
      downloadShareHtml(html, buildShareHtmlFilename(payload.title));
    } catch {
      setError(t("share.exportFailed"));
    }
  };

  const createLink = async () => {
    if (!session) return;
    if (selectedCount === 0 && messages.length > 0) {
      setError(t("share.noneSelected"));
      return;
    }
    setBusy(true);
    setError(null);
    setWarnSoft(false);
    setCopiedKind(null);
    try {
      const payload = buildSharePayload(session.title, selectedMessages());
      const { token, encodedLength } = await encodeSharePayload(payload);
      if (encodedLength > SHARE_HARD_LIMIT) {
        setError(t("share.tooLarge", { limit: String(SHARE_HARD_LIMIT) }));
        setLink(null);
        return;
      }
      if (encodedLength > SHARE_SOFT_LIMIT) {
        setWarnSoft(true);
      }
      setLink(buildShareUrl(token));
    } catch {
      setError(t("share.encodeFailed"));
      setLink(null);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (text: string, kind: "link" | "content") => {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKind(kind);
      setError(null);
      return;
    }
    setCopiedKind(null);
    setError(t("share.copyFailed"));
  };

  const copyMarkdown = () => {
    if (!session) return;
    const md = sessionToExportMarkdown(session, selected, {
      includeClarifications,
      includeArchives,
      includeTimestamps,
    });
    void copyText(md, "content");
  };

  const exportMarkdown = () => {
    if (!session) return;
    try {
      const markdown = sessionToExportMarkdown(session, selected, {
        includeClarifications,
        includeArchives,
        includeTimestamps,
      });
      downloadShareMarkdown(
        markdown,
        buildShareMarkdownFilename(session.title),
      );
      setError(null);
    } catch {
      setError(t("share.exportMarkdownFailed"));
    }
  };

  if (!session) return null;

  return (
    <AccessibleModal
      open
      onClose={onClose}
      labelledBy="fn-share-title"
      className="modal fn-share-modal"
    >
        <header className="fn-share-header">
          <div>
            <h2 id="fn-share-title">{t("share.title")}</h2>
            <p className="fn-share-hint">{t("share.hint")}</p>
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            {t("common.close")}
          </button>
        </header>

        <div className="fn-share-toolbar">
          <span className="fn-share-count">
            {t("share.selectedCount", {
              selected: selectedCount,
              total: messages.length,
            })}
          </span>
          <div className="fn-share-toolbar-actions">
            <button
              type="button"
              className="btn ghost sm"
              onClick={selectAll}
              disabled={allSelected || messages.length === 0}
            >
              {t("share.selectAll")}
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={clearAll}
              disabled={selectedCount === 0}
            >
              {t("share.clear")}
            </button>
          </div>
        </div>

        <ul className="fn-share-list" role="listbox" aria-multiselectable="true">
          {messages.length === 0 ? (
            <li className="fn-share-empty">{t("share.empty")}</li>
          ) : (
            messages.map((msg) => {
              const checked = selected.has(msg.id);
              return (
                <li key={msg.id}>
                  <label
                    className={`fn-share-row${checked ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(msg.id)}
                    />
                    <span
                      className={`fn-share-role fn-share-role-${msg.role}`}
                    >
                      {msg.role === "user"
                        ? t("share.roleUser")
                        : t("share.roleAssistant")}
                    </span>
                    <span className="fn-share-preview">
                      {previewText(msg.content)}
                    </span>
                  </label>
                </li>
              );
            })
          )}
        </ul>

        <div className="fn-share-export-options" aria-label={t("share.exportOptions")}>
          <label>
            <input
              type="checkbox"
              checked={includeClarifications}
              onChange={(event) => setIncludeClarifications(event.target.checked)}
            />
            {t("share.includeClarifications")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeArchives}
              onChange={(event) => setIncludeArchives(event.target.checked)}
            />
            {t("share.includeArchives")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeTimestamps}
              onChange={(event) => setIncludeTimestamps(event.target.checked)}
            />
            {t("share.includeTimestamps")}
          </label>
        </div>

        {error ? (
          <p className="fn-share-error" role="alert">
            {error}
          </p>
        ) : null}
        {warnSoft && !error ? (
          <p className="fn-share-warn" role="status">
            {t("share.softWarn")}
          </p>
        ) : null}

        {link ? (
          <div className="fn-share-result">
            <label className="fn-share-link-label" htmlFor="fn-share-link">
              {t("share.linkLabel")}
            </label>
            <div className="fn-share-link-row">
              <input
                id="fn-share-link"
                className="fn-share-link-input"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn primary sm"
                onClick={() => void copyText(link, "link")}
              >
                {copiedKind === "link" ? t("share.copied") : t("share.copyLink")}
              </button>
            </div>
            <p className="fn-share-link-note">{t("share.linkNote")}</p>
          </div>
        ) : null}

        <footer className="fn-share-footer">
          <div className="fn-share-footer-secondary">
            <button
              type="button"
              className="btn ghost"
              onClick={exportMarkdown}
              disabled={messages.length > 0 && selectedCount === 0}
            >
              {t("share.exportMarkdown")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={copyMarkdown}
              disabled={messages.length > 0 && selectedCount === 0}
            >
              {copiedKind === "content"
                ? t("share.copied")
                : t("share.copyContent")}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void createLink()}
              disabled={busy || (messages.length > 0 && selectedCount === 0)}
            >
              {busy ? t("share.creating") : t("share.createLink")}
            </button>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={exportHtml}
            disabled={messages.length > 0 && selectedCount === 0}
          >
            {t("share.exportHtml")}
          </button>
        </footer>
    </AccessibleModal>
  );
}
