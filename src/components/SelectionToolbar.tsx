interface Props {
  top: number;
  left: number;
  onAsk: () => void;
  fixed?: boolean;
  zIndex?: number;
}

export function SelectionToolbar({
  top,
  left,
  onAsk,
  fixed = false,
  zIndex,
}: Props) {
  return (
    <div
      className={`selection-toolbar${fixed ? " is-fixed" : ""}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        ...(zIndex !== undefined ? { zIndex } : {}),
      }}
    >
      <button type="button" className="btn primary sm" onClick={onAsk}>
        针对选中追问
      </button>
    </div>
  );
}
