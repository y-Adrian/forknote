import { useEffect } from "react";
import { MainPanel } from "./components/MainPanel";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const settings = useAppStore((s) => s.settings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSettings = useAppStore((s) => s.setSettings);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">Branch Chat</div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setSettingsOpen(true)}
        >
          设置
        </button>
      </header>

      <div className="app-workspace">
        <SessionSidebar />
        <MainPanel />
      </div>

      <SettingsPanel
        settings={settings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={setSettings}
      />
    </div>
  );
}
