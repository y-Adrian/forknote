const STORAGE_KEY = "forknote-project";

export type ProjectPrefs = {
  lastPath: string;
  sidecarUrl: string;
};

const defaults: ProjectPrefs = {
  lastPath: "",
  sidecarUrl: "/sidecar",
};

export function loadProjectPrefs(): ProjectPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<ProjectPrefs>;
    return {
      lastPath: String(parsed.lastPath ?? "").trim(),
      sidecarUrl: String(parsed.sidecarUrl ?? defaults.sidecarUrl).trim() ||
        defaults.sidecarUrl,
    };
  } catch {
    return { ...defaults };
  }
}

export function saveProjectPrefs(prefs: Partial<ProjectPrefs>): void {
  const current = loadProjectPrefs();
  const next: ProjectPrefs = {
    lastPath:
      prefs.lastPath !== undefined
        ? prefs.lastPath.trim()
        : current.lastPath,
    sidecarUrl:
      prefs.sidecarUrl !== undefined
        ? prefs.sidecarUrl.trim() || defaults.sidecarUrl
        : current.sidecarUrl,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
