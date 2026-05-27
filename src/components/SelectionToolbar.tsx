interface Props {
  top: number;
  left: number;
  onAsk: () => void;
}

export function SelectionToolbar({ top, left, onAsk }: Props) {
  return (
    <div
      className="selection-toolbar"
      style={{ top: `${top}px`, left: `${left}px` }}
    >
      <button type="button" className="btn primary sm" onClick={onAsk}>
        针对选中追问
      </button>
    </div>
  );
}
