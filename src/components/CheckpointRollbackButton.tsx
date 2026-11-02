import { useState } from "react";
import { useLocale } from "../lib/i18n";
import { restoreCheckpoint } from "../lib/sidecar";
import { useAppStore } from "../store/useAppStore";
import type { NodeId } from "../types";

type State =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "done"; count: number }
  | { kind: "error"; message: string };

/**
 * "Revert file changes" for an Agent reply that edited files. Two clicks
 * (arm, then confirm) restore the reply's sidecar checkpoint.
 */
export function CheckpointRollbackButton({
  messageId,
  checkpointId,
}: {
  messageId: NodeId;
  checkpointId: string;
}) {
  const { t } = useLocale();
  const projectRoot = useAppStore((s) => s.projectRoot);
  const sidecarUrl = useAppStore((s) => s.sidecarUrl);
  const clearMessageCheckpoint = useAppStore((s) => s.clearMessageCheckpoint);
  const [state, setState] = useState<State>({ kind: "idle" });

  if (!projectRoot && state.kind !== "done") return null;

  const run = async () => {
    if (state.kind === "idle" || state.kind === "error") {
      setState({ kind: "confirm" });
      window.setTimeout(
        () => setState((s) => (s.kind === "confirm" ? { kind: "idle" } : s)),
        4000,
      );
      return;
    }
    if (state.kind !== "confirm" || !projectRoot) return;
    setState({ kind: "running" });
    try {
      const result = await restoreCheckpoint(checkpointId, sidecarUrl, projectRoot);
      setState({ kind: "done", count: result.restored.length + result.removed.length });
      // Keep the confirmation visible briefly; clearing unmounts the button.
      window.setTimeout(() => clearMessageCheckpoint(messageId), 2500);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/Checkpoint not found/i.test(message)) {
        setState({ kind: "error", message: t("checkpoint.gone") });
        window.setTimeout(() => clearMessageCheckpoint(messageId), 2500);
      } else {
        setState({ kind: "error", message: t("checkpoint.failed", { error: message }) });
      }
    }
  };

  const label =
    state.kind === "confirm"
      ? t("checkpoint.confirm")
      : state.kind === "running"
        ? t("checkpoint.running")
        : state.kind === "done"
          ? t("checkpoint.done", { count: state.count })
          : state.kind === "error"
            ? state.message
            : t("checkpoint.rollback");

  return (
    <button
      type="button"
      className={`btn ghost sm fn-checkpoint-rollback${state.kind === "confirm" ? " is-armed" : ""}${state.kind === "error" ? " is-error" : ""}`}
      disabled={state.kind === "running" || state.kind === "done"}
      title={t("checkpoint.rollbackTitle")}
      onClick={() => void run()}
    >
      {label}
    </button>
  );
}
