/**
 * Smoke: point clarify anchors, adopt-into-main notes, archive source richness.
 */
import assert from "node:assert/strict";
import {
  adoptedBodyNeedsCollapse,
  applyAdoptNoteToContent,
  clearBranchAdoptFields,
  flattenAdoptedForPlaintext,
  parseAdoptedInner,
  removeAdoptNoteFromContent,
  resolveBranchAdoptSource,
  splitAdoptedSegments,
  stripAdoptedNote,
} from "../src/lib/adoptBranch.ts";
import { buildArchiveSource } from "../src/lib/archive.ts";
import { annotateContentWithVerdicts } from "../src/lib/points.ts";
import { buildSharePayload, sharePayloadToHtml, sharePayloadToMarkdown } from "../src/lib/sessionShare.ts";
import { anchorForAnswerPoint } from "../src/lib/points.ts";
import type { BranchNode, FeedbackEvent, ThreadRoot } from "../src/types.ts";

const content = [
  "前言。",
  "",
  "【1】第一步：打开项目。",
  "",
  "【2】第二步：绑定 sidecar。",
].join("\n");

const a1 = anchorForAnswerPoint(content, 1);
assert.ok(a1);
assert.equal(a1!.pointIndex, 1);
assert.match(a1!.quotedText, /第一步/);
assert.ok(a1!.startOffset < a1!.endOffset);

const a2 = anchorForAnswerPoint(content, 2);
assert.ok(a2);
assert.match(a2!.quotedText, /sidecar/);

const branch: BranchNode = {
  id: "b1",
  parentId: "m1",
  anchor: a1!,
  userQuestion: "为什么要打开项目？",
  assistantMessage: "因为需要本机读写权限。",
  children: [],
  createdAt: 1,
};

const adopted = applyAdoptNoteToContent(
  content,
  branch,
  "因为需要本机读写权限。",
  "zh",
);
assert.match(adopted, /forknote-adopted:b1/);
assert.match(adopted, /澄清结论/);
assert.match(adopted, /第一步/);
assert.ok(adopted.indexOf("第一步") < adopted.indexOf("澄清结论"));
assert.equal(adopted.includes("<!-- forknote-adopted:b1 -->"), true);

const segs = splitAdoptedSegments(adopted);
assert.equal(segs.some((s) => s.type === "adopted"), true);
const note = segs.find((s) => s.type === "adopted");
assert.ok(note && note.type === "adopted");
assert.equal(note.branchId, "b1");
assert.match(note.label, /澄清结论/);
assert.match(note.body, /本机读写权限/);
assert.equal(
  segs
    .filter((s) => s.type === "markdown")
    .some((s) => s.type === "markdown" && s.text.includes("forknote-adopted")),
  false,
  "HTML comment markers must not leak into markdown segments",
);

const legacy = splitAdoptedSegments(
  [
    "kgdb is useful.",
    "<!-- forknote-adopted:b9b67756-9412-49a0-adb1-9af37da3421a -->",
    "> **Clarification：** " + "walkthrough ".repeat(40),
    "<!-- /forknote-adopted:b9b67756-9412-49a0-adb1-9af37da3421a -->",
    "Next paragraph.",
  ].join("\n"),
);
assert.equal(legacy.length, 3);
assert.equal(legacy[0]?.type, "markdown");
assert.equal(legacy[1]?.type, "adopted");
assert.equal(legacy[2]?.type, "markdown");
if (legacy[1]?.type === "adopted") {
  assert.equal(legacy[1].branchId, "b9b67756-9412-49a0-adb1-9af37da3421a");
  assert.equal(legacy[1].label, "Clarification");
  assert.equal(adoptedBodyNeedsCollapse(legacy[1].body), true);
}
assert.equal(parseAdoptedInner("> **澄清结论：** 短句").label, "澄清结论");
assert.equal(parseAdoptedInner("> **澄清结论：** 短句").body, "短句");
assert.equal(parseAdoptedInner("**Clarification:** hello").label, "Clarification");

const orphan = splitAdoptedSegments(
  "Hello\n<!-- forknote-adopted:orphan -->\nWorld",
);
assert.equal(orphan.length, 1);
assert.equal(orphan[0]?.type, "markdown");
if (orphan[0]?.type === "markdown") {
  assert.equal(orphan[0].text.includes("forknote-adopted"), false);
}

const flat = flattenAdoptedForPlaintext(adopted);
assert.equal(flat.includes("forknote-adopted"), false);
assert.match(flat, /澄清结论/);
assert.match(flat, /本机读写权限/);
assert.match(flat, /第一步/);

const md = sharePayloadToMarkdown(buildSharePayload("Note", [{ role: "assistant", content: adopted }]));
assert.equal(md.includes("forknote-adopted"), false);
const html = sharePayloadToHtml(
  buildSharePayload("Note", [{ role: "assistant", content: adopted }]),
  { roleUser: "User", roleAssistant: "Assistant" },
);
assert.equal(html.includes("forknote-adopted"), false);

const annotated = annotateContentWithVerdicts(flattenAdoptedForPlaintext(adopted), undefined);
assert.equal(annotated.includes("forknote-adopted"), false);

const again = applyAdoptNoteToContent(
  adopted,
  { ...branch, adoptedAt: 2 },
  "更新后的结论。",
  "zh",
);
assert.equal(
  (again.match(/<!-- forknote-adopted:b1 -->/g) ?? []).length,
  1,
  "re-adopt should replace prior note",
);
assert.match(again, /更新后的结论/);

assert.equal(stripAdoptedNote(again, "b1").includes("forknote-adopted"), false);
assert.equal(
  removeAdoptNoteFromContent(again, "b1").includes("forknote-adopted"),
  false,
);

const adoptedBranch: BranchNode = {
  ...branch,
  adoptedAt: 9,
  adoptedSummary: "因为需要本机读写权限。",
};
const clearedTree = clearBranchAdoptFields([adoptedBranch], "b1");
assert.equal(clearedTree[0]!.adoptedAt, undefined);
assert.equal(clearedTree[0]!.adoptedSummary, undefined);
assert.equal(clearedTree[0]!.id, "b1");

assert.equal(
  resolveBranchAdoptSource({
    ...branch,
    replies: [
      {
        userQuestion: "再问",
        assistantMessage: "最新回复",
        createdAt: 2,
      },
    ],
  }),
  "最新回复",
);

const thread: ThreadRoot = {
  id: "t",
  createdAt: 1,
  messages: [
    {
      id: "u1",
      role: "user",
      content: "怎么配置？",
      children: [],
      createdAt: 1,
    },
    {
      id: "m1",
      role: "assistant",
      content: adopted,
      children: [
        {
          ...branch,
          adoptedAt: 3,
          adoptedSummary: "因为需要本机读写权限。",
        },
        {
          id: "b2",
          parentId: "m1",
          anchor: a2!,
          userQuestion: "sidecar 是什么",
          assistantMessage: "本机代理。",
          children: [],
          createdAt: 2,
        },
      ],
      pointVerdicts: { 1: "accept", 2: "unsure" },
      createdAt: 2,
    },
  ],
};

const events: FeedbackEvent[] = [
  {
    id: "e1",
    targetId: "m1",
    pointIndex: 1,
    signal: "accept",
    explicit: true,
    weight: 1,
    source: "explicit",
    at: 1,
  },
];

const source = buildArchiveSource(thread, { feedbackLog: events });
assert.match(source, /已收进主线/);
assert.match(source, /未采纳进主线/);
assert.match(source, /反馈事件摘要/);
assert.match(source, /passive_copy|explicit/);
assert.match(source, /因为需要本机读写权限/);
assert.equal(source.includes("forknote-adopted"), false);

console.log("smoke-clarify-integrate-archive: ok");
