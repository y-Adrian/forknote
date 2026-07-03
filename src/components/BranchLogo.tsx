import type { CSSProperties } from "react";

interface Props {
  /** 侧栏收起：仅显示图标 */
  collapsed?: boolean;
  /** 仅图标（与侧栏收起一致，用于空状态等） */
  iconOnly?: boolean;
  /** 图标高度（px），默认随侧栏变量 */
  iconHeight?: number;
  className?: string;
}

const BRAND = "#7B42BC";
const ICON_VB_W = 118;
const ICON_VB_H = 198;

export function BranchLogo({
  collapsed = false,
  iconOnly = false,
  iconHeight,
  className = "",
}: Props) {
  const hideWordmark = collapsed || iconOnly;

  const svgStyle: CSSProperties | undefined = iconHeight
    ? { height: iconHeight, width: "auto" }
    : undefined;

  return (
    <div
      className={`ds-brand-logo${collapsed ? " is-collapsed" : ""}${iconOnly ? " is-icon-only" : ""}${className ? ` ${className}` : ""}`}
    >
      <svg
        className="ds-brand-icon-svg"
        style={svgStyle}
        viewBox={`0 0 ${ICON_VB_W} ${ICON_VB_H}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden={hideWordmark}
        role={hideWordmark ? "img" : undefined}
        aria-label={hideWordmark ? "Branch Chat" : undefined}
      >
        <g fill={BRAND}>
          <path
            d="M20 42h34a12 12 0 0 1 12 12v44a12 12 0 0 1-12 12H32l-8 50 18-50H20a12 12 0 0 1-12-12V54a12 12 0 0 1 12-12z"
            fill="none"
            stroke={BRAND}
            strokeWidth="9"
            strokeLinejoin="round"
          />
          <path d="M58 34c22-4 44 8 50 32 6.5 26-10 52-36 56-14 2-26-4-32-14 16-6 28-20 30-36 2.5-18-10-34-28-38z" />
          <path
            d="M68 44c12 10 16 24 12 38-3 12-12 22-24 26 2-10 6-18 14-24 6-5 10-12 11-20 1.5-9-4-16-13-20z"
            opacity="0.32"
          />
          <circle cx="33" cy="74" r="5.2" />
          <circle cx="49" cy="74" r="5.2" />
          <circle cx="65" cy="74" r="5.2" />
        </g>
      </svg>

      <span className="ds-brand-wordmark" aria-hidden={hideWordmark}>
        Branch Chat
      </span>
    </div>
  );
}
