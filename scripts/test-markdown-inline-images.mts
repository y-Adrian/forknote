/**
 * Smoke: Markdown image rendering prefs + prompt strings that steer models
 * toward `![alt](url)` instead of claiming chat cannot show images.
 * Usage: npx tsx scripts/test-markdown-inline-images.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHAT_SYSTEM,
  FALSE_NO_IMAGE_DISPLAY_RE,
  MARKDOWN_INLINE_IMAGE_RULE,
  PROJECT_CHAT_SYSTEM,
  buildConversationMessages,
  formatMarkdownImageHistoryCorrection,
} from "../src/lib/contextBuilder.ts";
import {
  forknoteUrlTransform,
  looksLikeImageUrl,
} from "../src/lib/markdownRemark.ts";
import {
  buildCodingToolsSystem,
  buildNetworkToolsSystem,
} from "../src/lib/agentTools.ts";
import { formatNetworkStatusSystem } from "../src/lib/networkAccess.ts";
import type { ThreadRoot } from "../src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mdSrc = readFileSync(join(root, "src/components/MarkdownBody.tsx"), "utf8");
const cssSrc = readFileSync(join(root, "src/index.css"), "utf8");

assert.ok(
  MARKDOWN_INLINE_IMAGE_RULE.includes("![简短描述](https://…)") ||
    MARKDOWN_INLINE_IMAGE_RULE.includes("`![简短描述](https://…)`") ||
    MARKDOWN_INLINE_IMAGE_RULE.includes("![简短描述](url)") ||
    MARKDOWN_INLINE_IMAGE_RULE.includes("`![简短描述](url)`"),
  "inline-image rule must teach Markdown image syntax",
);
assert.ok(
  MARKDOWN_INLINE_IMAGE_RULE.includes("ForkNote") &&
    MARKDOWN_INLINE_IMAGE_RULE.includes("会在对话气泡内直接显示图片"),
  "inline-image rule must state ForkNote renders Markdown images in the bubble",
);
assert.ok(
  MARKDOWN_INLINE_IMAGE_RULE.includes("无法显示图片") &&
    MARKDOWN_INLINE_IMAGE_RULE.includes("只能给/返回链接") &&
    MARKDOWN_INLINE_IMAGE_RULE.includes("这点已经多次说明"),
  "inline-image rule must forbid the exact false claims users still see",
);
assert.ok(
  MARKDOWN_INLINE_IMAGE_RULE.includes("二进制像素") ||
    MARKDOWN_INLINE_IMAGE_RULE.includes("token"),
  "inline-image rule must explain Markdown-not-pixels",
);
assert.ok(CHAT_SYSTEM.includes(MARKDOWN_INLINE_IMAGE_RULE));
assert.ok(PROJECT_CHAT_SYSTEM.includes(MARKDOWN_INLINE_IMAGE_RULE));

assert.ok(
  FALSE_NO_IMAGE_DISPLAY_RE.test(
    "因为我在聊天中无法显示图片，这点已经多次说明。",
  ),
  "regex must catch the screenshot phrasing",
);
assert.ok(
  FALSE_NO_IMAGE_DISPLAY_RE.test("I cannot display images in chat"),
  "regex must catch English cannot-display claim",
);
assert.equal(
  formatMarkdownImageHistoryCorrection([
    { role: "assistant", content: "这里是普通回答" },
  ]),
  null,
);
const histZh = formatMarkdownImageHistoryCorrection(
  [
    {
      role: "assistant",
      content: "其实更简单：因为我在聊天中无法显示图片，这点已经多次说明。",
    },
  ],
  "zh",
);
assert.ok(histZh && /本会话纠偏/.test(histZh) && /ForkNote/.test(histZh));

const thread: ThreadRoot = {
  id: "t1",
  messages: [
    {
      id: "u1",
      role: "user",
      content: "给我看一张图",
      children: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      content: "因为我在聊天中无法显示图片，这点已经多次说明。",
      children: [],
      createdAt: 2,
    },
    {
      id: "u2",
      role: "user",
      content: "那 Markdown 呢？",
      children: [],
      createdAt: 3,
    },
  ],
  createdAt: 0,
};
const api = buildConversationMessages(thread, {
  locale: "zh",
  contextAutoSummary: false,
});
assert.equal(api[0]?.role, "system");
assert.match(api[0]?.content ?? "", /本会话纠偏 · 图片/);

assert.ok(
  /urlTransform=\{forknoteUrlTransform\}/.test(mdSrc),
  "MarkdownBody must pass forknoteUrlTransform",
);
assert.ok(
  /referrerPolicy="no-referrer"/.test(mdSrc),
  "remote images should use no-referrer to reduce hotlink failures",
);
assert.ok(
  /img: MarkdownImage/.test(mdSrc) && /fn-md-image/.test(mdSrc),
  "stable MarkdownImage component required",
);

assert.ok(
  /\.fn-md-image-frame img\s*\{[^}]*max-width:\s*100%/s.test(cssSrc),
  "markdown images must have max-width for chat layout",
);
assert.ok(
  /\.fn-markdown-mount \.fn-md-image/.test(cssSrc) ||
    /\.markdown-body \.fn-md-image/.test(cssSrc),
  "image chrome must apply outside .answer-body (share viewer)",
);

assert.equal(
  forknoteUrlTransform("https://cdn.example.com/a.png"),
  "https://cdn.example.com/a.png",
);
assert.equal(
  forknoteUrlTransform("http://cdn.example.com/a.jpg"),
  "http://cdn.example.com/a.jpg",
);
assert.equal(forknoteUrlTransform("javascript:alert(1)"), "");
assert.ok(
  forknoteUrlTransform("data:image/png;base64,abc").startsWith("data:image/png"),
  "safe data:image/* must pass urlTransform",
);
assert.equal(forknoteUrlTransform("data:text/html;base64,xx"), "");

assert.equal(looksLikeImageUrl("https://x.test/photo.webp"), true);
assert.equal(looksLikeImageUrl("https://x.test/page.html"), false);
assert.equal(looksLikeImageUrl("data:image/gif;base64,xx"), true);

const netZh = formatNetworkStatusSystem(
  {
    wanted: true,
    browserOnline: true,
    probedOnline: true,
    toolsAllowed: true,
    reason: "ok",
  },
  "zh",
);
assert.match(netZh, /!\[描述\]\(url\)/);
assert.match(netZh, /无法显示图片/);

const netEn = formatNetworkStatusSystem(
  {
    wanted: true,
    browserOnline: true,
    probedOnline: true,
    toolsAllowed: true,
    reason: "ok",
  },
  "en",
);
assert.match(netEn, /!\[description\]\(url\)/);
assert.match(netEn, /cannot show images/i);

const toolsZh = buildNetworkToolsSystem("zh");
assert.match(toolsZh, /!\[描述\]\(url\)/);
const toolsEn = buildNetworkToolsSystem("en");
assert.match(toolsEn, /!\[description\]\(url\)/);

const coding = buildCodingToolsSystem("/tmp/proj");
assert.match(coding, /!\[描述\]\(https:\/\//);
assert.match(coding, /无法显示图片/);

console.log("test-markdown-inline-images: ok");
