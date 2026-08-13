/** Subtle in-progress spinner for agent/tool status rows. */
export function TurnBusyIndicator({ label }: { label: string }) {
  return (
    <span className="fn-turn-busy" role="status" aria-live="polite" aria-label={label}>
      <span className="fn-turn-busy-spinner" aria-hidden />
    </span>
  );
}
