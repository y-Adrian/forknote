import { useCallback, useEffect, useState } from "react";

export type Locale = "en" | "zh";

export const LOCALE_STORAGE_KEY = "forknote-locale";

type Listener = (locale: Locale) => void;

const listeners = new Set<Listener>();

function notify(locale: Locale) {
  listeners.forEach((fn) => fn(locale));
}

export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

export function getStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (value === "en" || value === "zh") return value;
  } catch {
    // ignore
  }
  return null;
}

export function resolveInitialLocale(): Locale {
  return getStoredLocale() ?? detectBrowserLocale();
}

export function getLocale(): Locale {
  return getStoredLocale() ?? resolveInitialLocale();
}

function applyDocumentLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
}

/** Persist locale and notify subscribers. */
export function applyLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
  applyDocumentLang(locale);
  notify(locale);
}

/** One-line reply-language instruction appended to system prompts. */
export function replyLanguageAddendum(locale: Locale = getLocale()): string {
  if (locale === "zh") {
    return "\n\n【回复语言】请始终使用中文回答。";
  }
  return "\n\n[Reply language] Always reply in English. Keep 【N】 point markers and Markdown structure.";
}

export function withReplyLanguage(
  system: string,
  locale: Locale = getLocale(),
): string {
  return `${system.trimEnd()}${replyLanguageAddendum(locale)}`;
}

type Vars = Record<string, string | number>;

const en = {
  "common.send": "Send",
  "common.stop": "Stop",
  "common.cancel": "Cancel",
  "common.ok": "OK",
  "common.save": "Save",
  "common.saved": "Saved",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.settings": "Settings",
  "common.disconnect": "Disconnect",
  "common.enabled": "Enabled",
  "common.optional": "Optional",
  "common.submit": "Submit",
  "common.expand": "Expand",
  "common.collapse": "Collapse",
  "common.expandAll": "Expand all",
  "common.collapseAll": "Collapse all",
  "common.dragToMove": "Drag to move",
  "common.resizePanel": "Drag to resize",

  "settings.title": "System settings",
  "settings.closeAria": "Close settings",
  "settings.navAria": "Settings categories",
  "settings.nav.general": "General",
  "settings.nav.api": "Default API",
  "settings.nav.memory": "Memory",
  "settings.nav.data": "Data",
  "settings.nav.project": "Project",
  "settings.nav.about": "About",

  "general.title": "General",
  "general.lead":
    "Appearance and local preferences. No account is required — everything stays on this device.",
  "general.theme": "Theme",
  "general.themeDesc": "Match the OS, or lock light / dark.",
  "general.themeAria": "Theme",
  "general.theme.light": "Light",
  "general.theme.dark": "Dark",
  "general.theme.system": "System",
  "general.font": "Interface font",
  "general.fontDesc":
    "Pick any font installed on this device. Code blocks still use JetBrains Mono.",
  "general.fontAria": "Interface font",
  "general.font.default": "Default (IBM Plex Sans)",
  "general.font.system": "System UI",
  "general.font.load": "Load installed fonts",
  "general.font.loading": "Loading fonts…",
  "general.font.filter": "Filter fonts",
  "general.font.preview": "ForkNote · Clarify as you read · 实时澄清",
  "general.font.sourceLocal": "Showing fonts installed on this device.",
  "general.font.sourceFallback":
    "This browser cannot list all installed fonts — showing a common-font list. Chrome / Edge / the desktop app can load the full set.",
  "general.font.loadError": "Could not read installed fonts: {error}",
  "general.font.installedGroup": "Installed fonts",
  "general.font.commonGroup": "Common fonts",
  "general.language": "Interface language",
  "general.languageDesc":
    "UI chrome and model replies follow this language. Switching reloads the app so everything updates.",
  "general.languageAria": "Interface language",
  "general.lang.en": "English",
  "general.lang.zh": "中文",
  "general.langConfirmTitle": "Switch language?",
  "general.langConfirmBody":
    "The app will reload to apply {lang} everywhere.",
  "general.langConfirmAria": "Confirm language switch",
  "general.clarify": "Clarify as you read",
  "general.clarifyDesc":
    "Select text in answers to open a clarify prompt. Always on — no extra account.",
  "general.plantuml.title": "PlantUML rendering",
  "general.plantuml.lead":
    "Mermaid fences still preview live by default (no sidecar). Enable PlantUML only when you want ```plantuml / @startuml blocks rendered too.",
  "general.plantuml.mode": "PlantUML mode",
  "general.plantuml.mode.off": "Off (source only)",
  "general.plantuml.mode.server": "Server (Kroki / PlantUML)",
  "general.plantuml.mode.local": "Local client",
  "general.plantuml.mode.offHint":
    "PlantUML fences stay as copyable source. Prefer Mermaid for live diagrams.",
  "general.plantuml.mode.serverHint":
    "Prefers the sidecar proxy; if sidecar is down, public Kroki / plantuml.com can render directly in the browser. Self-hosted URLs usually still need the sidecar.",
  "general.plantuml.mode.localHint":
    "Requires the sidecar (npm run sidecar / npm run dev). Prefer the Homebrew plantuml binary (/opt/homebrew/bin/plantuml); jar mode needs Java. Graphviz (brew install graphviz) is required for some diagram types. If local fails, ForkNote soft-retries the server URL.",
  "general.plantuml.serverUrl": "Server base URL",
  "general.plantuml.serverUrlHint":
    "Kroki: https://kroki.io (or your host). Official: https://www.plantuml.com/plantuml",
  "general.plantuml.localPath": "Local PlantUML path",
  "general.plantuml.localPathHint":
    "Absolute path to the plantuml binary (preferred) or plantuml.jar. Homebrew Cellar jars are auto-mapped to the plantuml wrapper when present.",
  "general.plantuml.javaPath": "Java path (for .jar)",
  "general.plantuml.javaPathHint":
    "Used only when the local path ends with .jar (and no Homebrew wrapper is found). Default: java",
  "general.plantuml.save": "Save PlantUML settings",
  "general.noAccount": "No account",
  "general.noAccountBody":
    "ForkNote does not sign you in. Notes, API settings, and project prefs are stored in this browser's localStorage.",

  "api.title": "Default API",
  "api.lead":
    "System-wide default connection used by new sessions and any session that has not set its own API.",
  "api.sessionRemarkTitle": "Per-session override",
  "api.sessionRemark":
    "You can change the API for a specific note from the composer — open Session API settings next to the input to override Base URL, key, model, or proxy for that note only.",
  "api.group.cloud": "Cloud / aggregators",
  "api.group.china": "China providers",
  "api.group.local": "Local",
  "api.baseUrl": "Base URL",
  "api.apiKey": "API Key (usually blank for local)",
  "api.model": "Default model",
  "api.modelPlaceholder": "Must match a locally loaded model name",
  "api.modelHint":
    "Used by new sessions and any session that has not set its own API settings. Override per session from the composer.",
  "api.useProxy":
    "Use local proxy in development (recommended for local models)",
  "api.hint":
    "Start the local server first. For Ollama, run ollama list; Model must match a listed name (e.g. qwen2.5:7b).",
  "api.missingBaseUrl": "Set Base URL in settings (or pick a preset).",
  "api.invalidBaseUrl":
    "Base URL must be a full http(s) URL (e.g. https://api.deepseek.com). Pick a preset or include https://, then Save.",
  "api.missingModel":
    "Set a model in Session API settings or a default in Settings → Default API.",
  "api.missingKey":
    "Add an API Key in settings for your configured endpoint, or switch to a local model such as Ollama.",
  "api.memoryPack.title": "Context memory pack",
  "api.memoryPack.lead":
    "Compress context → SUMMARY.md + TASKS.md + DECISIONS.md → inject on next ask. Prefer writing into the bound project; otherwise keep a draft on the session. Separate from Archive (dev-log snapshot for reading/continuing).",
  "api.memoryPack.inject": "Inject project memory pack into main chat",
  "api.memoryPack.layersHint":
    "Preferences / session layers and the editable Memory UI live under Settings → Memory.",
  "api.memoryPack.afterArchive": "Also compress after Archive",
  "api.memoryPack.afterArchiveHint":
    "Off by default. When on, Archive success then Compress once using the archive draft (not a second full-thread pass). Or click Compress alone anytime.",
  "api.memoryPack.dir": "Memory folder (relative to project)",
  "api.memoryPack.dirPlaceholder": ".forknote/memory",
  "api.memoryPack.windowTurns": "Live sliding window (turns)",
  "api.memoryPack.windowTurnsHint":
    "Keep this many recent user↔assistant turns verbatim; older turns become a compact local summary (default 64, max 256).",
  "api.memoryPack.autoSummary": "Auto-summarize older live turns",
  "api.memoryPack.autoSummaryHint":
    "When off, live mode re-sends the full thread (costly on long chats).",

  "memory.title": "Memory",
  "memory.lead": "Three local layers — preferences, project pack, and per-note session — inject separately. Edit entries here; nothing leaves this device.",
  "memory.layersTitle": "Inject layers",
  "memory.layersLead": "Toggle which layers are appended on the next main ask.",
  "memory.layer.preferences": "User preferences",
  "memory.layer.project": "Project pack (SUMMARY / TASKS / DECISIONS)",
  "memory.layer.session": "Session summary (this note)",
  "memory.saveLayers": "Save layer toggles",
  "memory.prefsTitle": "Preferences",
  "memory.prefsLead": "Cross-note habits and standing instructions (localStorage).",
  "memory.prefsEmpty": "No preferences yet.",
  "memory.prefsPlaceholder": "e.g. Prefer concise answers; use TypeScript",
  "memory.prefsAdd": "Add preference",
  "memory.edit": "Edit",
  "memory.projectTitle": "Project memory pack",
  "memory.projectLeadBound": "Editing files under {dir}/ on the bound project (also mirrored on this note).",
  "memory.projectLeadLocal": "No project bound — editing the draft pack stored on this note.",
  "memory.projectLeadIsolated":
    "This session keeps memory private — files live under {dir}/ (not the shared pack).",
  "memory.shareToggle": "Share memory with other sessions",
  "memory.shareToggleHint":
    "When off, this note uses its own memory folder under the project and does not read or write the shared pack.",
  "memory.projectSave": "Save pack",
  "memory.saveFailed": "Could not save memory pack.",
  "memory.sessionTitle": "Session memory",
  "memory.sessionLead": "Working notes for the active note only. Compress also refreshes this from SUMMARY when possible.",
  "memory.sessionNone": "Open a note to edit session memory.",
  "memory.sessionPlaceholder": "Short summary of goals / status for this note…",
  "memory.sessionClear": "Clear",
  "memory.transferTitle": "Import / export",
  "memory.transferLead":
    "Download a portable forknote-memory-v1 JSON (SUMMARY / TASKS / DECISIONS + optional preferences & session). Other agents can reuse the markdown fields or the three .md files under .forknote/memory/. Import accepts that JSON, loose {summary,tasks,decisions} JSON, or ===SUMMARY.md=== delimited markdown.",
  "memory.transfer.export": "Export memory",
  "memory.transfer.import": "Import memory",
  "memory.transfer.exported": "Memory exported.",
  "memory.transfer.imported": "Memory imported.",
  "memory.transfer.exportFailed": "Could not export memory.",
  "memory.transfer.importFailed": "Could not import memory.",
  "memory.transfer.needNote": "Open a note before importing the project pack or session memory.",
  "memory.transfer.importedPrefsOnly": "Preferences imported.",
  "memory.transfer.confirmOverwrite":
    "Replace the existing project memory pack (SUMMARY / TASKS / DECISIONS)?",
  "memory.transfer.importCancelled": "Import cancelled — existing memory pack kept.",

  "data.title": "Data",
  "data.lead":
    "Sessions and archives live in localStorage on this browser. Export a backup before clearing. Session API keys are omitted from the JSON export.",
  "data.notesTitle": "Sessions on this device",
  "data.notesCount":
    "{count} session(s) in localStorage.",
  "data.export": "Export sessions (JSON)",
  "data.import": "Import sessions (JSON)",
  "data.clear": "Clear all sessions",
  "data.clearConfirm":
    "Clear all sessions and archives on this device? This cannot be undone.",
  "data.exported": "Exported sessions to a JSON file (API keys omitted).",
  "data.exportFailed": "Export failed.",
  "data.imported": "Imported {count} session(s).",
  "data.importFailed": "Import failed.",
  "data.cleared": "All sessions cleared.",
  "data.alsoStored": "Also stored locally",
  "data.key.settings": "API settings",
  "data.key.userPreferences": "user preference memory",
  "data.key.recentFiles": "recent @file paths per project",
  "data.key.project": "project / sidecar prefs",
  "data.key.theme": "theme preference",
  "data.key.locale": "interface language",
  "data.key.uiFont": "interface font preference",

  "projectSettings.title": "Project",
  "projectSettings.lead":
    "Local project tools talk to a sidecar on this machine. Run npm run sidecar, then open a project folder.",
  "projectSettings.sessionHint":
    "Each chat session binds its own project. Switching sessions restores that session's project (or none).",
  "projectSettings.sidecarUrl": "Sidecar URL",
  "projectSettings.connected": "Connected:",
  "projectSettings.none": "No project connected.",
  "projectSettings.open": "Open project…",
  "projectPanel.title": "Local project",
  "projectPanel.lead":
    "Choose a folder on this machine so chat can read and write files there. If the local helper is not running, start it with npm run sidecar (or npm run dev).",
  "projectPanel.path": "Project folder",
  "projectPanel.pathPlaceholder": "/Users/you/my-app",
  "projectPanel.browse": "Browse…",
  "projectPanel.browsing": "Browsing…",
  "projectPanel.browseFailed": "Could not open folder picker",
  "projectPanel.advanced": "Advanced",
  "projectPanel.sidecarUrl": "Sidecar proxy URL",
  "projectPanel.sidecarUrlHint":
    "Frontend proxy path to the local Node helper (default /sidecar → 127.0.0.1:8787). This is not a project folder path.",
  "projectPanel.connected": "Connected:",
  "projectPanel.disconnect": "Disconnect",
  "projectPanel.connect": "Connect",
  "projectPanel.connecting": "Connecting…",
  "projectSettings.agentMaxRounds": "Agent tool rounds (per message)",
  "projectSettings.agentMaxRoundsHint":
    "Hard cap on model↔tool loops per send (1–128, default 50), including Network-only web_search/web_fetch turns. Network-only tasks also use a soft complexity budget (simple ≈8, multi ≈16) that never exceeds this value — raise this if you still hit the tool-round limit. Ends early when the task is done.",
  "projectSettings.agentRequireApproval": "Require plan approval before tools",
  "projectSettings.agentRequireApprovalHint":
    "When a project is connected, the agent drafts a plan first. Tools run only after you approve.",
  "projectSettings.agentAllowTerminal": "Allow terminal tool (run_terminal)",
  "projectSettings.agentAllowTerminalHint":
    "Lets the agent run shell commands in the bound project via the sidecar. Default on. Commands start at the project root (not the sidecar process directory). Read-only in-project commands (ls/pwd/…) skip plan approval; mutating or outside-project commands require approval (权限).",
  "projectSettings.agentAutoDiagnostics": "Auto typecheck after code edits",
  "projectSettings.agentAutoDiagnosticsHint":
    "After successful TypeScript/JavaScript edits, automatically run run_diagnostics and feed errors back into the agent loop. Default on.",
  "projectSettings.agentPlanModel": "Plan-phase model (optional)",
  "projectSettings.agentPlanModelHint":
    "Used when drafting the approval plan. Leave blank to use the session API model.",
  "projectSettings.agentCodeModel": "Code/tool-phase model (optional)",
  "projectSettings.agentCodeModelHint":
    "Used for tool rounds after approval. Leave blank to use the session API model.",
  "projectSettings.agentSummaryModel": "Summary/Q&A model (optional)",
  "projectSettings.agentSummaryModelHint":
    "Used for Archive, Compress, and light Q&A when no project tools are needed. Leave blank to use the session API model.",
  "projectSettings.agentModelPlaceholder": "Same as session model",

  "agentPlan.aria": "Agent plan review",
  "agentPlan.kicker": "Agent plan",
  "agentPlan.lead": "Review the plan below. Approve to run tools on your project, or cancel to dismiss the approval bar (your messages stay).",
  "agentPlan.chunkNote": "This round: {shown} of {total} steps. Approve to run these; remaining work is planned after they finish.",
  "agentPlan.approve": "Approve & run",
  "agentPlan.cancel": "Dismiss",
  "agentPlan.running": "Running…",

  "agentTool.aria": "Tool approval",
  "agentTool.allow": "Allow",
  "agentTool.stop": "Stop",
  "agentTool.running": "Running…",
  "agentTool.actionPending":
    "Action will be chosen when the agent runs this step.",

  "agentTerminal.aria": "Terminal command approval",
  "agentTerminal.kicker": "Terminal",
  "agentTerminal.lead": "Run this command in your bound project?",
  "agentTerminal.cwd": "cwd",
  "agentTerminal.note":
    "Runs via the local sidecar under the project root. A shell can still reach paths outside the project.",
  "agentTerminal.outsideWarn":
    "This command targets paths outside the bound project. Approving grants elevated terminal permission for this run only.",
  "agentTerminal.outsideLead":
    "This command leaves the project directory. Approve to allow outside-project access?",
  "agentTerminal.run": "Run",
  "agentTerminal.skip": "Skip",
  "agentTerminal.allow": "Allow",
  "agentTerminal.reject": "Stop",
  "agentTerminal.stop": "Stop",
  "agentTerminal.running": "Running…",
  "agentTerminal.commandPending":
    "Command will be chosen when the agent runs this step.",

  "about.title": "About",
  "about.tag":
    "Clarify as you read — turn AI answers into research notes that fit reality.",
  "about.lead":
    "Local-first · no account · OpenAI-compatible models · optional local project sidecar.",
  "about.terms": "Terms of use",
  "about.privacy": "Privacy",
  "about.version": "Version 0.1.0",
  "about.back": "← About",
  "about.termsBody1":
    "ForkNote is a local-first research note app. You are responsible for API keys, model usage, and content you create or send to providers.",
  "about.termsBody2":
    "The software is provided as-is, without warranty. Use it at your own risk.",
  "about.privacyBody1":
    "ForkNote does not operate an account service. Notes, settings, and project preferences stay in your browser localStorage unless you export them.",
  "about.privacyBody2":
    "When you chat, messages are sent to the API endpoint you configure (cloud or local). We do not receive a copy of that traffic.",

  "sidebar.notesAria": "Sessions",
  "sidebar.expand": "Expand sidebar",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.openList": "Open session list",
  "sidebar.closeList": "Close session list",
  "sidebar.lightMode": "Light mode",
  "sidebar.darkMode": "Dark mode",
  "sidebar.toLight": "Switch to light mode",
  "sidebar.toDark": "Switch to dark mode",
  "sidebar.newNote": "New session",
  "sidebar.empty": "No sessions yet — ask a question on the right.",
  "sidebar.today": "Today",
  "sidebar.previous7": "Previous 7 days",
  "sidebar.rename": "Rename",
  "sidebar.pin": "Pin to top",
  "sidebar.unpin": "Unpin",
  "sidebar.shareMemory": "Share memory with other sessions",
  "sidebar.isolateMemory": "Keep memory private to this session",
  "sidebar.shareMemoryHint":
    "On: use the shared project memory pack. Off: keep a private pack for this session.",
  "sidebar.share": "Share",
  "sidebar.shareCopied": "Copied session to clipboard",
  "sidebar.shareFailed": "Could not copy to clipboard",
  "sidebar.pinned": "Pinned",
  "sidebar.delete": "Delete",
  "sidebar.deleteConfirm": "Delete this session? This cannot be undone.",
  "sidebar.deleteDontAskAgain": "Don't ask again",
  "sidebar.renameAria": "Rename session",
  "sidebar.more": "More",
  "sidebar.moreAria": "More actions",
  "sidebar.renameHint": "{title} (double-click to rename)",
  "sidebar.sessionHint": "{title} · {model} (double-click to rename)",

  "share.title": "Share conversation",
  "share.hint":
    "Select messages, then download a self-contained HTML file anyone can open in a browser — offline or via file://. No host required.",
  "share.selectedCount": "{selected} / {total} selected",
  "share.selectAll": "Select all",
  "share.clear": "Clear",
  "share.empty": "No messages to share yet.",
  "share.roleUser": "You",
  "share.roleAssistant": "Assistant",
  "share.noneSelected": "Select at least one message.",
  "share.exportHtml": "Download HTML",
  "share.exportFailed": "Could not export HTML",
  "share.htmlFooter": "Exported from ForkNote · read-only",
  "share.createLink": "Create share link",
  "share.creating": "Creating…",
  "share.linkLabel": "Share link",
  "share.copyLink": "Copy link",
  "share.copyContent": "Copy content",
  "share.copied": "Copied",
  "share.copyFailed": "Could not copy to clipboard",
  "share.encodeFailed": "Could not encode share link",
  "share.tooLarge":
    "Selection is too large for a URL (limit ~{limit} chars). Download HTML or copy content instead, or select fewer messages.",
  "share.softWarn":
    "This link is large — some browsers or messengers may truncate it.",
  "share.linkNote":
    "Optional: hash URL embeds the selection (gzip + base64). Recipient must reach this same ForkNote host (not for cross-network sharing). Soft warn ~200K; hard limit ~1.5M. Prefer Download HTML for offline share.",
  "share.viewerKicker": "Shared note",
  "share.viewerLoading": "Loading shared note…",
  "share.viewerInvalid": "This share link is invalid or incomplete.",
  "share.openApp": "Open ForkNote",
  "share.untitled": "Untitled",

  "main.tagline": "Clarify as you read",
  "main.howTo": "How to use",
  "main.step1": "Ask a development or research question",
  "main.step2": "Select unfamiliar text and clarify instantly",
  "main.step3": "Verdict each point — what works, what needs trust, what doesn't fit",
  "main.untitled": "Untitled",
  "main.notesKicker": "",
  "main.renameTitle": "Rename this session",
  "main.forks": "{count} forks",
  "main.forksTitle": "Open the fork history map",
  "main.viewMode.reading": "Reading",
  "main.viewMode.source": "Source",
  "main.viewMode.toReadingTitle": "Switch to reading mode (rendered markdown)",
  "main.viewMode.toSourceTitle": "Switch to source mode (raw markdown)",
  "main.viewMode.aria": "Toggle reading and source mode for the main thread",
  "main.viewMode.sourceLabel": "Source",
  "main.thinking": "Thinking",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.copySource": "Copy source",
  "chat.diagram.rendering": "Rendering diagram…",
  "chat.diagram.renderFailed": "Could not render diagram — showing source. {detail}",
  "chat.diagram.viewSource": "View source",
  "chat.diagram.viewDiagram": "View diagram",
  "chat.diagram.copyImage": "Copy image",
  "chat.diagram.imageCopied": "Image copied",
  "chat.diagram.imageDownloaded": "Image downloaded",
  "chat.diagram.copyImageFailed": "Could not copy image",
  "chat.diagram.plantumlFallback":
    "PlantUML is shown as source. Enable server or local rendering in Settings → General → PlantUML, or use Mermaid fences for live diagrams.",
  "chat.image.copyMarkdown": "Copy markdown",
  "chat.image.open": "Open image",
  "chat.image.failed": "Could not load image",
  "chat.edit": "Edit",
  "chat.thinking": "Thinking…",
  "chat.thought": "Reasoning",
  "chat.thoughtSeconds": "Reasoning ({n}s)",
  "main.bannerText":
    "Follow-up chat will use the archive log as context",
  "main.viewArchive": "View archive",
  "main.gotIt": "Got it",
  "main.archiveComposerHint":
    "Sends use the archive log as the base; follow-up messages below are included",
  "main.evolutionComposerHint":
    "Screen shows the clarification history; sends still use the archive log as the base",
  "main.contextModeAria": "Prior conversation view",
  "main.switchContextAria": "Switch how prior conversation is shown",
  "main.archiveContext": "Archive",
  "main.archiveContextTitle":
    "Show the archive document; follow-up chat uses it as the base",
  "main.liveConversation": "Live",
  "main.liveConversationTitle":
    "Leave archive mode and show the original full thread",
  "main.fullThread": "Evolution",
  "main.fullThreadTitle":
    "Show the clarification history; sends still use the archive log",
  "main.archiveBaseKicker": "Archive base",
  "main.archivesCount": "{count} archives",
  "main.archiveHistory": "History",
  "main.archivesViewTitle": "Switch among past archives",
  "main.archive": "Archive",
  "main.archiving": "Archiving…",
  "main.archiveTitle":
    "Archive: turn the main thread into a dated 开发日志 (背景/目标 · 尝试过程 · 结论/结果 · 参考) for reading / continuing. Not the same as Compress memory pack.",
  "main.compress": "Compress",
  "main.compressing": "Compressing…",
  "main.compressTitle":
    "Compress: write SUMMARY.md, TASKS.md, and DECISIONS.md for next-turn restore. Separate from Archive.",
  "main.memory": "Memory",
  "main.memoryTitle": "Open Memory settings (layers, preferences, pack)",
  "main.compressDoneProject":
    "Memory written under the project memory folder and saved on this session",
  "main.compressDoneSession":
    "Memory saved on this session (bind a project to also write SUMMARY/TASKS/DECISIONS.md)",
  "main.compressSuggestText":
    "This thread is getting long — Compress into SUMMARY / TASKS / DECISIONS to keep later turns cheaper and clearer.",
  "main.compressSuggestAction": "Compress now",
  "main.compressSuggestDismiss": "Not now",
  "main.placeholderEmpty": "Ask anything — questions, ideas, or sample code…",
  "main.placeholderProject":
    "Ask about the project — e.g. list the folder, read package.json, or edit the README…",
  "main.placeholderContinue": "Continue the conversation…",
  "main.placeholderContinueProject":
    "Continue the main thread, or ask to list/read/write project files…",
  "main.placeholderArchive": "Continue from the archive log…",

  "composer.hintHero":
    "Drag-select text in answers to clarify · Enter to send",
  "composer.hintCompact": "Enter to send · Shift+Enter for a new line",
  "composer.hintHeroProject": "Type @ to attach a project file · Drag-select to clarify · Enter to send",
  "composer.hintCompactProject": "@file to include · Enter to send · Shift+Enter for a new line",
  "composer.includesAria": "Files included in the next ask",
  "composer.removeInclude": "Remove {path}",
  "composer.newQuestion": "New question",
  "composer.continue": "Continue main thread",
  "composer.stopAria": "Stop generating",
  "composer.model": "Model",
  "composer.modelPlaceholder": "model id",
  "composer.modelTitle": "Model for this note (overrides Settings default)",
  "composer.modelAria": "Model for this note",

  "network.toggleOff": "Network",
  "network.toggleOn": "Network",
  "network.toggleOffline": "Offline",
  "network.toggleAria": "Toggle network access for web tools",
  "network.toggleTitleOff":
    "Network off — agent will not search or fetch the web",
  "network.toggleTitleOn":
    "Network on — agent may use web_search / web_fetch when online",
  "network.toggleTitleOffline":
    "Network enabled but this device is offline",

  "sessionApi.button": "API",
  "sessionApi.buttonAria": "API settings for this note",
  "sessionApi.buttonTitleDefault":
    "Using system API defaults — click to customize for this note",
  "sessionApi.buttonTitleCustom":
    "This note has custom API settings — click to edit",
  "sessionApi.noModel": "Set model",
  "sessionApi.title": "Session API settings",
  "sessionApi.lead":
    "These apply to this note only. System Settings → API remain the defaults for notes without custom settings.",
  "sessionApi.inheritHint":
    "Showing inherited system values. Edit and Save to create overrides for this note.",
  "sessionApi.customHint":
    "This note has custom API settings. Reset clears overrides and inherits system defaults again.",
  "sessionApi.model": "Model",
  "sessionApi.modelHint":
    "Only fields that differ from System Settings are stored as overrides.",
  "sessionApi.reset": "Reset to defaults",

  "archive.title": "Development log archive",
  "archive.hintLoading":
    "Writing a dated 开发日志 (背景/目标 · 尝试过程 · 结论/结果 · 参考)…",
  "archive.hintIdle":
    "Use an archive to continue, or switch back to the full thread",
  "archive.hintUpToDate":
    "Already archived — no new changes since this log. You can review it below.",
  "archive.hintUpToDateShort": "up to date",
  "archive.copyPath": "Copy path",
  "archive.copyPathTitle": "Copy the archive file path",
  "archive.pathNeedProject":
    "Bind a local project to save this archive under .forknote/archives/",
  "archive.pathPending":
    "Will save under .forknote/archives/ on the next archive while a project is bound",
  "archive.past": "Past archives",
  "archive.activeContext": " · Active context",
  "archive.generatingAria": "Generating archive",
  "archive.generating": "Generating development log draft…",
  "archive.empty": "No archive content yet",
  "archive.deleteConfirm":
    "Delete this archive? Main-thread messages are unaffected.",
  "archive.fullThread": "Full thread",
  "archive.continue": "Continue with archive",

  "projectBar.open": "Open project",
  "projectBar.activityAria": "Agent activity",

  "clarify.toolbar": "Clarify this",
  "clarify.aria": "Clarify selection",
  "clarify.title": "Clarify selection",
  "clarify.placeholder": "What’s unclear here? e.g. What does this sentence mean?",
  "clarify.point": "Clarify this point",
  "clarify.pointShort": "Ask",
  "clarify.pointPlaceholder":
    "What’s unclear about this point? e.g. Why this step / what does it imply?",
  "clarify.queued":
    "Clarify queued — it will start when the current fork turn finishes.",
  "clarify.queuedCancel": "Cancel queue",
  "clarify.hint": "Same tools as main when a project is bound · Enter to send · Shift+Enter for new line · Drag title to move",
  "clarify.error.needProject": "Open a local project first (Open project), then retry this clarify request.",

  "fork.labelQuestion": "question",
  "fork.labelAnswer": "answer",
  "fork.labelFollowUp": "follow-up",
  "fork.title": "Clarify",
  "fork.nested": "Nested",
  "fork.layer": "Layer {n}",
  "fork.closeAllAria": "Close all fork panels",
  "fork.railAria": "Fork structure",
  "fork.mapTitle": "Fork history map",
  "fork.mapLead":
    "Main answers are the trunk; forks branch off to the side. Click a node to open it.",
  "fork.mapAria": "Conversation fork history map",
  "fork.mapEmpty": "No main answers to map yet.",
  "fork.mapMainStep": "Answer {n}",
  "fork.followUpPlaceholder": "Follow-up stays in this window…",
  "fork.followUpAria": "Follow-up",
  "fork.followUpHint": "Same window · Enter to send · Shift+Enter for a new line",
  "fork.continueAsk": "Continue asking…",
  "fork.hideComposer": "Hide",
  "fork.adoptIntoMain": "Adopt into main",
  "fork.adoptIntoMainAgain": "Update in main",
  "fork.adoptIntoMainHint":
    "Insert a clarification note under the quoted span in the main answer (does not overwrite the original)",
  "fork.adopted": "Adopted",
  "fork.adoptedHint": "This fork’s conclusion was adopted into the main answer",
  "fork.adoptedNote": "Clarification",
  "fork.adoptedEmpty": "No clarification text yet",
  "fork.adoptExpand": "Expand all",
  "fork.adoptCollapse": "Collapse",
  "fork.unadoptFromMain": "Undo adopt",
  "fork.unadoptFromMainHint":
    "Remove the clarification note from the main answer",
  "fork.error.context": "Could not resolve fork context",
  "fork.error.answer": "Fork answer request failed",
  "fork.error.followUp": "Fork follow-up request failed",

  "verdict.accept": "Accept",
  "verdict.doubt": "Doubt",
  "verdict.reject": "Reject",
  "verdict.doubtNote": "Optional note",
  "verdict.doubtPlaceholder": "Where does this need more evidence or clearer limits…",
  "verdict.pointAria": "Point {n} feedback",
  "verdict.hypoAria": "Confirm feedback reason",
  "verdict.hypoYes": "Yes",
  "verdict.hypoNo": "No",
  "checkpoint.truncated": "Truncated — later steps are no longer the plan",
  "checkpoint.hint":
    "Integrate accepted steps, adopted clarifies, and rejects into a checkpoint log. Follow-up chat will use that document as the base.",
  "checkpoint.action": "Integrate progress",
  "checkpoint.working": "Integrating…",
  "verdict.hypoConfirmed": "Reason confirmed",
  "verdict.hypoUnsureConfirmed": "Needs more verification",
  "verdict.unsureClarifyHint":
    "Unsure is not a reject — confirm the reason above, or clarify this point for a sharper answer.",
  "verdict.hypoStreakHint": "Similar answers were rejected a few times — a quick check helps me adjust.",

  "chat.generating": "Generating…",

  "project.error.sidecar": "Could not reach sidecar",
  "project.error.sidecarHint": "Could not reach sidecar (run npm run sidecar first)",
  "project.error.needPath": "Enter a project absolute path",

  "agent.error.execution": "Agent execution failed",
  "agent.error.needProject": "Open a local project first (Open project), then ask to create files.",
  "chat.error.answer": "Answer request failed",

  "archive.error.empty": "Archive came back empty — try again",
  "archive.error.request": "Archive request failed",
  "archive.defaultTitle": "Dev log draft",

  "compress.error.empty": "Context compress came back empty — try again",
  "compress.error.request": "Context compress request failed",

  "agent.status.listing": "Listing {path}…",
  "agent.status.reading": "Reading {path}…",
  "agent.status.searching": "Searching {query}…",
  "agent.status.creating": "Creating {path}…",
  "agent.status.tools": "Using project tools…",
  "agent.status.listRoot": "Listing project root…",
  "agent.status.terminal": "Running `{command}`…",
  "agent.toolRoundLimit":
    "(Reached the tool-round limit ({rounds}). Continue from the results so far, or send another message. To allow more loops, raise Agent tool rounds in Settings → Project.)",

  "agent.activity.listed": "Listed {path}",
  "agent.activity.reading": "Reading {path} ({size} bytes)",
  "agent.activity.wrote": "Wrote {path}",
  "agent.activity.mkdir": "mkdir {path}",
  "agent.activity.patched": "Patched {path} ×{n}",
  "agent.activity.patchedEdits": "Patched {path} ({edits} edits)",
  "agent.activity.search": "Search “{query}” → {n} hit(s)",
  "agent.activity.ranCommand": "Ran `{command}` (exit {code})",
  "agent.activity.terminalMissingCommand": "run_terminal missing command",
  "agent.activity.terminalDisabled": "run_terminal is disabled in settings",
  "agent.activity.terminalNoProject": "run_terminal requires an open project",
  "agent.activity.terminalOutsideDenied":
    "Outside-project terminal blocked — approval required",
  "agent.activity.terminalDenied":
    "Command blocked as dangerous by terminal deny-list",
  "agent.activity.unknownTool": "Unknown tool",
  "agent.activity.toolFailed": "Tool failed",
  "agent.activity.readMissingPath": "read_file missing path",
  "agent.activity.mkdirMissingPath": "mkdir missing path",
  "agent.activity.writeMissingPath": "write_file missing path",
  "agent.activity.writeMissingContent": "write_file missing content",
  "agent.activity.writeOfficeBinary": "write_file cannot create Office binaries",
  "agent.activity.replaceMissingPath": "search_replace missing path",
  "agent.activity.replaceMissingOld": "search_replace missing old_string",
  "agent.activity.replaceMissingNew": "search_replace missing new_string",
  "agent.activity.patchMissingPath": "apply_patch missing path",
  "agent.activity.patchMissingEdits": "apply_patch missing edits",
  "agent.activity.docxMissingPath": "write_docx missing path",
  "agent.activity.xlsxMissingPath": "write_xlsx missing path",
  "agent.activity.xlsxMissingRows": "write_xlsx missing rows",
  "agent.activity.searchMissingQuery": "search_files missing query",
  "agent.activity.globMissingPattern": "glob_files missing pattern",
  "agent.activity.glob": "Glob “{pattern}” → {n} file(s)",
  "agent.activity.symbolMissingName": "symbol name is required",
  "agent.activity.findSymbol": "find_symbol “{name}” → {n}",
  "agent.activity.goToDefinition": "go_to_definition “{name}” → {n} candidate(s)",
  "agent.activity.findReferences": "find_references “{name}” → {n}",
  "agent.activity.dependencyGraph": "dependency_graph → {n} edge(s)",
  "agent.activity.semanticSearch": "semantic_search “{query}” → {n}",
  "agent.activity.codingMemoryMissingNote": "coding_memory append needs note",
  "agent.activity.codingMemoryAppend": "Appended coding memory",
  "agent.activity.codingMemoryRead": "Read coding memory",
  "agent.activity.deleteMissingPath": "delete_file missing path",
  "agent.activity.deleted": "Deleted {path}",
  "agent.activity.renameMissingArgs": "rename_file missing from/to",
  "agent.activity.renamed": "Renamed {from} → {to}",
  "agent.activity.readDocxMissingPath": "read_docx missing path",
  "agent.activity.readDocx": "Reading Word {path}",
  "agent.activity.readXlsxMissingPath": "read_xlsx missing path",
  "agent.activity.readXlsx": "Reading Excel {path}",
  "agent.activity.patchXlsxMissingPath": "patch_xlsx missing path",
  "agent.activity.patchXlsxMissingCells": "patch_xlsx missing cells",
  "agent.activity.patchedXlsx": "Patched {n} cell(s) in {path}",
  "agent.activity.diagnosticsSkipped": "Diagnostics skipped (no tsconfig.json)",
  "agent.activity.diagnosticsOk": "Diagnostics clean",
  "agent.activity.diagnosticsFailed": "Diagnostics reported issues",
  "agent.activity.gitStatus": "git status (exit {code})",
  "agent.activity.gitDiff": "git diff (exit {code})",
  "agent.activity.gitCommitMissingMessage": "git_commit missing message",
  "agent.activity.gitCommitMissingPaths": "git_commit missing paths",
  "agent.activity.gitCommit": "git commit ({n} path(s), exit {code})",

  "comments.title": "Comments",
  "comments.empty": "Drag-select text in an answer, then click “Clarify this”.",
  "comments.badge": "Comment {n}",
  "comments.collapseAnswer": "Collapse answer",
  "comments.expandAnswer": "Expand answer",
  "comments.nestedOne": "1 nested reply — expand to view",
  "comments.nestedMany": "{count} nested replies — expand to view",

  "tree.outline": "Outline",
  "tree.mainConversation": "Main conversation",

  "ask.aria": "Ask about selection",
  "ask.title": "Ask about selection",
  "ask.placeholder": "Enter your question…",
  "ask.hint": "⌘/Ctrl + Enter to submit",
  "projectBar.changes": "Changes this turn",
} as const;

type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  "common.send": "发送",
  "common.stop": "停止",
  "common.cancel": "取消",
  "common.ok": "确定",
  "common.save": "保存",
  "common.saved": "已保存",
  "common.close": "关闭",
  "common.delete": "删除",
  "common.settings": "设置",
  "common.disconnect": "断开",
  "common.enabled": "已开启",
  "common.optional": "可选",
  "common.submit": "提交",
  "common.expand": "展开",
  "common.collapse": "收起",
  "common.expandAll": "全部展开",
  "common.collapseAll": "全部收起",
  "common.dragToMove": "拖动移动",
  "common.resizePanel": "拖动调整大小",

  "settings.title": "系统设置",
  "settings.closeAria": "关闭设置",
  "settings.navAria": "设置分类",
  "settings.nav.general": "通用",
  "settings.nav.api": "默认 API",
  "settings.nav.memory": "记忆",
  "settings.nav.data": "数据",
  "settings.nav.project": "项目",
  "settings.nav.about": "关于",

  "general.title": "通用",
  "general.lead":
    "外观与本地偏好。无需账号 —— 一切都保存在本机。",
  "general.theme": "主题",
  "general.themeDesc": "跟随系统，或固定浅色 / 深色。",
  "general.themeAria": "主题",
  "general.theme.light": "浅色",
  "general.theme.dark": "深色",
  "general.theme.system": "系统",
  "general.font": "界面字体",
  "general.fontDesc":
    "可读取并选择本机已安装的字体。代码区域仍使用 JetBrains Mono。",
  "general.fontAria": "界面字体",
  "general.font.default": "默认（IBM Plex Sans）",
  "general.font.system": "系统 UI",
  "general.font.load": "读取已安装字体",
  "general.font.loading": "正在读取字体…",
  "general.font.filter": "筛选字体",
  "general.font.preview": "ForkNote · 边读边澄清 · 实时澄清",
  "general.font.sourceLocal": "已列出本机安装的字体。",
  "general.font.sourceFallback":
    "当前环境无法枚举全部本机字体，已显示常用字体列表。Chrome / Edge / 桌面端可读取完整列表。",
  "general.font.loadError": "无法读取本机字体：{error}",
  "general.font.installedGroup": "已安装字体",
  "general.font.commonGroup": "常用字体",
  "general.language": "界面语言",
  "general.languageDesc":
    "界面文案与模型回复均跟随此语言。切换后将刷新页面，以便全局生效。",
  "general.languageAria": "界面语言",
  "general.lang.en": "English",
  "general.lang.zh": "中文",
  "general.langConfirmTitle": "切换语言？",
  "general.langConfirmBody": "应用将刷新，以便全局切换为{lang}。",
  "general.langConfirmAria": "确认切换语言",
  "general.clarify": "边读边澄清",
  "general.clarifyDesc":
    "在回答中选中文字即可打开澄清提问。始终开启 —— 无需额外账号。",
  "general.plantuml.title": "PlantUML 渲染",
  "general.plantuml.lead":
    "Mermaid 围栏仍默认实时预览（无需 sidecar）。仅在需要时启用 PlantUML，以便 ```plantuml / @startuml 也渲染。",
  "general.plantuml.mode": "PlantUML 模式",
  "general.plantuml.mode.off": "关闭（仅源码）",
  "general.plantuml.mode.server": "服务端（Kroki / PlantUML）",
  "general.plantuml.mode.local": "本地客户端",
  "general.plantuml.mode.offHint":
    "PlantUML 围栏保持可复制源码。需要实时图示请优先用 Mermaid。",
  "general.plantuml.mode.serverHint":
    "优先经 sidecar 代理；sidecar 不可用时，公共 Kroki / plantuml.com 可在浏览器直连渲染。自建地址通常仍需 sidecar。",
  "general.plantuml.mode.localHint":
    "需要 sidecar（npm run sidecar / npm run dev）。优先使用 Homebrew plantuml 可执行文件（/opt/homebrew/bin/plantuml）；jar 模式需 Java。部分图类型需要 Graphviz（brew install graphviz）。本地失败时会软重试服务端 URL。",
  "general.plantuml.serverUrl": "服务端 Base URL",
  "general.plantuml.serverUrlHint":
    "Kroki：https://kroki.io（或自建）。官方：https://www.plantuml.com/plantuml",
  "general.plantuml.localPath": "本地 PlantUML 路径",
  "general.plantuml.localPathHint":
    "plantuml 可执行文件（推荐）或 plantuml.jar 的绝对路径。若指向 Homebrew Cellar 的 jar，会自动改用 plantuml 包装脚本。",
  "general.plantuml.javaPath": "Java 路径（用于 .jar）",
  "general.plantuml.javaPathHint":
    "仅当本地路径以 .jar 结尾且找不到 Homebrew 包装脚本时使用。默认：java",
  "general.plantuml.save": "保存 PlantUML 设置",
  "general.noAccount": "无需账号",
  "general.noAccountBody":
    "ForkNote 不会让你登录。笔记、API 设置与项目偏好都保存在本浏览器的 localStorage 中。",

  "api.title": "默认 API",
  "api.lead":
    "系统级默认连接，用于新建会话以及尚未单独配置 API 的会话。",
  "api.sessionRemarkTitle": "按会话覆盖",
  "api.sessionRemark":
    "每条会话可使用不同的 API。在输入框旁打开「会话 API 设置」，即可仅覆盖该会话的 Base URL、密钥、模型或代理。",
  "api.group.cloud": "云端 / 聚合",
  "api.group.china": "国内服务商",
  "api.group.local": "本地",
  "api.baseUrl": "Base URL",
  "api.apiKey": "API Key（本地通常留空）",
  "api.model": "默认模型",
  "api.modelPlaceholder": "须与本地已加载的模型名一致",
  "api.modelHint":
    "用于新建会话，以及尚未单独设置 API 的会话。可在输入框旁按会话覆盖。",
  "api.useProxy": "开发环境使用本地代理（推荐用于本地模型）",
  "api.hint":
    "请先启动本地服务。Ollama 可运行 ollama list；模型名须与列表一致（如 qwen2.5:7b）。",
  "api.missingBaseUrl": "请在设置中填写 Base URL（或选择预设）。",
  "api.invalidBaseUrl":
    "Base URL 须为完整 http(s) 地址（如 https://api.deepseek.com）。请选择预设或补全 https:// 后保存。",
  "api.missingModel":
    "请在会话 API 设置中填写模型，或在设置 → 默认 API 填写默认模型。",
  "api.missingKey":
    "请在设置中为当前端点填写 API Key，或改用 Ollama 等本地模型。",
  "api.memoryPack.title": "上下文记忆包",
  "api.memoryPack.lead":
    "压缩上下文 → SUMMARY.md + TASKS.md + DECISIONS.md → 下次提问注入。优先写入已绑定项目；否则保存在本会话草稿中。与「归档」（开发日志快照，用于阅读/续聊）是不同能力。",
  "api.memoryPack.inject": "主对话注入项目记忆包",
  "api.memoryPack.layersHint": "偏好 / 会话层与可编辑记忆界面在「设置 → 记忆」。",
  "api.memoryPack.afterArchive": "归档后自动压缩",
  "api.memoryPack.afterArchiveHint":
    "默认关闭。开启后：归档成功再用归档草稿跑一次压缩写入记忆包（不会用同一份原始对话再打一遍）。也可随时单独点「压缩上下文」。",
  "api.memoryPack.dir": "记忆目录（相对项目根）",
  "api.memoryPack.dirPlaceholder": ".forknote/memory",
  "api.memoryPack.windowTurns": "实时滑动窗口（轮数）",
  "api.memoryPack.windowTurnsHint":
    "保留最近若干轮用户↔助手原文；更早轮次压成本地摘要注入（默认 64，上限 256）。",
  "api.memoryPack.autoSummary": "自动摘要较早实时对话",
  "api.memoryPack.autoSummaryHint":
    "关闭后，实时模式会整线程重发（长对话更贵、更易糊）。",

  "memory.title": "记忆",
  "memory.lead": "三层本地记忆——用户偏好、项目记忆包、本笔记会话——可分别注入。在此编辑；不离开本机。",
  "memory.layersTitle": "注入层",
  "memory.layersLead": "选择下次主对话发送时附加哪些层。",
  "memory.layer.preferences": "用户偏好",
  "memory.layer.project": "项目记忆包（SUMMARY / TASKS / DECISIONS）",
  "memory.layer.session": "会话摘要（本笔记）",
  "memory.saveLayers": "保存注入开关",
  "memory.prefsTitle": "偏好",
  "memory.prefsLead": "跨笔记的习惯与长期指令（localStorage）。",
  "memory.prefsEmpty": "暂无偏好。",
  "memory.prefsPlaceholder": "例如：回答尽量简洁；优先 TypeScript",
  "memory.prefsAdd": "添加偏好",
  "memory.edit": "编辑",
  "memory.projectTitle": "项目记忆包",
  "memory.projectLeadBound": "编辑已绑定项目下 {dir}/ 中的文件（同时镜像到本笔记）。",
  "memory.projectLeadLocal": "未绑定项目——编辑保存在本笔记的草稿记忆包。",
  "memory.projectLeadIsolated":
    "本会话记忆已隔离——文件写在 {dir}/，不会读写共享记忆包。",
  "memory.shareToggle": "与其他会话共享记忆",
  "memory.shareToggleHint":
    "关闭后，本笔记使用项目下独立的记忆目录，不与其他会话互通。",
  "memory.projectSave": "保存记忆包",
  "memory.saveFailed": "无法保存记忆包。",
  "memory.sessionTitle": "会话记忆",
  "memory.sessionLead": "仅当前笔记的工作备注。压缩上下文时也会尽量用 SUMMARY 刷新此处。",
  "memory.sessionNone": "打开笔记后即可编辑会话记忆。",
  "memory.sessionPlaceholder": "本笔记目标 / 现状的简短摘要…",
  "memory.sessionClear": "清空",
  "memory.transferTitle": "导入 / 导出",
  "memory.transferLead":
    "导出可移植的 forknote-memory-v1 JSON（SUMMARY / TASKS / DECISIONS，可选偏好与会话摘要）。其他 Agent 可直接使用其中的 Markdown 字段，或写入 .forknote/memory/ 下三个 .md。导入支持该 JSON、宽松 {summary,tasks,decisions}，或 ===SUMMARY.md=== 分隔的 Markdown。",
  "memory.transfer.export": "导出记忆",
  "memory.transfer.import": "导入记忆",
  "memory.transfer.exported": "记忆已导出。",
  "memory.transfer.imported": "记忆已导入。",
  "memory.transfer.exportFailed": "无法导出记忆。",
  "memory.transfer.importFailed": "无法导入记忆。",
  "memory.transfer.needNote": "请先打开一条笔记，再导入项目记忆包或会话摘要。",
  "memory.transfer.importedPrefsOnly": "偏好已导入。",
  "memory.transfer.confirmOverwrite":
    "将覆盖当前项目记忆包（SUMMARY / TASKS / DECISIONS），是否继续？",
  "memory.transfer.importCancelled": "已取消导入，现有记忆包未改动。",

  "data.title": "数据",
  "data.lead":
    "会话与归档保存在本浏览器的 localStorage。清空前请先导出备份。导出 JSON 会省略会话里的 API Key。",
  "data.notesTitle": "本机会话",
  "data.notesCount": "localStorage 中有 {count} 条会话。",
  "data.export": "导出会话（JSON）",
  "data.import": "导入会话（JSON）",
  "data.clear": "清空全部会话",
  "data.clearConfirm": "清空本机全部会话与归档？此操作不可撤销。",
  "data.exported": "已导出会话为 JSON 文件（已省略 API Key）。",
  "data.exportFailed": "导出失败。",
  "data.imported": "已导入 {count} 条会话。",
  "data.importFailed": "导入失败。",
  "data.cleared": "已清空全部会话。",
  "data.alsoStored": "本机还存储了",
  "data.key.settings": "API 设置",
  "data.key.userPreferences": "用户偏好记忆",
  "data.key.recentFiles": "各项目最近 @file 路径",
  "data.key.project": "项目 / sidecar 偏好",
  "data.key.theme": "主题偏好",
  "data.key.locale": "界面语言",
  "data.key.uiFont": "界面字体偏好",

  "projectSettings.title": "项目",
  "projectSettings.lead":
    "本地项目工具通过本机 sidecar 通信。运行 npm run sidecar，然后打开项目文件夹。",
  "projectSettings.sessionHint":
    "每个会话独立绑定项目；切换会话时会恢复该会话的项目（或未绑定）。",
  "projectSettings.sidecarUrl": "Sidecar URL",
  "projectSettings.connected": "已连接：",
  "projectSettings.none": "尚未连接项目。",
  "projectSettings.open": "打开项目…",
  "projectPanel.title": "本地项目",
  "projectPanel.lead":
    "选择本机文件夹后，主对话可在该目录下读写文件。若本地助手尚未运行，请先执行 npm run sidecar（或 npm run dev）。",
  "projectPanel.path": "项目目录",
  "projectPanel.pathPlaceholder": "/Users/you/my-app",
  "projectPanel.browse": "浏览…",
  "projectPanel.browsing": "选择中…",
  "projectPanel.browseFailed": "无法打开文件夹选择器",
  "projectPanel.advanced": "高级",
  "projectPanel.sidecarUrl": "Sidecar 代理路径",
  "projectPanel.sidecarUrlHint":
    "前端代理路径，指向本机 Node 助手（默认 /sidecar → 127.0.0.1:8787）。这不是项目目录路径。",
  "projectPanel.connected": "已连接：",
  "projectPanel.disconnect": "断开",
  "projectPanel.connect": "连接",
  "projectPanel.connecting": "连接中…",
  "projectSettings.agentMaxRounds": "Agent 工具循环轮数（每条消息）",
  "projectSettings.agentMaxRoundsHint":
    "单次发送的模型↔工具硬上限（1–128，默认 50），含仅联网的 web_search/web_fetch 回合。联网问答还会套一层复杂度软预算（简单约 8、复杂约 16），且不会超过本值——若仍看到工具轮数上限提示，可在此调高。任务完成会提前结束。",
  "projectSettings.agentRequireApproval": "执行工具前需批准计划",
  "projectSettings.agentRequireApprovalHint":
    "连接项目后，Agent 会先输出计划；你点击「批准并执行」后才会读写文件。",
  "projectSettings.agentAllowTerminal": "允许终端工具（run_terminal）",
  "projectSettings.agentAllowTerminalHint":
    "允许 Agent 通过 sidecar 在已绑定项目内执行 shell 命令。默认开启。命令从项目根启动（不是 sidecar 进程目录）。项目内只读命令（ls/pwd 等）可跳过计划批准；改动命令或访问项目外路径需先批准权限。",
  "projectSettings.agentAutoDiagnostics": "改代码后自动类型检查",
  "projectSettings.agentAutoDiagnosticsHint":
    "成功改写 TypeScript/JavaScript 后自动跑 run_diagnostics，并把错误喂回 Agent 循环。默认开启。",
  "projectSettings.agentPlanModel": "计划阶段模型（可选）",
  "projectSettings.agentPlanModelHint":
    "用于起草待批准计划。留空则使用会话 API 模型。",
  "projectSettings.agentCodeModel": "编码/工具阶段模型（可选）",
  "projectSettings.agentCodeModelHint":
    "用于批准后的工具循环。留空则使用会话 API 模型。",
  "projectSettings.agentSummaryModel": "总结/问答模型（可选）",
  "projectSettings.agentSummaryModelHint":
    "用于归档、压缩上下文，以及无需项目工具时的轻量问答。留空则使用会话 API 模型。",
  "projectSettings.agentModelPlaceholder": "与会话模型相同",

  "agentPlan.aria": "Agent 计划审核",
  "agentPlan.kicker": "执行计划",
  "agentPlan.lead": "请审阅下方计划。批准后将对你的项目执行工具；关闭审批条不会删除你的提问与回复。",
  "agentPlan.chunkNote": "本轮：{shown}/{total} 步。批准后仅执行这些步骤；其余步骤将在本轮完成后再次规划。",
  "agentPlan.approve": "批准并执行",
  "agentPlan.cancel": "关闭",
  "agentPlan.running": "执行中…",

  "agentTool.aria": "工具批准",
  "agentTool.allow": "允许",
  "agentTool.stop": "停止",
  "agentTool.running": "执行中…",
  "agentTool.actionPending": "批准后将由代理确定具体操作。",

  "agentTerminal.aria": "终端命令批准",
  "agentTerminal.kicker": "终端",
  "agentTerminal.lead": "要在已绑定项目中运行这条命令吗？",
  "agentTerminal.cwd": "cwd",
  "agentTerminal.note":
    "经本地 sidecar 在项目根下执行。shell 仍可能访问项目外的路径。",
  "agentTerminal.outsideWarn":
    "此命令会访问绑定项目以外的路径。批准即授予本次运行的项目外终端权限。",
  "agentTerminal.outsideLead":
    "此命令会离开项目目录。是否批准项目外访问权限？",
  "agentTerminal.run": "运行",
  "agentTerminal.skip": "跳过",
  "agentTerminal.allow": "允许",
  "agentTerminal.reject": "停止",
  "agentTerminal.stop": "停止",
  "agentTerminal.running": "执行中…",
  "agentTerminal.commandPending": "批准后将由代理确定具体命令。",

  "about.title": "关于",
  "about.tag":
    "边读边澄清 —— 把 AI 回答变成贴合现实的研究笔记。",
  "about.lead":
    "本地优先 · 无需账号 · OpenAI 兼容模型 · 可选本地项目 sidecar。",
  "about.terms": "使用条款",
  "about.privacy": "隐私",
  "about.version": "版本 0.1.0",
  "about.back": "← 关于",
  "about.termsBody1":
    "ForkNote 是本地优先的研究笔记应用。你需自行负责 API 密钥、模型用量，以及创建或发送给服务商的内容。",
  "about.termsBody2":
    "软件按现状提供，不作任何担保。请自行承担使用风险。",
  "about.privacyBody1":
    "ForkNote 不运营账号服务。除非你主动导出，笔记、设置与项目偏好都留在浏览器 localStorage。",
  "about.privacyBody2":
    "对话时，消息会发送到你配置的 API 端点（云端或本地）。我们不会收到该流量的副本。",

  "sidebar.notesAria": "会话",
  "sidebar.expand": "展开侧栏",
  "sidebar.collapse": "收起侧栏",
  "sidebar.openList": "打开会话列表",
  "sidebar.closeList": "关闭",
  "sidebar.lightMode": "浅色模式",
  "sidebar.darkMode": "深色模式",
  "sidebar.toLight": "切换到浅色模式",
  "sidebar.toDark": "切换到深色模式",
  "sidebar.newNote": "新建会话",
  "sidebar.empty": "还没有会话 —— 在右侧提问即可。",
  "sidebar.today": "今天",
  "sidebar.previous7": "近 7 天",
  "sidebar.rename": "重命名",
  "sidebar.pin": "置顶",
  "sidebar.unpin": "取消置顶",
  "sidebar.shareMemory": "与其他会话共享记忆",
  "sidebar.isolateMemory": "仅本会话使用记忆",
  "sidebar.shareMemoryHint":
    "开：使用项目共享记忆包。关：仅本会话使用独立记忆。",
  "sidebar.share": "分享",
  "sidebar.shareCopied": "已复制到剪贴板",
  "sidebar.shareFailed": "无法复制到剪贴板",
  "sidebar.pinned": "置顶",
  "sidebar.delete": "删除",
  "sidebar.deleteConfirm": "删除这条会话？此操作不可撤销。",
  "sidebar.deleteDontAskAgain": "不再提示",
  "sidebar.renameAria": "重命名会话",
  "sidebar.more": "更多",
  "sidebar.moreAria": "更多操作",
  "sidebar.renameHint": "{title}（双击重命名）",
  "sidebar.sessionHint": "{title} · {model}（双击重命名）",

  "share.title": "分享对话",
  "share.hint":
    "勾选要分享的消息，然后导出独立 HTML 文件。对方用任意浏览器打开即可（含 file://），无需本机或 ForkNote 托管。",
  "share.selectedCount": "已选 {selected} / {total}",
  "share.selectAll": "全选",
  "share.clear": "清空",
  "share.empty": "暂无可以分享的消息。",
  "share.roleUser": "你",
  "share.roleAssistant": "助手",
  "share.noneSelected": "请至少勾选一条消息。",
  "share.exportHtml": "导出 HTML",
  "share.exportFailed": "导出 HTML 失败",
  "share.htmlFooter": "由 ForkNote 导出 · 只读",
  "share.createLink": "创建分享链接",
  "share.creating": "创建中…",
  "share.linkLabel": "分享链接",
  "share.copyLink": "复制链接",
  "share.copyContent": "复制内容",
  "share.copied": "已复制",
  "share.copyFailed": "无法复制到剪贴板",
  "share.encodeFailed": "无法生成分享链接",
  "share.tooLarge":
    "所选内容过大，无法放入链接（上限约 {limit} 字符）。请改用「导出 HTML」或「复制内容」，或少选一些消息。",
  "share.softWarn": "链接较长，部分浏览器或聊天软件可能截断。",
  "share.linkNote":
    "可选：将所选消息压缩后编码进 URL 哈希。对方须能访问当前这个 ForkNote 地址（不适合跨网分享）。约 200K 起提示过长，硬上限约 1.5M。跨网请优先「导出 HTML」。",
  "share.viewerKicker": "分享的笔记",
  "share.viewerLoading": "正在加载分享内容…",
  "share.viewerInvalid": "分享链接无效或不完整。",
  "share.openApp": "打开 ForkNote",
  "share.untitled": "未命名",

  "main.tagline": "边读边澄清",
  "main.howTo": "使用方式",
  "main.step1": "提出开发或研究问题",
  "main.step2": "选中不懂的文字，立刻澄清",
  "main.step3": "逐点裁决 —— 什么有效、哪里欠可信、什么不适合你",
  "main.untitled": "未命名",
  "main.notesKicker": "",
  "main.renameTitle": "重命名本会话",
  "main.forks": "{count} 个分支",
  "main.forksTitle": "打开分支历史路线图",
  "main.viewMode.reading": "阅读",
  "main.viewMode.source": "源码",
  "main.viewMode.toReadingTitle": "切换到阅读模式（渲染 Markdown）",
  "main.viewMode.toSourceTitle": "切换到源码模式（原始 Markdown）",
  "main.viewMode.aria": "切换主线程阅读 / 源码显示",
  "main.viewMode.sourceLabel": "源码",
  "main.thinking": "思考中",
  "chat.copy": "复制",
  "chat.copied": "已复制",
  "chat.copySource": "复制源码",
  "chat.diagram.rendering": "正在渲染图示…",
  "chat.diagram.renderFailed": "图示渲染失败 — 显示源码。{detail}",
  "chat.diagram.viewSource": "查看源码",
  "chat.diagram.viewDiagram": "查看图示",
  "chat.diagram.copyImage": "复制图片",
  "chat.diagram.imageCopied": "图片已复制",
  "chat.diagram.imageDownloaded": "图片已下载",
  "chat.diagram.copyImageFailed": "无法复制图片",
  "chat.diagram.plantumlFallback":
    "PlantUML 以源码展示。可在「设置 → 通用 → PlantUML」启用服务端或本地渲染；需要实时图示也可优先用 Mermaid 围栏。",
  "chat.image.copyMarkdown": "复制 Markdown",
  "chat.image.open": "打开图片",
  "chat.image.failed": "图片加载失败",
  "chat.edit": "编辑",
  "chat.thinking": "思考中…",
  "chat.thought": "推理",
  "chat.thoughtSeconds": "推理（用时 {n} 秒）",
  "main.bannerText": "后续对话将以归档日志为上下文",
  "main.viewArchive": "查看归档",
  "main.gotIt": "知道了",
  "main.archiveComposerHint":
    "发送以归档日志为底座；下方续聊会一并带上",
  "main.evolutionComposerHint":
    "屏幕显示澄清演进记录；发送仍以归档日志为底座",
  "main.contextModeAria": "先前会话显示方式",
  "main.switchContextAria": "切换先前会话的显示方式",
  "main.archiveContext": "归档内容",
  "main.archiveContextTitle": "显示归档正文，后续对话以它为底座",
  "main.liveConversation": "原始对话",
  "main.liveConversationTitle": "退出归档模式，回到完整原始对话",
  "main.fullThread": "演进记录",
  "main.fullThreadTitle": "显示澄清演进；发送仍以归档日志为底座",
  "main.archiveBaseKicker": "归档底座",
  "main.archivesCount": "{count} 篇归档",
  "main.archiveHistory": "归档历史",
  "main.archivesViewTitle": "切换历史归档",
  "main.archive": "归档",
  "main.archiving": "归档中…",
  "main.archiveTitle":
    "归档：将主线归纳为带日期的开发日志（背景/目标 · 尝试过程 · 结论/结果 · 参考），供阅读/续聊。与「压缩上下文」记忆包不同。",
  "main.compress": "压缩上下文",
  "main.compressing": "压缩中…",
  "main.compressTitle":
    "压缩：写入 SUMMARY.md、TASKS.md、DECISIONS.md 供下次恢复。与「归档」不同。",
  "main.memory": "记忆",
  "main.memoryTitle": "打开记忆设置（注入层、偏好、记忆包）",
  "main.compressDoneProject":
    "记忆已写入项目记忆目录，并保存在本会话中",
  "main.compressDoneSession":
    "记忆已保存在本会话中（绑定项目后还会写入 SUMMARY/TASKS/DECISIONS.md）",
  "main.compressSuggestText":
    "对话已经较长 — 建议压缩为 SUMMARY / TASKS / DECISIONS，让后续轮次更省、更清晰。",
  "main.compressSuggestAction": "立即压缩",
  "main.compressSuggestDismiss": "暂不",
  "main.placeholderEmpty": "随便问 — 问题、想法，或要一段示例代码…",
  "main.placeholderProject":
    "询问项目，例如：列出当前目录、读取 package.json、或修改 README…",
  "main.placeholderContinue": "继续对话…",
  "main.placeholderContinueProject":
    "继续主线，或让助手列出/读取/修改项目文件…",
  "main.placeholderArchive": "从归档内容继续…",

  "composer.hintHero": "在回答中拖选文字即可澄清 · Enter 发送",
  "composer.hintCompact": "Enter 发送 · Shift+Enter 换行",
  "composer.hintHeroProject": "输入 @ 附带项目文件 · 拖选文字澄清 · Enter 发送",
  "composer.hintCompactProject": "@file 附带文件 · Enter 发送 · Shift+Enter 换行",
  "composer.includesAria": "将注入下次提问的文件",
  "composer.removeInclude": "移除 {path}",
  "composer.newQuestion": "新问题",
  "composer.continue": "继续主线",
  "composer.stopAria": "停止生成",
  "composer.model": "模型",
  "composer.modelPlaceholder": "模型 ID",
  "composer.modelTitle": "本笔记使用的模型（覆盖设置中的默认）",
  "composer.modelAria": "本笔记模型",

  "network.toggleOff": "联网",
  "network.toggleOn": "联网",
  "network.toggleOffline": "离线",
  "network.toggleAria": "开关联网工具（网页搜索/抓取）",
  "network.toggleTitleOff": "联网关闭 — Agent 不会搜索或抓取网页",
  "network.toggleTitleOn": "联网已开 — 在线时可使用 web_search / web_fetch",
  "network.toggleTitleOffline": "已开联网但当前设备离线",

  "sessionApi.button": "API",
  "sessionApi.buttonAria": "本笔记的 API 设置",
  "sessionApi.buttonTitleDefault":
    "使用系统 API 默认 — 点击可为当前笔记单独配置",
  "sessionApi.buttonTitleCustom":
    "本笔记已有自定义 API 设置 — 点击编辑",
  "sessionApi.noModel": "设置模型",
  "sessionApi.title": "会话 API 设置",
  "sessionApi.lead":
    "仅作用于当前笔记。系统设置 → API 仍是未单独配置笔记的默认值。",
  "sessionApi.inheritHint":
    "当前显示的是系统继承值。修改并保存后，将为本笔记创建覆盖项。",
  "sessionApi.customHint":
    "本笔记已有自定义 API。重置会清除覆盖，重新继承系统默认。",
  "sessionApi.model": "模型",
  "sessionApi.modelHint":
    "仅与系统设置不同的字段会作为覆盖保存。",
  "sessionApi.reset": "恢复默认",

  "archive.title": "开发日志归档",
  "archive.hintLoading": "正在生成开发日志（背景/目标 · 尝试过程 · 结论/结果 · 参考）…",
  "archive.hintIdle": "可用归档继续，或切回完整线程",
  "archive.hintUpToDate": "已归档，且自上一版以来没有新变化。可在下方查看当前归档。",
  "archive.hintUpToDateShort": "已是最新",
  "archive.copyPath": "复制路径",
  "archive.copyPathTitle": "复制归档文件路径",
  "archive.pathNeedProject":
    "绑定本地项目后，归档会写入 .forknote/archives/",
  "archive.pathPending":
    "已绑定项目时，下次归档会写入 .forknote/archives/",
  "archive.past": "历史归档",
  "archive.activeContext": " · 当前上下文",
  "archive.generatingAria": "正在生成归档",
  "archive.generating": "正在生成开发日志草稿…",
  "archive.empty": "暂无归档内容",
  "archive.deleteConfirm": "删除此归档？主线消息不受影响。",
  "archive.fullThread": "完整线程",
  "archive.continue": "用归档继续",

  "projectBar.open": "打开项目",
  "projectBar.activityAria": "助手活动",

  "clarify.toolbar": "澄清此处",
  "clarify.aria": "选中澄清",
  "clarify.title": "选中澄清",
  "clarify.placeholder": "哪里不清楚？例如：这句话是什么意思？",
  "clarify.point": "澄清此点",
  "clarify.pointShort": "澄",
  "clarify.pointPlaceholder":
    "这一点哪里不清楚？例如：为什么要这一步 / 它意味着什么？",
  "clarify.queued": "澄清已排队 — 当前分支结束后自动开始。",
  "clarify.queuedCancel": "取消排队",
  "clarify.hint": "绑定项目后可用与主对话相同的工具 · Enter 发送 · Shift+Enter 换行 · 拖标题移动",
  "clarify.error.needProject": "请先打开本地项目（打开项目），然后再试一次澄清提问。",

  "fork.labelQuestion": "提问",
  "fork.labelAnswer": "回答",
  "fork.labelFollowUp": "追问",
  "fork.title": "Clarify",
  "fork.nested": "嵌套",
  "fork.layer": "第{n}层",
  "fork.closeAllAria": "关闭全部分支浮层",
  "fork.railAria": "分支结构",
  "fork.mapTitle": "分支历史路线图",
  "fork.mapLead":
    "主线回答是干线，澄清分支向旁侧延伸。点击节点即可查看对应内容。",
  "fork.mapAria": "会话分支历史路线图",
  "fork.mapEmpty": "还没有可绘制的主线回答。",
  "fork.mapMainStep": "回答 {n}",
  "fork.followUpPlaceholder": "在此窗口继续追问…",
  "fork.followUpAria": "追问",
  "fork.followUpHint": "同窗口 · Enter 发送 · Shift+Enter 换行",
  "fork.continueAsk": "继续追问…",
  "fork.hideComposer": "收起",
  "fork.adoptIntoMain": "采纳进主线",
  "fork.adoptIntoMainAgain": "更新主线注记",
  "fork.adoptIntoMainHint":
    "在主回答对应位置插入澄清注记（不覆盖原文）",
  "fork.adopted": "已采纳",
  "fork.adoptedHint": "该分支结论已写入主回答",
  "fork.adoptedNote": "澄清结论",
  "fork.adoptedEmpty": "还没有澄清正文",
  "fork.adoptExpand": "展开全部",
  "fork.adoptCollapse": "收起",
  "fork.unadoptFromMain": "撤销采纳",
  "fork.unadoptFromMainHint": "从主回答中移除澄清注记",
  "fork.error.context": "无法解析分支上下文",
  "fork.error.answer": "分支回答请求失败",
  "fork.error.followUp": "分支追问请求失败",

  "verdict.accept": "采纳",
  "verdict.doubt": "存疑",
  "verdict.reject": "不采纳",
  "verdict.doubtNote": "可选备注",
  "verdict.doubtPlaceholder": "哪里需要更多证据或更清晰的边界…",
  "verdict.pointAria": "第 {n} 点反馈",
  "verdict.hypoAria": "确认反馈原因",
  "verdict.hypoYes": "对",
  "verdict.hypoNo": "不对",
  "checkpoint.truncated": "已截断 — 后续步骤不再作为方案",
  "checkpoint.hint":
    "把已采纳步骤、收进主线的澄清、以及不采纳原因整合成检查点日志。后续对话将以这份文档为底座。",
  "checkpoint.action": "整合进展",
  "checkpoint.working": "整合中…",
  "verdict.hypoConfirmed": "已确认原因",
  "verdict.hypoUnsureConfirmed": "需要进一步验证",
  "verdict.unsureClarifyHint":
    "存疑不等于否定——请先确认上方原因，或点「澄」针对此点追问。",
  "verdict.hypoStreakHint": "同类回答已被连续拒绝几次——确认一下能帮我更快调整。",

  "chat.generating": "生成中…",

  "project.error.sidecar": "无法连接 sidecar",
  "project.error.sidecarHint": "无法连接 sidecar（请先运行 npm run sidecar）",
  "project.error.needPath": "请输入项目的绝对路径",

  "agent.error.execution": "Agent 执行失败",
  "agent.error.needProject": "请先打开本地项目（打开项目），然后再请求创建文件。",
  "chat.error.answer": "回答请求失败",

  "archive.error.empty": "归档结果为空 — 请重试",
  "archive.error.request": "归档请求失败",
  "archive.defaultTitle": "开发日志草稿",

  "compress.error.empty": "上下文压缩结果为空 — 请重试",
  "compress.error.request": "上下文压缩请求失败",

  "agent.status.listing": "正在列出 {path}…",
  "agent.status.reading": "正在读取 {path}…",
  "agent.status.searching": "正在搜索 {query}…",
  "agent.status.creating": "正在创建 {path}…",
  "agent.status.tools": "正在使用项目工具…",
  "agent.status.listRoot": "正在列出项目根目录…",
  "agent.status.terminal": "正在运行 `{command}`…",
  "agent.toolRoundLimit":
    "（已达到工具循环上限（{rounds} 轮）。可基于已有结果继续，或再发一条消息。若需要更多轮次，请到「设置 → 项目」提高 Agent 工具循环轮数。）",

  "agent.activity.listed": "已列出 {path}",
  "agent.activity.reading": "正在读取 {path}（{size} 字节）",
  "agent.activity.wrote": "已写入 {path}",
  "agent.activity.mkdir": "mkdir {path}",
  "agent.activity.patched": "已修补 {path} ×{n}",
  "agent.activity.patchedEdits": "已修补 {path}（{edits} 处）",
  "agent.activity.search": "搜索 “{query}” → {n} 处",
  "agent.activity.ranCommand": "已运行 `{command}`（exit {code}）",
  "agent.activity.terminalMissingCommand": "run_terminal 缺少 command",
  "agent.activity.terminalDisabled": "设置中已禁用 run_terminal",
  "agent.activity.terminalNoProject": "run_terminal 需要先打开项目",
  "agent.activity.terminalOutsideDenied":
    "已拦截项目外终端 — 需要先批准权限",
  "agent.activity.terminalDenied": "命令被终端危险命令黑名单拦截",
  "agent.activity.unknownTool": "未知工具",
  "agent.activity.toolFailed": "工具失败",
  "agent.activity.readMissingPath": "read_file 缺少 path",
  "agent.activity.mkdirMissingPath": "mkdir 缺少 path",
  "agent.activity.writeMissingPath": "write_file 缺少 path",
  "agent.activity.writeMissingContent": "write_file 缺少 content",
  "agent.activity.writeOfficeBinary": "write_file 无法创建 Office 二进制文件",
  "agent.activity.replaceMissingPath": "search_replace 缺少 path",
  "agent.activity.replaceMissingOld": "search_replace 缺少 old_string",
  "agent.activity.replaceMissingNew": "search_replace 缺少 new_string",
  "agent.activity.patchMissingPath": "apply_patch 缺少 path",
  "agent.activity.patchMissingEdits": "apply_patch 缺少 edits",
  "agent.activity.docxMissingPath": "write_docx 缺少 path",
  "agent.activity.xlsxMissingPath": "write_xlsx 缺少 path",
  "agent.activity.xlsxMissingRows": "write_xlsx 缺少 rows",
  "agent.activity.searchMissingQuery": "search_files 缺少 query",
  "agent.activity.globMissingPattern": "glob_files 缺少 pattern",
  "agent.activity.glob": "Glob “{pattern}” → {n} 个文件",
  "agent.activity.symbolMissingName": "缺少符号名 name",
  "agent.activity.findSymbol": "find_symbol “{name}” → {n}",
  "agent.activity.goToDefinition": "go_to_definition “{name}” → {n} 个候选",
  "agent.activity.findReferences": "find_references “{name}” → {n}",
  "agent.activity.dependencyGraph": "dependency_graph → {n} 条边",
  "agent.activity.semanticSearch": "semantic_search “{query}” → {n}",
  "agent.activity.codingMemoryMissingNote": "coding_memory append 需要 note",
  "agent.activity.codingMemoryAppend": "已写入编码记忆",
  "agent.activity.codingMemoryRead": "已读取编码记忆",
  "agent.activity.deleteMissingPath": "delete_file 缺少 path",
  "agent.activity.deleted": "已删除 {path}",
  "agent.activity.renameMissingArgs": "rename_file 缺少 from/to",
  "agent.activity.renamed": "已重命名 {from} → {to}",
  "agent.activity.readDocxMissingPath": "read_docx 缺少 path",
  "agent.activity.readDocx": "正在读取 Word {path}",
  "agent.activity.readXlsxMissingPath": "read_xlsx 缺少 path",
  "agent.activity.readXlsx": "正在读取 Excel {path}",
  "agent.activity.patchXlsxMissingPath": "patch_xlsx 缺少 path",
  "agent.activity.patchXlsxMissingCells": "patch_xlsx 缺少 cells",
  "agent.activity.patchedXlsx": "已修补 {path} 的 {n} 个单元格",
  "agent.activity.diagnosticsSkipped": "已跳过诊断（无 tsconfig.json）",
  "agent.activity.diagnosticsOk": "诊断通过",
  "agent.activity.diagnosticsFailed": "诊断发现问题",
  "agent.activity.gitStatus": "git status（exit {code}）",
  "agent.activity.gitDiff": "git diff（exit {code}）",
  "agent.activity.gitCommitMissingMessage": "git_commit 缺少 message",
  "agent.activity.gitCommitMissingPaths": "git_commit 缺少 paths",
  "agent.activity.gitCommit": "git commit（{n} 个路径，exit {code}）",

  "comments.title": "批注",
  "comments.empty": "在回答中拖选文字，然后点击「澄清此处」。",
  "comments.badge": "批注 {n}",
  "comments.collapseAnswer": "收起回答",
  "comments.expandAnswer": "展开回答",
  "comments.nestedOne": "1 条嵌套回复 — 展开查看",
  "comments.nestedMany": "{count} 条嵌套回复 — 展开查看",

  "tree.outline": "大纲",
  "tree.mainConversation": "主对话",

  "ask.aria": "针对选中内容提问",
  "ask.title": "针对选中内容提问",
  "ask.placeholder": "输入你的问题…",
  "ask.hint": "⌘/Ctrl + Enter 提交",
  "projectBar.changes": "本轮变更",
};

const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  en: en as Record<MessageKey, string>,
  zh,
};

function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}

export function t(
  key: MessageKey,
  vars?: Vars,
  locale: Locale = getLocale(),
): string {
  const dict = dictionaries[locale] ?? dictionaries.en;
  return format(dict[key] ?? dictionaries.en[key] ?? key, vars);
}

export type { MessageKey };

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof document !== "undefined") {
      applyDocumentLang(resolveInitialLocale());
    }
    return resolveInitialLocale();
  });

  useEffect(() => {
    const onNotify: Listener = (next) => setLocaleState(next);
    listeners.add(onNotify);
    applyDocumentLang(locale);
    return () => {
      listeners.delete(onNotify);
    };
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
  }, []);

  const translate = useCallback(
    (key: MessageKey, vars?: Vars) => t(key, vars, locale),
    [locale],
  );

  return { locale, setLocale, t: translate };
}
