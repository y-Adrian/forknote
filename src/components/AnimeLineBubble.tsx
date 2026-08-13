import { useId, type ReactNode } from "react";

/**
 * Comic thought-cloud bubble for user messages (original SVG).
 * Multi-lobed cloud outline, hand-ink stroke, accent arcs, trailing dots.
 */

/** Stretchable cloud body (lobes) — viewBox 0 0 240 150; room for dots below. */
const CLOUD_PATH =
  "M72 38" +
  "C58 30 48 34 44 48" +
  "C28 50 22 66 30 80" +
  "C18 90 24 110 42 112" +
  "C46 128 68 136 92 130" +
  "C108 142 140 144 168 134" +
  "C190 142 214 132 218 110" +
  "C236 104 238 80 224 68" +
  "C232 50 218 34 196 36" +
  "C188 20 160 14 136 22" +
  "C118 12 88 18 72 38Z";

interface Props {
  children: ReactNode;
  className?: string;
  /** Outer accent arcs (default true). */
  accent?: boolean;
}

export function AnimeLineBubble({
  children,
  className,
  accent = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const fillId = `fn-thought-fill-${uid}`;
  const classes = [
    "ds-bubble",
    "ds-bubble-user",
    "ds-bubble-user--thought-cloud",
    "ds-bubble-user--anime-line",
  ];
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <svg
        className="ds-anime-line-chrome ds-thought-cloud-chrome"
        viewBox="0 0 260 180"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={fillId} x1="12%" y1="8%" x2="88%" y2="92%">
            <stop offset="0%" stopColor="var(--ds-thought-hilite)" />
            <stop offset="55%" stopColor="var(--ds-user-bubble)" />
            <stop offset="100%" stopColor="var(--ds-thought-shade)" />
          </linearGradient>
        </defs>

        {/* Soft under-stroke for calligraphic weight variation */}
        <path
          className="ds-thought-cloud-ink-soft"
          d={CLOUD_PATH}
          fill="none"
          stroke="var(--ds-thought-border)"
          strokeWidth="3.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.22"
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="ds-thought-cloud-fill"
          d={CLOUD_PATH}
          fill={`url(#${fillId})`}
        />
        <path
          className="ds-thought-cloud-stroke"
          d={CLOUD_PATH}
          fill="none"
          stroke="var(--ds-thought-border)"
          strokeWidth="2.1"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        {accent ? (
          <g
            className="ds-thought-cloud-arcs"
            fill="none"
            stroke="var(--ds-thought-border)"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          >
            {/* Top-right accent arc */}
            <path
              d="M198 22 C212 18 228 28 230 42"
              strokeWidth="1.35"
              opacity="0.85"
            />
            {/* Bottom-left accent arc */}
            <path
              d="M28 98 C18 108 20 126 34 132"
              strokeWidth="1.25"
              opacity="0.75"
            />
          </g>
        ) : null}

        {/* Thought-tail: three decreasing circles, bottom-right */}
        <g className="ds-thought-cloud-dots" fill="var(--ds-user-bubble)">
          <circle
            cx="204"
            cy="138"
            r="9"
            stroke="var(--ds-thought-border)"
            strokeWidth="1.9"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx="224"
            cy="154"
            r="6"
            stroke="var(--ds-thought-border)"
            strokeWidth="1.7"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx="240"
            cy="166"
            r="3.6"
            stroke="var(--ds-thought-border)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>

      <div className="ds-anime-line-content">{children}</div>
    </div>
  );
}
