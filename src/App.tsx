import { useEffect, useState } from "react";
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="app ds-app">
      <SessionSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <MainPanel />

      <SettingsPanel
        settings={settings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={setSettings}
      />
    </div>
  );
}
