# ForkNote 架构说明

## 1. 运行形态

ForkNote 有两种外壳，但复用同一套 React 代码：

```text
Browser / Electron BrowserWindow
        |
        v
React + Zustand + localStorage
        |
        +---- OpenAI-compatible API
        |
        +---- optional Jev System One API (Reflect decisions only)
        |
        +---- /sidecar proxy ----> local sidecar ----> files / git / terminal
```

- Web 开发模式由 Vite 提供页面，并代理 `/openai` 和 `/sidecar`。
- Electron 生产模式启动回环 UI server，提供 `dist/` 并维持相同代理路径。
- sidecar 仅监听回环地址；它不是通用远程服务。

## 2. 前端分层

### 组件层

- `App.tsx`：外壳、响应式侧栏、全局弹窗和分享只读模式。
- `MainPanel.tsx`：当前会话页面编排、输入、归档视图切换。
- `MainChatMessageList.tsx`：消息、生成状态、操作按钮和归档正文。
- `SessionSidebar.tsx`：会话生命周期和移动端抽屉。
- `BranchFloatLayer.tsx`：澄清浮层栈；具体内容由 `FloatingBranchDetail.tsx` 渲染。
- `AccessibleModal.tsx`：统一 portal、焦点陷阱、Escape 和层级行为。

### 状态层

`useAppStore.ts` 是业务编排中心。可持久化状态保存在 Zustand，会话级运行任务则使用模块级注册表：

- `mainTurnsBySession`：主回答及其取消控制器。
- `branchAbortBySession`：每个会话当前澄清任务。
- `archiveJobs` / `compressJobs`：归档和压缩任务的 ownership。
- `pendingAgentContinuations`：用户批准计划后恢复执行的闭包。

运行任务不放入 Zustand，避免不可序列化控制器触发渲染和持久化。UI 只保存可展示的投影，例如 `loadingMainBySession`。

### 领域与基础设施层

- `src/lib/thread.ts`：不可变更新主线和分支树。
- `src/lib/contextBuilder.ts`：构建模型消息。
- `src/lib/agentTurn.ts`：意图判断、记忆组装、模型流、工具循环和批准暂停。
- `src/lib/agentAnswer.ts`：普通回答的流式显示与思考计时。
- `src/lib/agentPlanProgress.ts`：批准计划的逐步骤执行证据与预期结果匹配；无法解析的步骤保持待确认。
- `src/lib/projectRules.ts`：读取仓库提交的 AGENTS.md / CLAUDE.md / .cursorrules / copilot-instructions，按字符预算作为项目规则注入每个项目回合。
- `src/lib/agentPermissions.ts`：设置中的终端命令允许/禁止规则（前缀匹配、串联命令逐段判断、禁止优先）；允许的命令跳过批准卡片，禁止的命令不会执行。
- `src/lib/agentBudget.ts`：同一条用户消息跨批准/分批共享的总执行轮数，以及相同参数失败调用的限制。
- `src/lib/modelMetrics.ts`：供应商真实用量解码、按阶段会话累计和持久化校验。未返回用量的请求记为未知。
- `src/lib/abortable.ts`：在传输层忽略取消时仍能及时结束等待；Reflect 的独立超时为 8 秒。
- `src/lib/openai.ts`：兼容 API 和流式解析。
- `src/lib/jev.ts`：Jev System One 请求、严格响应解码和超时回退。
- `src/lib/llmReflect.ts`：工具批次后的规则、Jev 与聊天模型三级 Reflect 决策。
- `src/lib/storage.ts`：localStorage、导入校验和旧数据兼容。
- `src/lib/sidecar.ts`：sidecar HTTP 客户端。

## 3. 一次请求的数据流

```text
Composer
  -> askMain / askBranch / continueBranch
  -> 创建空的流式写入目标
  -> runAgentTurn
       -> 判断 plain chat / network / project tools
       -> buildAgentMemoryAddendum
       -> buildConversationMessages
       -> streamChat 或 agent tool loop
       -> 工具批次完成后 rule -> Jev -> LLM Reflect（按可用性回退）
       -> patchContent 回写发起会话
  -> 完成后刷新持久化
  -> 澄清任务额外同步 clarificationMemory
```

`runAgentTurn` 不直接依赖具体 UI 节点，只通过 `patchContent`、`isOwned` 和事件回调工作，因此主线与澄清可共享同一执行逻辑。

Jev 不参与回答生成，也不能走 `/chat/completions`。官方 TypeSafe 使用 `/v1/systemone`，`jevtypesafeai.com` 托管代理使用 `/api/v1/decide`；设置中的提供方负责选择正确端点。启用后，它只读取有界的工具观察摘要和预期结果，并只能返回当前 `AgentLoopController` 允许的 Reflect 选项。响应选项越界、置信度不足、8 秒超时或请求失败时，继续使用现有 LLM Reflect；后者仍失败时使用本地规则。

会话 `modelMetrics` 累计已完成请求的实际输入/输出 tokens、未知用量请求数、耗时和阶段数据；主回答、规划、工具执行、Reflect、归档与压缩均归属发起会话。失败或中断且没有返回最终用量的请求目前不计入完成请求统计，不能将界面总数当作账单。工具栏的 `+?` 表示存在未知用量；耗时是各请求累计，不是整条消息的墙钟时间。旧会话没有该字段时保持兼容。

## 4. 会话与澄清模型

`ThreadRoot.messages` 是主线。每条助手消息可以拥有 `children: BranchNode[]`；分支还能递归拥有子分支。`BranchReply[]` 表示同一个浮层里的连续追问，它不会创建新的嵌套节点。

```text
ChatSession
  `- ThreadRoot
      `- ChatMessage (assistant)
          `- BranchNode
              |- BranchReply[]
              `- children: BranchNode[]
```

“采纳进主线”只在主回答加入非破坏性说明并记录 `adoptedAt`/`adoptedSummary`；原始分支仍保留，便于撤销、归档和审计。

## 5. 上下文组装顺序

模型输入大致按以下顺序构建：

1. 基础系统提示和语言约束。
2. 会话记忆、用户偏好、项目记忆和附件。
3. 当前 live 窗口，或 archive 底座加增量消息。
4. Clarify 专用定位消息，仅澄清请求存在。
5. “最新消息优先”保护提示和网络状态。

回答结构由 `currentTurnQuery` 决定。Clarify 附加消息不再重复结构提示，防止两套规则冲突。

## 6. 归档与压缩

归档和上下文压缩解决不同问题：

- 归档是用户可见的 Markdown 开发日志，由 `archive.ts` 生成材料和提示。
- 压缩记忆是模型恢复上下文的 SUMMARY/TASKS/DECISIONS，由 `contextMemory.ts` 管理。
- archive 模式只发送归档底座及其后的新增消息。
- 增量归档必须包含归档后新增的澄清和分支续问，同时排除时间点之前已覆盖的内容。
- 所有材料都有字符预算，避免工具输出或长代码占满模型上下文。

## 7. Sidecar 与桌面壳

`sidecar/index.js` 维护当前绑定项目，并提供文件、搜索、Git、Office、终端和代码分析路由。路由处理遵守：认证、请求体限制、`expectedRoot` 校验、路径收敛、取消传播、输出截断。

`electron/main.cjs` 负责：

- 启动或复用健康 sidecar。
- 生产模式启动本地 UI server。
- 创建 BrowserWindow 并限制导航、DevTools 和外部链接。
- 应用退出时有界关闭子进程。

可跨环境复用的安全判断放在 `shared/`，避免 Electron、sidecar 和测试各自实现一份。

## 8. 关键不变量

- 异步结果只能写回发起它的会话和仍被 ownership 注册表拥有的任务。
- 原始线程是事实来源；摘要、归档和共享澄清都是派生数据。
- 外部导入和 sidecar 请求都视为不可信输入。
- 项目工具不能绕过 `expectedRoot`；项目外终端访问必须显式批准。
- 停止或失败不能留下空分支、卡住的 loading 状态或未刷新的最终内容。
- 主会话和 Clarify 共用模型执行能力，但 Clarify 的写入目标和局部定位必须保持独立。
- Jev 是可选增强层；关闭、无 Key 或服务不可用时不能改变原有 Agent 行为。
