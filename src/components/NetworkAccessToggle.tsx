import { useEffect, useState } from "react";
import { useLocale } from "../lib/i18n";
import {
  isBrowserOnline,
  resolveAgentAllowNetwork,
} from "../lib/networkAccess";
import { normalizeApiSettings, saveSettings } from "../lib/settings";
import { useAppStore } from "../store/useAppStore";

interface Props {
  disabled?: boolean;
}

/** Composer control: toggle agent web tools (left of model selector). */
export function NetworkAccessToggle({ disabled = false }: Props) {
  const { t } = useLocale();
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const wanted = resolveAgentAllowNetwork(settings);
  const [online, setOnline] = useState(isBrowserOnline);

  useEffect(() => {
    const sync = () => setOnline(isBrowserOnline());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const onToggle = () => {
    if (disabled) return;
    const next = normalizeApiSettings({
      ...settings,
      agentAllowNetwork: !wanted,
    });
    saveSettings(next);
    setSettings(next);
  };

  const stateClass = !wanted
    ? ""
    : online
      ? " is-on"
      : " is-on is-offline";

  const title = !wanted
    ? t("network.toggleTitleOff")
    : online
      ? t("network.toggleTitleOn")
      : t("network.toggleTitleOffline");

  return (
    <button
      type="button"
      className={`fn-network-toggle${stateClass}`}
      disabled={disabled}
      onClick={onToggle}
      title={title}
      aria-pressed={wanted}
      aria-label={t("network.toggleAria")}
    >
      <svg
        className="fn-network-toggle-icon"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9S9.5 5.8 12 3z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="fn-network-toggle-label">
        {!wanted
          ? t("network.toggleOff")
          : online
            ? t("network.toggleOn")
            : t("network.toggleOffline")}
      </span>
    </button>
  );
}
