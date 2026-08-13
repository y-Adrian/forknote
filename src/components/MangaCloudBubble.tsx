import { useId, type ReactNode } from "react";

/**
 * Comic-book cloud / thought-bubble chrome for user messages.
 * SVG stretch + non-scaling stroke keeps a thick ink outline at any size.
 */
const CLOUD_PATH =
  "M150.0 33.0C175.9 13.4 183.2 14.1 198.6 38.1C229.3 27.5 235.1 29.7 237.6 52.6C264.1 53.6 267.4 56.8 259.2 73.4C283.2 83.3 283.2 86.7 259.2 96.6C270.0 114.5 266.8 117.7 237.6 117.4C233.1 137.8 227.3 139.9 198.6 131.9C183.3 156.4 176.0 157.2 150.0 137.0C124.5 154.8 117.2 154.0 101.4 131.9C72.6 140.1 66.7 137.9 62.4 117.4C31.2 118.6 28.0 115.5 40.8 96.6C19.5 86.7 19.5 83.3 40.8 73.4C32.0 56.5 35.2 53.3 62.4 52.6C63.7 28.2 69.5 26.1 101.4 38.1C117.4 16.8 124.7 16.1 150.0 33.0Z";

const PUFF_PATH =
  "M20.0 7.5C24.1 5.6 25.1 5.9 26.7 9.4C30.7 10.3 31.1 11.0 29.5 14.0C30.7 16.9 30.3 17.6 26.7 18.6C25.1 22.2 24.1 22.4 20.0 20.5C16.0 22.3 15.0 22.0 13.3 18.6C9.7 17.6 9.2 16.9 10.5 14.0C8.7 10.9 9.1 10.2 13.3 9.4C15.0 6.1 16.0 5.8 20.0 7.5Z";

interface Props {
  children: ReactNode;
  className?: string;
  /** Show small accent puffs (default true). */
  puffs?: boolean;
}

export function MangaCloudBubble({
  children,
  className,
  puffs = true,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const shadeId = `fn-cloud-shade-${uid}`;
  const classes = ["ds-bubble", "ds-bubble-user", "ds-bubble-user--manga"];
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <svg
        className="ds-cloud-chrome"
        viewBox="0 0 300 170"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient
            id={shadeId}
            x1="18%"
            y1="12%"
            x2="88%"
            y2="92%"
          >
            <stop offset="0%" stopColor="var(--ds-cloud-hilite)" />
            <stop offset="48%" stopColor="var(--ds-user-bubble)" />
            <stop offset="100%" stopColor="var(--ds-cloud-shade)" />
          </linearGradient>
        </defs>
        <path
          className="ds-cloud-fill"
          d={CLOUD_PATH}
          fill={`url(#${shadeId})`}
        />
        <path
          className="ds-cloud-stroke"
          d={CLOUD_PATH}
          fill="none"
          stroke="var(--ds-manga-bubble-border)"
          strokeWidth="5.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {puffs ? (
        <span className="ds-cloud-puffs" aria-hidden="true">
          <svg
            className="ds-cloud-puff ds-cloud-puff--tr"
            viewBox="0 0 40 28"
            width="26"
            height="18"
          >
            <path
              d="M7 19 L11 13 M10 20 L15 15"
              fill="none"
              stroke="var(--ds-manga-bubble-border)"
              strokeWidth="1.55"
              strokeLinecap="round"
            />
            <path
              d={PUFF_PATH}
              fill="var(--ds-cloud-hilite)"
              stroke="var(--ds-manga-bubble-border)"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
          </svg>
          <svg
            className="ds-cloud-puff ds-cloud-puff--bl"
            viewBox="0 0 40 28"
            width="22"
            height="16"
          >
            <path
              d="M31 8 L27 14 M29 7 L23 12"
              fill="none"
              stroke="var(--ds-manga-bubble-border)"
              strokeWidth="1.55"
              strokeLinecap="round"
            />
            <path
              d={PUFF_PATH}
              fill="var(--ds-cloud-hilite)"
              stroke="var(--ds-manga-bubble-border)"
              strokeWidth="2.1"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      ) : null}

      <div className="ds-cloud-content">{children}</div>
    </div>
  );
}
