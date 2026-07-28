import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";
import { parseAnswerPoints } from "../lib/points";
import type {
  PointDoubtMap,
  PointVerdict,
  PointVerdictMap,
} from "../types";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  content: string;
  verdicts?: PointVerdictMap;
  doubts?: PointDoubtMap;
  onVerdict: (pointIndex: number, verdict: PointVerdict) => void;
  onDoubt: (pointIndex: number, doubt: string) => void;
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
    // 空文案视为取消存疑；非空且未改动则跳过
    if (trimmed && trimmed === initialDoubt.trim()) return;
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
        autoFocus={!initialDoubt.trim()}
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
 * 按「【N】」分点渲染回答；段落间用块区分，不展示编号角标。
 * 采纳/存疑/不采纳小图标竖排在内容块外侧右侧，尽量不挤占正文版式。
 * 缺省未点击 = 采纳（上下文侧）；UI 保持中性，不强制高亮。
 * 不足 2 个分点时退化为普通 Markdown。
 */
export function PointizedAnswer({
  content,
  verdicts,
  doubts,
  onVerdict,
  onDoubt,
}: Props) {
  const { t } = useLocale();
  const parsed = parseAnswerPoints(content);

  if (parsed.points.length < 2) {
    return <MarkdownBody content={content} />;
  }

  return (
    <div className="pointized-answer">
      {parsed.preamble && (
        <div className="point-preamble">
          <MarkdownBody content={parsed.preamble} />
        </div>
      )}

      {parsed.points.map((point) => {
        const verdict = verdicts?.[point.index];
        return (
          <div
            key={point.index}
            className={`point-row${verdict ? ` is-${verdict}` : ""}`}
          >
            <div className={`point-block${verdict ? ` is-${verdict}` : ""}`}>
              <div className="point-content">
                <MarkdownBody content={point.content} />
              </div>
              {verdict === "unsure" && (
                <PointDoubtEditor
                  pointIndex={point.index}
                  initialDoubt={doubts?.[point.index] ?? ""}
                  onDoubt={onDoubt}
                />
              )}
            </div>
            <div
              className="point-verdict-group"
              role="group"
              aria-label={t("verdict.pointAria", { n: point.index })}
            >
              {VERDICT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`point-verdict-btn v-${opt.value}${verdict === opt.value ? " active" : ""}`}
                  title={t(opt.titleKey)}
                  aria-pressed={verdict === opt.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onVerdict(point.index, opt.value);
                  }}
                >
                  {opt.icon}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
