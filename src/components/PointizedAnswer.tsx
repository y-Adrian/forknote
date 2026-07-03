import { parseAnswerPoints, VERDICT_LABELS } from "../lib/points";
import type { PointVerdict, PointVerdictMap } from "../types";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  content: string;
  verdicts?: PointVerdictMap;
  onVerdict: (pointIndex: number, verdict: PointVerdict) => void;
}

const VERDICT_OPTIONS: Array<{ value: PointVerdict; icon: string }> = [
  { value: "accept", icon: "✓" },
  { value: "unsure", icon: "?" },
  { value: "reject", icon: "✗" },
];

/**
 * 按「【N】」分点渲染回答，每个分点带 采纳/不置可否/拒绝 裁决按钮。
 * 不足 2 个分点时退化为普通 Markdown。
 */
export function PointizedAnswer({ content, verdicts, onVerdict }: Props) {
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
            className={`point-block${verdict ? ` is-${verdict}` : ""}`}
          >
            <div className="point-block-head">
              <span className="point-badge">{point.index}</span>
              <div
                className="point-verdict-group"
                role="group"
                aria-label={`分点 ${point.index} 裁决`}
              >
                {VERDICT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`point-verdict-btn v-${opt.value}${verdict === opt.value ? " active" : ""}`}
                    title={VERDICT_LABELS[opt.value]}
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
            <div className="point-content">
              <MarkdownBody content={point.content} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
