import { useCallback, useEffect, useState } from "react";
import { ArchivePanel } from "./components/ArchivePanel";
import { BranchFloatLayer } from "./components/BranchFloatLayer";
import { MainPanel } from "./components/MainPanel";
import { ProjectPanel } from "./components/ProjectPanel";
import { SessionSidebar } from "./components/SessionSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { ShareViewer } from "./components/ShareViewer";
import { useLocale } from "./lib/i18n";
import {
  isSidebarNarrowViewport,
  SIDEBAR_NARROW_MQ,
} from "./lib/layout";
import { parseShareHash } from "./lib/sessionShare";
import { useTextZoomShortcuts } from "./lib/useTextZoomShortcuts";
import { useAppStore } from "./store/useAppStore";

function readShareToken(): string | null {
  if (typeof window === "undefined") return null;
  return parseShareHash(window.location.hash);
}

export default function App() {
  const { t } = useLocale();
  useTextZoomShortcuts();
  const init = useAppStore((s) => s.init);
  const settings = useAppStore((s) => s.settings);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSettings = useAppStore((s) => s.setSettings);
  const projectOpen = useAppStore((s) => s.projectOpen);
  const setProjectOpen = useAppStore((s) => s.setProjectOpen);

  const [narrowViewport, setNarrowViewport] = useState(
    isSidebarNarrowViewport,
  );
  /** Desktop-only icon rail; ignored while the narrow drawer mode is active. */
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  /** Narrow-only session list drawer (DeepSeek-style overlay). */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(readShareToken);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    const mq = window.matchMedia(SIDEBAR_NARROW_MQ);
    const sync = () => {
      setNarrowViewport(mq.matches);
      // Close the drawer whenever the breakpoint flips; never leave overlay open on desktop.
      setMobileNavOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!narrowViewport || !mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrowViewport, mobileNavOpen]);

  useEffect(() => {
    const onHash = () => setShareToken(readShareToken());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const exitShare = useCallback(() => {
    const { pathname, search } = window.location;
    window.history.replaceState(null, "", `${pathname}${search}`);
    setShareToken(null);
  }, []);

  const openMobileNav = useCallback(() => setMobileNavOpen(true), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  const onToggleCollapse = useCallback(() => {
    if (narrowViewport) {
      setMobileNavOpen((open) => !open);
      return;
    }
    setDesktopCollapsed((v) => !v);
  }, [narrowViewport]);

  if (shareToken) {
    return <ShareViewer token={shareToken} onExit={exitShare} />;
  }

  const sidebarCollapsed = narrowViewport ? false : desktopCollapsed;

  return (
    <div
      className={`app ds-app${narrowViewport ? " is-narrow-sidebar" : ""}${
        narrowViewport && mobileNavOpen ? " is-mobile-nav-open" : ""
      }`}
    >
      {narrowViewport && mobileNavOpen ? (
        <button
          type="button"
          className="fn-sidebar-backdrop"
          aria-label={t("sidebar.closeList")}
          onClick={closeMobileNav}
        />
      ) : null}

      <SessionSidebar
        collapsed={sidebarCollapsed}
        narrowViewport={narrowViewport}
        mobileNavOpen={mobileNavOpen}
        onToggleCollapse={onToggleCollapse}
        onCloseMobileNav={closeMobileNav}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <MainPanel
        onOpenProject={() => setProjectOpen(true)}
        showSidebarMenu={narrowViewport}
        onOpenSidebar={openMobileNav}
      />
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
      <ArchivePanel />
    </div>
  );
}
