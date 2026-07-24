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
  "common.save": "Save",
  "common.saved": "Saved",
  "common.close": "Close",
  "common.delete": "Delete",
  "common.settings": "Settings",
  "common.disconnect": "Disconnect",
  "common.enabled": "Enabled",
  "common.optional": "Optional",

  "settings.title": "System settings",
  "settings.closeAria": "Close settings",
  "settings.navAria": "Settings categories",
  "settings.nav.general": "General",
  "settings.nav.api": "API",
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
  "general.language": "Interface language",
  "general.languageDesc":
    "UI chrome and model replies follow this language.",
  "general.languageAria": "Interface language",
  "general.lang.en": "English",
  "general.lang.zh": "中文",
  "general.clarify": "Clarify as you read",
  "general.clarifyDesc":
    "Select text in answers to open a clarify prompt. Always on — no extra account.",
  "general.noAccount": "No account",
  "general.noAccountBody":
    "ForkNote does not sign you in. Notes, API settings, and project prefs are stored in this browser's localStorage.",

  "api.title": "API",
  "api.lead":
    "Any OpenAI-compatible endpoint works (cloud or local). For cloud providers, create an API Key in their console; local setups usually leave it blank. In development, enable “Use local proxy” so requests go through /openai to the Base URL you set.",
  "api.group.cloud": "Cloud / aggregators",
  "api.group.china": "China providers",
  "api.group.local": "Local",
  "api.baseUrl": "Base URL",
  "api.apiKey": "API Key (usually blank for local)",
  "api.model": "Model",
  "api.modelPlaceholder": "Must match a locally loaded model name",
  "api.useProxy":
    "Use local proxy in development (recommended for local models)",
  "api.hint":
    "Start the local server first. For Ollama, run ollama list; Model must match a listed name (e.g. qwen2.5:7b).",
  "api.missingBaseUrl": "Set Base URL in settings (or pick a preset).",
  "api.invalidBaseUrl":
    "Base URL must be a full http(s) URL (e.g. https://api.deepseek.com). Pick a preset or include https://, then Save.",
  "api.missingModel": "Set Model in settings (must match your provider or local server).",
  "api.missingKey":
    "Add an API Key in settings for your configured endpoint, or switch to a local model such as Ollama.",
  "api.memoryPack.title": "Context memory pack",
  "api.memoryPack.lead":
    "Chat → LLM compress → SUMMARY.md + TASKS.md + DECISIONS.md → inject on next ask. Prefer writing into the bound project; otherwise keep a draft on the note.",
  "api.memoryPack.inject": "Inject memory pack into main chat",
  "api.memoryPack.afterArchive": "Also compress after Archive",
  "api.memoryPack.dir": "Memory folder (relative to project)",
  "api.memoryPack.dirPlaceholder": ".forknote/memory",
  "api.mem0.title": "Long-term (mem0 cloud)",
  "api.mem0.lead":
    "Optional overlay on top of the local MD pack. Off by default — local SUMMARY/TASKS/DECISIONS stay local-first.",
  "api.mem0.enable": "Enable mem0 cloud memory",
  "api.mem0.apiKey": "mem0 API Key",
  "api.mem0.userId": "mem0 user id",
  "api.mem0.userIdPlaceholder": "Blank = stable id for this browser",
  "api.mem0.host": "mem0 host (optional)",
  "api.mem0.privacy":
    "Privacy: when enabled, turns / archives / compress packs may be sent to the mem0 host. Prefer the local MD pack for local-first workflows.",

  "data.title": "Data",
  "data.lead":
    "Notes and archives live in localStorage on this browser. Export a backup before clearing.",
  "data.notesTitle": "Notes on this device",
  "data.notesCount":
    "{count} note(s) in localStorage.",
  "data.export": "Export notes (JSON)",
  "data.import": "Import notes (JSON)",
  "data.clear": "Clear all notes",
  "data.clearConfirm":
    "Clear all notes and archives on this device? This cannot be undone.",
  "data.exported": "Exported notes to a JSON file.",
  "data.exportFailed": "Export failed.",
  "data.imported": "Imported {count} note(s).",
  "data.importFailed": "Import failed.",
  "data.cleared": "All notes cleared.",
  "data.alsoStored": "Also stored locally",
  "data.key.settings": "API settings",
  "data.key.project": "project / sidecar prefs",
  "data.key.theme": "theme preference",
  "data.key.locale": "interface language",

  "projectSettings.title": "Project",
  "projectSettings.lead":
    "Local project tools talk to a sidecar on this machine. Run npm run sidecar, then open a project folder.",
  "projectSettings.sessionHint":
    "Each chat session binds its own project. Switching sessions restores that session's project (or none).",
  "projectSettings.sidecarUrl": "Sidecar URL",
  "projectSettings.connected": "Connected:",
  "projectSettings.none": "No project connected.",
  "projectSettings.open": "Open project…",
  "projectSettings.agentMaxRounds": "Agent tool rounds (per message)",
  "projectSettings.agentMaxRoundsHint":
    "Max model↔tool loops when a project is bound (1–64). Default 20. Ends early when the task is done.",
  "projectSettings.agentRequireApproval": "Require plan approval before tools",
  "projectSettings.agentRequireApprovalHint":
    "When a project is connected, the agent drafts a plan first. Tools run only after you approve.",

  "agentPlan.aria": "Agent plan review",
  "agentPlan.kicker": "Agent plan",
  "agentPlan.lead": "Review the plan below. Approve to run tools on your project, or cancel to discard this turn.",
  "agentPlan.approve": "Approve & run",
  "agentPlan.cancel": "Cancel",
  "agentPlan.running": "Running…",

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

  "sidebar.notesAria": "Notes",
  "sidebar.expand": "Expand sidebar",
  "sidebar.collapse": "Collapse sidebar",
  "sidebar.lightMode": "Light mode",
  "sidebar.darkMode": "Dark mode",
  "sidebar.toLight": "Switch to light mode",
  "sidebar.toDark": "Switch to dark mode",
  "sidebar.newNote": "New note",
  "sidebar.empty": "No notes yet — ask a question on the right.",
  "sidebar.today": "Today",
  "sidebar.previous7": "Previous 7 days",
  "sidebar.rename": "Rename",
  "sidebar.delete": "Delete",
  "sidebar.deleteConfirm": "Delete this note? This cannot be undone.",
  "sidebar.renameAria": "Rename note",
  "sidebar.more": "More",
  "sidebar.moreAria": "More actions",
  "sidebar.renameHint": "{title} (double-click to rename)",
  "sidebar.openProject": "Open project",
  "sidebar.openProjectAria": "Open local project",
  "sidebar.project": "Project",
  "sidebar.projectConnected": "Project connected",
  "sidebar.projectTitle": "Project: {path}",

  "main.tagline": "Clarify as you read",
  "main.howTo": "How to use",
  "main.step1": "Ask a development or research question",
  "main.step2": "Select unfamiliar text and clarify instantly",
  "main.step3": "Verdict each point — reject errors, keep what you accept",
  "main.untitled": "Untitled",
  "main.notesKicker": "notes",
  "main.forks": "{count} forks",
  "main.forksTitle": "Open fork nodes from the graph on the right",
  "main.thinking": "Thinking",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.edit": "Edit",
  "chat.thinking": "Thinking…",
  "chat.thought": "Thought",
  "chat.thoughtSeconds": "Thought ({n}s)",
  "main.bannerText":
    "Follow-up chat will use the archive log as context",
  "main.viewArchive": "View archive",
  "main.gotIt": "Got it",
  "main.archiveComposerHint":
    "Sends use the archive log as context; older bubbles on screen are not all sent to the model",
  "main.contextModeAria": "Conversation context mode",
  "main.switchContextAria": "Switch context mode",
  "main.archiveContext": "Archive context",
  "main.archiveContextTitle":
    "Use the archive log as the base for follow-up chat",
  "main.fullThread": "Full thread",
  "main.fullThreadTitle": "Use the full conversation thread",
  "main.archivesCount": "{count} archives",
  "main.archivesViewTitle":
    "Open archive panel to view or switch archives",
  "main.archive": "Archive",
  "main.archiving": "Archiving…",
  "main.archiveTitle":
    "Summarize the main thread and point verdicts into a development log draft",
  "main.compress": "Compress context",
  "main.compressing": "Compressing…",
  "main.compressTitle":
    "Summarize this thread into SUMMARY.md, TASKS.md, and DECISIONS.md for next-turn restore",
  "main.compressDoneProject":
    "Memory written under the project memory folder and saved on this note",
  "main.compressDoneSession":
    "Memory saved on this note (bind a project to also write SUMMARY/TASKS/DECISIONS.md)",
  "main.placeholderEmpty": "Ask what you're researching…",
  "main.placeholderProject":
    "Ask about the project — e.g. list the folder, read package.json, or edit the README…",
  "main.placeholderContinue": "Continue the main thread…",
  "main.placeholderContinueProject":
    "Continue the main thread, or ask to list/read/write project files…",
  "main.placeholderArchive": "Continue on the archive context…",

  "composer.hintHero":
    "Drag-select text in answers to clarify · Enter to send",
  "composer.hintCompact": "Enter to send · Shift+Enter for a new line",
  "composer.newQuestion": "New question",
  "composer.continue": "Continue main thread",
  "composer.stopAria": "Stop generating",

  "archive.title": "Development log archive",
  "archive.hintLoading":
    "Summarizing the main thread and point verdicts…",
  "archive.hintIdle":
    "Use an archive to continue, or switch back to the full thread",
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
  "projectBar.clearLog": "Clear log",
  "projectBar.activityAria": "Agent activity",
  "projectBar.changes": "Changes this turn",
} as const;

type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  "common.send": "发送",
  "common.stop": "停止",
  "common.cancel": "取消",
  "common.save": "保存",
  "common.saved": "已保存",
  "common.close": "关闭",
  "common.delete": "删除",
  "common.settings": "设置",
  "common.disconnect": "断开",
  "common.enabled": "已开启",
  "common.optional": "可选",

  "settings.title": "系统设置",
  "settings.closeAria": "关闭设置",
  "settings.navAria": "设置分类",
  "settings.nav.general": "通用",
  "settings.nav.api": "API",
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
  "general.language": "界面语言",
  "general.languageDesc": "界面文案与模型回复均跟随此语言。",
  "general.languageAria": "界面语言",
  "general.lang.en": "English",
  "general.lang.zh": "中文",
  "general.clarify": "边读边澄清",
  "general.clarifyDesc":
    "在回答中选中文字即可打开澄清提问。始终开启 —— 无需额外账号。",
  "general.noAccount": "无需账号",
  "general.noAccountBody":
    "ForkNote 不会让你登录。笔记、API 设置与项目偏好都保存在本浏览器的 localStorage 中。",

  "api.title": "API",
  "api.lead":
    "任何 OpenAI 兼容端点均可（云端或本地）。云端请在控制台创建 API Key；本地通常留空。开发环境下建议开启「使用本地代理」，请求经 /openai 转发到你填写的 Base URL。",
  "api.group.cloud": "云端 / 聚合",
  "api.group.china": "国内服务商",
  "api.group.local": "本地",
  "api.baseUrl": "Base URL",
  "api.apiKey": "API Key（本地通常留空）",
  "api.model": "模型",
  "api.modelPlaceholder": "须与本地已加载的模型名一致",
  "api.useProxy": "开发环境使用本地代理（推荐用于本地模型）",
  "api.hint":
    "请先启动本地服务。Ollama 可运行 ollama list；模型名须与列表一致（如 qwen2.5:7b）。",
  "api.missingBaseUrl": "请在设置中填写 Base URL（或选择预设）。",
  "api.invalidBaseUrl":
    "Base URL 须为完整 http(s) 地址（如 https://api.deepseek.com）。请选择预设或补全 https:// 后保存。",
  "api.missingModel": "请在设置中填写模型名（须与服务商或本地服务一致）。",
  "api.missingKey":
    "请在设置中为当前端点填写 API Key，或改用 Ollama 等本地模型。",
  "api.memoryPack.title": "上下文记忆包",
  "api.memoryPack.lead":
    "聊天 → LLM 压缩 → SUMMARY.md + TASKS.md + DECISIONS.md → 下次提问注入。优先写入已绑定项目；否则保存在本笔记草稿中。",
  "api.memoryPack.inject": "主对话注入记忆包",
  "api.memoryPack.afterArchive": "归档后自动压缩",
  "api.memoryPack.dir": "记忆目录（相对项目根）",
  "api.memoryPack.dirPlaceholder": ".forknote/memory",
  "api.mem0.title": "长期记忆（mem0 云）",
  "api.mem0.lead":
    "可选，叠加在本地 MD 记忆包之上。默认关闭 —— 本地 SUMMARY/TASKS/DECISIONS 仍为本地优先。",
  "api.mem0.enable": "启用 mem0 云端记忆",
  "api.mem0.apiKey": "mem0 API Key",
  "api.mem0.userId": "mem0 用户 ID",
  "api.mem0.userIdPlaceholder": "留空则为本浏览器生成稳定 ID",
  "api.mem0.host": "mem0 主机（可选）",
  "api.mem0.privacy":
    "隐私：开启后，对话 / 归档 / 压缩包可能发送到 mem0 主机。本地优先请只用 MD 记忆包。",

  "data.title": "数据",
  "data.lead":
    "笔记与归档保存在本浏览器的 localStorage。清空前请先导出备份。",
  "data.notesTitle": "本机笔记",
  "data.notesCount": "localStorage 中有 {count} 条笔记。",
  "data.export": "导出笔记（JSON）",
  "data.import": "导入笔记（JSON）",
  "data.clear": "清空全部笔记",
  "data.clearConfirm": "清空本机全部笔记与归档？此操作不可撤销。",
  "data.exported": "已导出笔记为 JSON 文件。",
  "data.exportFailed": "导出失败。",
  "data.imported": "已导入 {count} 条笔记。",
  "data.importFailed": "导入失败。",
  "data.cleared": "已清空全部笔记。",
  "data.alsoStored": "本机还存储了",
  "data.key.settings": "API 设置",
  "data.key.project": "项目 / sidecar 偏好",
  "data.key.theme": "主题偏好",
  "data.key.locale": "界面语言",

  "projectSettings.title": "项目",
  "projectSettings.lead":
    "本地项目工具通过本机 sidecar 通信。运行 npm run sidecar，然后打开项目文件夹。",
  "projectSettings.sessionHint":
    "每个会话独立绑定项目；切换会话时会恢复该会话的项目（或未绑定）。",
  "projectSettings.sidecarUrl": "Sidecar URL",
  "projectSettings.connected": "已连接：",
  "projectSettings.none": "尚未连接项目。",
  "projectSettings.open": "打开项目…",
  "projectSettings.agentMaxRounds": "Agent 工具循环轮数（每条消息）",
  "projectSettings.agentMaxRoundsHint":
    "绑定项目后，单次发送最多允许的模型↔工具往返次数（1–64，默认 20）。任务完成会提前结束。",
  "projectSettings.agentRequireApproval": "执行工具前需批准计划",
  "projectSettings.agentRequireApprovalHint":
    "连接项目后，Agent 会先输出计划；你点击「批准并执行」后才会读写文件。",

  "agentPlan.aria": "Agent 计划审核",
  "agentPlan.kicker": "执行计划",
  "agentPlan.lead": "请审阅下方计划。批准后将对你的项目执行工具；取消将丢弃本轮对话。",
  "agentPlan.approve": "批准并执行",
  "agentPlan.cancel": "取消",
  "agentPlan.running": "执行中…",

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

  "sidebar.notesAria": "笔记",
  "sidebar.expand": "展开侧栏",
  "sidebar.collapse": "收起侧栏",
  "sidebar.lightMode": "浅色模式",
  "sidebar.darkMode": "深色模式",
  "sidebar.toLight": "切换到浅色模式",
  "sidebar.toDark": "切换到深色模式",
  "sidebar.newNote": "新建笔记",
  "sidebar.empty": "还没有笔记 —— 在右侧提问即可。",
  "sidebar.today": "今天",
  "sidebar.previous7": "近 7 天",
  "sidebar.rename": "重命名",
  "sidebar.delete": "删除",
  "sidebar.deleteConfirm": "删除这条笔记？此操作不可撤销。",
  "sidebar.renameAria": "重命名笔记",
  "sidebar.more": "更多",
  "sidebar.moreAria": "更多操作",
  "sidebar.renameHint": "{title}（双击重命名）",
  "sidebar.openProject": "打开项目",
  "sidebar.openProjectAria": "打开本地项目",
  "sidebar.project": "项目",
  "sidebar.projectConnected": "已连接项目",
  "sidebar.projectTitle": "项目：{path}",

  "main.tagline": "边读边澄清",
  "main.howTo": "使用方式",
  "main.step1": "提出开发或研究问题",
  "main.step2": "选中不懂的文字，立刻澄清",
  "main.step3": "逐点裁决 —— 拒绝错误，保留采纳",
  "main.untitled": "未命名",
  "main.notesKicker": "笔记",
  "main.forks": "{count} 个分支",
  "main.forksTitle": "从右侧图谱打开分支节点",
  "main.thinking": "思考中",
  "chat.copy": "复制",
  "chat.copied": "已复制",
  "chat.edit": "编辑",
  "chat.thinking": "思考中…",
  "chat.thought": "已思考",
  "chat.thoughtSeconds": "已思考（用时 {n} 秒）",
  "main.bannerText": "后续对话将以归档日志为上下文",
  "main.viewArchive": "查看归档",
  "main.gotIt": "知道了",
  "main.archiveComposerHint":
    "发送时使用归档日志作为上下文；屏幕上较早的气泡不会全部发给模型",
  "main.contextModeAria": "对话上下文模式",
  "main.switchContextAria": "切换上下文模式",
  "main.archiveContext": "归档上下文",
  "main.archiveContextTitle": "以归档日志作为后续对话底座",
  "main.fullThread": "完整线程",
  "main.fullThreadTitle": "使用完整对话线程",
  "main.archivesCount": "{count} 篇归档",
  "main.archivesViewTitle": "打开归档面板以查看或切换归档",
  "main.archive": "归档",
  "main.archiving": "归档中…",
  "main.archiveTitle": "将主线与分点裁决归纳为开发日志草稿",
  "main.compress": "压缩上下文",
  "main.compressing": "压缩中…",
  "main.compressTitle":
    "将本线程总结为 SUMMARY.md、TASKS.md、DECISIONS.md，供下次自动恢复",
  "main.compressDoneProject":
    "记忆已写入项目记忆目录，并保存在本笔记中",
  "main.compressDoneSession":
    "记忆已保存在本笔记中（绑定项目后还会写入 SUMMARY/TASKS/DECISIONS.md）",
  "main.placeholderEmpty": "问你正在研究的问题…",
  "main.placeholderProject":
    "询问项目，例如：列出当前目录、读取 package.json、或修改 README…",
  "main.placeholderContinue": "继续主线对话…",
  "main.placeholderContinueProject":
    "继续主线，或让助手列出/读取/修改项目文件…",
  "main.placeholderArchive": "在归档上下文上继续…",

  "composer.hintHero": "在回答中拖选文字即可澄清 · Enter 发送",
  "composer.hintCompact": "Enter 发送 · Shift+Enter 换行",
  "composer.newQuestion": "新问题",
  "composer.continue": "继续主线",
  "composer.stopAria": "停止生成",

  "archive.title": "开发日志归档",
  "archive.hintLoading": "正在归纳主线与分点裁决…",
  "archive.hintIdle": "可用归档继续，或切回完整线程",
  "archive.past": "历史归档",
  "archive.activeContext": " · 当前上下文",
  "archive.generatingAria": "正在生成归档",
  "archive.generating": "正在生成开发日志草稿…",
  "archive.empty": "暂无归档内容",
  "archive.deleteConfirm": "删除此归档？主线消息不受影响。",
  "archive.fullThread": "完整线程",
  "archive.continue": "用归档继续",

  "projectBar.open": "打开项目",
  "projectBar.clearLog": "清空日志",
  "projectBar.activityAria": "助手活动",
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
