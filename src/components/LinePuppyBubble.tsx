import { useId, type ReactNode } from "react";

/**
 * Light 「线条小狗」-inspired speech bubble for user messages.
 * Original hand-drawn SVG paths only — no sticker packs or hotlinked art.
 */
const BUBBLE_PATH =
  "M28 18" +
  "C34 10 52 7 78 8" +
  "C118 9 168 7 196 12" +
  "C214 15 224 24 226 40" +
  "C228 58 227 78 222 94" +
  "C218 108 204 116 182 118" +
  "C148 121 108 120 74 116" +
  "C52 113 36 104 30 88" +
  "C24 70 22 48 24 34" +
  "C25 26 26 22 28 18Z";

/** Soft speech tail (bottom-right), slightly imperfect like a pencil stroke. */
const TAIL_PATH =
  "M178 112" +
  "C186 118 194 126 198 134" +
  "C199 136 197 137 195 135" +
  "C188 128 180 120 172 116" +
  "C176 114 177 113 178 112Z";

interface Props {
  children: ReactNode;
  className?: string;
  /** Tiny line-puppy peek accent (default true). */
  accent?: boolean;
}

export function LinePuppyBubble({
  children,
  className,
  accent = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const fillId = `fn-line-puppy-fill-${uid}`;
  const classes = [
    "ds-bubble",
    "ds-bubble-user",
    "ds-bubble-user--line-puppy",
  ];
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <svg
        className="ds-line-puppy-chrome"
        viewBox="0 0 240 148"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={fillId}
            x1="18%"
            y1="8%"
            x2="86%"
            y2="92%"
          >
            <stop offset="0%" stopColor="var(--ds-line-puppy-hilite)" />
            <stop offset="55%" stopColor="var(--ds-user-bubble)" />
            <stop offset="100%" stopColor="var(--ds-line-puppy-shade)" />
          </linearGradient>
        </defs>
        <path
          className="ds-line-puppy-fill"
          d={BUBBLE_PATH}
          fill={`url(#${fillId})`}
        />
        <path
          className="ds-line-puppy-fill"
          d={TAIL_PATH}
          fill={`url(#${fillId})`}
        />
        <path
          className="ds-line-puppy-stroke"
          d={BUBBLE_PATH}
          fill="none"
          stroke="var(--ds-line-puppy-border)"
          strokeWidth="1.55"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          className="ds-line-puppy-stroke"
          d={TAIL_PATH}
          fill="none"
          stroke="var(--ds-line-puppy-border)"
          strokeWidth="1.45"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {accent ? (
        <span className="ds-line-puppy-accent" aria-hidden="true">
          <svg
            className="ds-line-puppy-doodle"
            viewBox="0 0 36 28"
            width="28"
            height="22"
          >
            {/* Floppy left ear */}
            <path
              d="M6 14 C3 8 4 3 8 4 C11 5 12 9 11 13"
              fill="var(--ds-line-puppy-hilite)"
              stroke="var(--ds-line-puppy-border)"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Floppy right ear */}
            <path
              d="M24 12 C27 6 30 3 33 5 C34 8 31 12 28 14"
              fill="var(--ds-line-puppy-hilite)"
              stroke="var(--ds-line-puppy-border)"
              strokeWidth="1.35"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Head peek */}
            <path
              d="M10 16 C11 10 15 7 20 7 C25 7 28 11 28 16 C28 21 24 24 20 24 C15 24 10 21 10 16Z"
              fill="var(--ds-user-bubble)"
              stroke="var(--ds-line-puppy-border)"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            {/* Eyes */}
            <circle cx="16.2" cy="15.5" r="1.05" fill="var(--ds-line-puppy-border)" />
            <circle cx="23.2" cy="15.5" r="1.05" fill="var(--ds-line-puppy-border)" />
            {/* Soft smile */}
            <path
              d="M17.5 19.2 C18.8 20.4 21.2 20.4 22.5 19.2"
              fill="none"
              stroke="var(--ds-line-puppy-border)"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {/* Tiny nose */}
            <circle cx="19.8" cy="17.4" r="0.7" fill="var(--ds-line-puppy-border)" />
          </svg>
        </span>
      ) : null}

      <div className="ds-line-puppy-content">{children}</div>
    </div>
  );
}
