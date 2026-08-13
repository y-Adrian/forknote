import { useId, type ReactNode } from "react";

/**
 * Anime line-art (动漫线) speech bubble for user messages.
 * Soft ふきだし silhouette, thin ink stroke, pale fill — original SVG only.
 */

/**
 * Soft rounded anime ふきだし with a slight hand-drawn wobble
 * and an integrated gentle tail at the bottom-right.
 */
const BUBBLE_PATH =
  "M38 24" +
  "C46 12 74 8 120 8" +
  "C168 8 200 14 212 30" +
  "C222 44 222 78 214 100" +
  "C208 114 176 124 148 126" +
  "C156 132 168 140 174 148" +
  "C175 150 173 151 171 149" +
  "C162 140 150 130 138 126" +
  "C108 126 68 124 46 112" +
  "C30 102 24 78 26 54" +
  "C28 38 32 28 38 24Z";

interface Props {
  children: ReactNode;
  className?: string;
  /** Tiny anime line sparkles (default true). */
  accent?: boolean;
}

export function AnimeLineBubble({
  children,
  className,
  accent = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const fillId = `fn-anime-line-fill-${uid}`;
  const classes = [
    "ds-bubble",
    "ds-bubble-user",
    "ds-bubble-user--anime-line",
  ];
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <svg
        className="ds-anime-line-chrome"
        viewBox="0 0 240 160"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={fillId}
            x1="16%"
            y1="6%"
            x2="84%"
            y2="94%"
          >
            <stop offset="0%" stopColor="var(--ds-anime-line-hilite)" />
            <stop offset="52%" stopColor="var(--ds-user-bubble)" />
            <stop offset="100%" stopColor="var(--ds-anime-line-shade)" />
          </linearGradient>
        </defs>
        <path
          className="ds-anime-line-fill"
          d={BUBBLE_PATH}
          fill={`url(#${fillId})`}
        />
        <path
          className="ds-anime-line-stroke"
          d={BUBBLE_PATH}
          fill="none"
          stroke="var(--ds-anime-line-border)"
          strokeWidth="1.25"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {accent ? (
        <span className="ds-anime-line-accent" aria-hidden="true">
          <svg
            className="ds-anime-line-doodle"
            viewBox="0 0 40 28"
            width="30"
            height="21"
          >
            {/* Soft キラキラ sparkles — line accents only, keep text primary */}
            <path
              d="M10 8 L10 2 M7 5 L13 5"
              fill="none"
              stroke="var(--ds-anime-line-border)"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
            <path
              d="M24 6 L24 1.5 M21.2 3.8 L26.8 3.8"
              fill="none"
              stroke="var(--ds-anime-line-border)"
              strokeWidth="1"
              strokeLinecap="round"
              opacity="0.72"
            />
            <path
              d="M32 14 C34 11 36 12 35 14 C36 16 34 17 32 14Z"
              fill="none"
              stroke="var(--ds-anime-line-border)"
              strokeWidth="1.05"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />
            <path
              d="M6 18 C8 16.5 9.5 17.2 8.5 18.8 C7.5 20 5.5 19.5 6 18Z"
              fill="none"
              stroke="var(--ds-anime-line-border)"
              strokeWidth="0.95"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.55"
            />
          </svg>
        </span>
      ) : null}

      <div className="ds-anime-line-content">{children}</div>
    </div>
  );
}
