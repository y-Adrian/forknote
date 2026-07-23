import type { CSSProperties } from "react";

interface Props {
  collapsed?: boolean;
  iconOnly?: boolean;
  iconHeight?: number;
  className?: string;
  /** 空状态等场景显示完整品牌字 */
  showWordmark?: boolean;
}

/** ForkNote mark: Clarify Cards — main note + floating clarify card */
export function ForkNoteLogo({
  collapsed = false,
  iconOnly = false,
  iconHeight,
  className = "",
  showWordmark = false,
}: Props) {
  const hideWordmark = (collapsed || iconOnly) && !showWordmark;

  const svgStyle: CSSProperties | undefined = iconHeight
    ? { height: iconHeight, width: "auto" }
    : undefined;

  return (
    <div
      className={`fn-brand-logo${collapsed ? " is-collapsed" : ""}${iconOnly ? " is-icon-only" : ""}${className ? ` ${className}` : ""}`}
    >
      <svg
        className="fn-brand-icon"
        style={svgStyle}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="ForkNote"
      >
        {/* Main note card */}
        <rect
          x="5"
          y="7"
          width="38"
          height="28"
          rx="6"
          fill="currentColor"
          fillOpacity="0.1"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <rect x="11" y="14" width="6.5" height="6.5" rx="1.4" fill="currentColor" />
        <path
          d="M21.5 15.8h15M21.5 21.2h10"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />

        {/* Link curve: main → floating clarify card */}
        <path
          d="M13 35C13 46 18 48 26 44"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Floating clarify card */}
        <rect
          x="26"
          y="33"
          width="31"
          height="22"
          rx="5.5"
          fill="currentColor"
          fillOpacity="0.1"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <rect x="31.5" y="39" width="5.2" height="5.2" rx="1.2" fill="currentColor" />
        <path
          d="M40 40.5h11.5M40 45.2h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {!hideWordmark && (
        <span className="fn-brand-wordmark">
          Fork<span className="fn-brand-note">Note</span>
        </span>
      )}
    </div>
  );
}

/** @deprecated use ForkNoteLogo */
export const BranchLogo = ForkNoteLogo;
