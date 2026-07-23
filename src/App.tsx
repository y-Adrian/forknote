import { useEffect, useState } from "react";
import { BranchFloatLayer } from "./components/BranchFloatLayer";
import { MainPanel } from "./components/MainPanel";
import { ProjectPanel } from "./components/ProjectPanel";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const init = useAppStore((s) => s.init);
  const settings = useAppStore((s) => s.settings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSettings = useAppStore((s) => s.setSettings);
  const projectOpen = useAppStore((s) => s.projectOpen);
  const setProjectOpen = useAppStore((s) => s.setProjectOpen);

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
        onOpenProject={() => setProjectOpen(true)}
      />
      <MainPanel onOpenProject={() => setProjectOpen(true)} />
      <BranchFloatLayer />

      <SettingsPanel
        settings={settings}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={setSettings}
      />
      <ProjectPanel
        open={projectOpen}
        onClose={() => setProjectOpen(false)}
      />
    </div>
  );
}
