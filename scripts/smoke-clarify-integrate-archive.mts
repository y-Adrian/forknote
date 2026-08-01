/**
 * Smoke: point clarify anchors, adopt-into-main notes, archive source richness.
 */
import assert from "node:assert/strict";
import {
  applyAdoptNoteToContent,
  resolveBranchAdoptSource,
  stripAdoptedNote,
} from "../src/lib/adoptBranch.ts";
import { buildArchiveSource } from "../src/lib/archive.ts";
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

console.log("smoke-clarify-integrate-archive: ok");
