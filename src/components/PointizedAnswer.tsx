import { useEffect, useMemo, useState } from "react";
import {
  ATTRIBUTION_AGENT_LABEL,
  REJECT_STREAK_ASK_THRESHOLD,
  hypothesisText,
  pickHypothesisAttribution,
  stripLeakedFeedbackMeta,
} from "../lib/feedback";
import { useLocale } from "../lib/i18n";
import {
  earliestRejectIndex,
  hasExplicitAcceptOrReject,
  parseAnswerPoints,
  stripPointMarkersForPreview,
} from "../lib/points";
import type {
  FeedbackAttribution,
  PointAttributionMap,
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
} from "../types";
import { MarkdownBody } from "./MarkdownBody";
import { LazyMarkdownBody } from "./LazyMarkdownBody";

interface Props {
  content: string;
  verdicts?: PointVerdictMap;
  doubts?: PointDoubtMap;
  attributions?: PointAttributionMap;
  /** Recent reject attributions — used to rotate hypotheses. */
  recentAttributions?: FeedbackAttribution[];
  /** Consecutive reject streak from feedbackLog. */
  rejectStreak?: number;
  onVerdict: (pointIndex: number, verdict: PointVerdict) => void;
  onDoubt: (pointIndex: number, doubt: string) => void;
  onConfirmHypothesis: (
    pointIndex: number,
    attribution: FeedbackAttribution,
  ) => void;
  onDenyHypothesis: (pointIndex: number) => void;
  /** One-click clarify for this numbered point (optional). */
  onClarifyPoint?: (pointIndex: number, pointContent: string) => void;
  /** Integrate current verdicts + clarifies into an archive checkpoint. */
  onIntegrateProgress?: () => void;
  integrating?: boolean;
  /** Defer Mermaid thrash while the parent reply is still streaming. */
  streaming?: boolean;
}

const VERDICT_OPTIONS: Array<{
  value: PointVerdict;
  icon: string;
  titleKey: "verdict.accept" | "verdict.doubt" | "verdict.reject";
}> = [
  { value: "accept", icon: "✓", titleKey: "verdict.accept" },
  { value: "unsure", icon: "?", titleKey: "verdict.doubt" },
  { value: "reject", icon: "✗", titleKey: "verdict.reject" },
];

function PointHypothesisConfirm({
  signal,
  content,
  recentAttributions,
  confirmed,
  rejectStreak = 0,
  onConfirm,
  onDeny,
}: {
  signal: "unsure" | "reject";
  content: string;
  recentAttributions?: FeedbackAttribution[];
  confirmed?: FeedbackAttribution;
  /** Consecutive rejects in feedbackLog — stronger ask when ≥ threshold. */
  rejectStreak?: number;
  onConfirm: (attribution: FeedbackAttribution) => void;
  onDeny: () => void;
}) {
  const { locale, t } = useLocale();
  const guessed = useMemo(
    () => pickHypothesisAttribution(content, recentAttributions),
    [content, recentAttributions],
  );
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [signal, content]);

  if (dismissed) return null;

  if (confirmed) {
    const label =
      signal === "unsure"
        ? t("verdict.hypoUnsureConfirmed")
        : ATTRIBUTION_AGENT_LABEL[confirmed];
    return (
      <p className="point-hypo-confirmed">
        {t("verdict.hypoConfirmed")}：{label}
      </p>
    );
  }

  const question = hypothesisText(signal, guessed, locale === "zh" ? "zh" : "en");
  const strongAsk = signal === "reject" && rejectStreak >= REJECT_STREAK_ASK_THRESHOLD;

  return (
    <div
      className={`point-hypo${strongAsk ? " is-strong" : ""}`}
      role="group"
      aria-label={t("verdict.hypoAria")}
    >
      {strongAsk ? (
        <p className="point-hypo-hint">{t("verdict.hypoStreakHint")}</p>
      ) : null}
      <p className="point-hypo-text">{question}</p>
      <div className="point-hypo-actions">
        <button
          type="button"
          className="point-hypo-btn is-yes"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onConfirm(guessed);
          }}
        >
          {t("verdict.hypoYes")}
        </button>
        <button
          type="button"
          className="point-hypo-btn is-no"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
            onDeny();
          }}
        >
          {t("verdict.hypoNo")}
        </button>
      </div>
    </div>
  );
}

function PointDoubtEditor({
  pointIndex,
  initialDoubt,
  onDoubt,
}: {
  pointIndex: number;
  initialDoubt: string;
  onDoubt: (pointIndex: number, doubt: string) => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(initialDoubt);

  useEffect(() => {
    setDraft(initialDoubt);
  }, [initialDoubt]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed === initialDoubt.trim()) return;
    if (!trimmed && !initialDoubt.trim()) return;
    onDoubt(pointIndex, trimmed);
  };

  return (
    <div className="point-doubt">
      <label className="point-doubt-label" htmlFor={`point-doubt-${pointIndex}`}>
        {t("verdict.doubtNote")}
      </label>
      <textarea
        id={`point-doubt-${pointIndex}`}
        className="point-doubt-input"
        rows={2}
        placeholder={t("verdict.doubtPlaceholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <div className="point-doubt-actions">
        <button
          type="button"
          className="point-doubt-save"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            commit();
          }}
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * 分点反馈 UI（优化版闭环）：
 * 三态按钮可选；存疑/不采纳后用「Agent 假设 + 对/不对」二元确认，而非多选归因。
 */
export function PointizedAnswer({
  content,
  verdicts,
  doubts,
  attributions,
  recentAttributions,
  rejectStreak = 0,
  onVerdict,
  onDoubt,
  onConfirmHypothesis,
  onDenyHypothesis,
  onClarifyPoint,
  onIntegrateProgress,
  integrating = false,
  streaming = false,
}: Props) {
  const { t } = useLocale();
  // While tokens arrive, stay on a single MarkdownBody stream mount — avoid
  // point-splitting + full remounts that thrash as numbered lists grow.
  if (streaming) {
    return (
      <MarkdownBody
        key="stream"
        content={stripPointMarkersForPreview(stripLeakedFeedbackMeta(content))}
        streaming
      />
    );
  }

  const parsed = parseAnswerPoints(content);

  if (parsed.points.length < 2) {
    return (
      <MarkdownBody
        key="flat"
        content={stripLeakedFeedbackMeta(content)}
        streaming={streaming}
      />
    );
  }

  const cut = earliestRejectIndex(verdicts);
  const showCheckpoint =
    Boolean(onIntegrateProgress) && hasExplicitAcceptOrReject(verdicts);

  return (
    <div key={`points-${parsed.points.length}`} className="pointized-answer">
      {parsed.preamble && (
        <div className="point-preamble">
          <MarkdownBody
            content={stripLeakedFeedbackMeta(parsed.preamble)}
            streaming={streaming}
          />
        </div>
      )}

      {parsed.points.map((point) => {
        const verdict = verdicts?.[point.index];
        const truncated = cut != null && point.index > cut && !verdict;
        const needsHypo = verdict === "unsure" || verdict === "reject";
        return (
          <div
            key={point.index}
            className={`point-row${verdict ? ` is-${verdict}` : ""}${truncated ? " is-truncated" : ""}`}
            data-point-index={point.index}
          >
            <div className={`point-block${verdict ? ` is-${verdict}` : ""}${truncated ? " is-truncated" : ""}`}>
              <div className="point-content">
                <LazyMarkdownBody
                  content={stripLeakedFeedbackMeta(point.content)}
                />
              </div>
              {truncated ? (
                <p className="point-truncated-hint">{t("checkpoint.truncated")}</p>
              ) : null}
              {needsHypo && (
                <PointHypothesisConfirm
                  signal={verdict}
                  content={point.content}
                  recentAttributions={recentAttributions}
                  confirmed={attributions?.[point.index]}
                  rejectStreak={rejectStreak}
                  onConfirm={(attr) => onConfirmHypothesis(point.index, attr)}
                  onDeny={() => onDenyHypothesis(point.index)}
                />
              )}
              {verdict === "unsure" && (
                <PointDoubtEditor
                  pointIndex={point.index}
                  initialDoubt={doubts?.[point.index] ?? ""}
                  onDoubt={onDoubt}
                />
              )}
              {verdict === "unsure" && onClarifyPoint ? (
                <p className="point-unsure-clarify-hint">
                  {t("verdict.unsureClarifyHint")}
                </p>
              ) : null}
              <div
                className="point-verdict-group"
                role="group"
                aria-label={t("verdict.pointAria", { n: point.index })}
              >
                {onClarifyPoint ? (
                  <button
                    type="button"
                    className={`point-verdict-btn v-clarify${verdict === "unsure" ? " is-suggested" : ""}`}
                    title={t("clarify.point")}
                    aria-label={t("clarify.point")}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClarifyPoint(point.index, point.content);
                    }}
                  >
                    {t("clarify.pointShort")}
                  </button>
                ) : null}
                {VERDICT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`point-verdict-btn v-${opt.value}${verdict === opt.value ? " active" : ""}`}
                    title={t(opt.titleKey)}
                    aria-label={t(opt.titleKey)}
                    aria-pressed={verdict === opt.value}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVerdict(point.index, opt.value);
                    }}
                  >
                    <span aria-hidden>{opt.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      {showCheckpoint ? (
        <div className="point-checkpoint">
          <p className="point-checkpoint-text">{t("checkpoint.hint")}</p>
          <button
            type="button"
            className="btn ghost sm"
            disabled={integrating}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onIntegrateProgress?.();
            }}
          >
            {integrating ? t("checkpoint.working") : t("checkpoint.action")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
