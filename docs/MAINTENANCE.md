# ForkNote 维护手册

本文面向需要继续开发、排障和发布 ForkNote 的维护者。产品使用说明仍以根目录
[`README.md`](../README.md) 为准；系统边界见 [`ARCHITECTURE.md`](ARCHITECTURE.md)，测试清单见
[`TESTING.md`](TESTING.md)。

## 1. 开发环境

- Node.js 18 或更高版本；日常开发建议使用当前 LTS。
- 安装依赖：`npm install`。
- 完整开发环境：`npm run dev`，同时启动 Vite 和 sidecar。
- Web UI：`http://127.0.0.1:5173`。
- 生产构建：`npm run build`，包含 TypeScript 检查和 Vite 打包。
- Electron 调试：先运行 `npm run dev`，再在另一终端运行 `npm run electron:dev`。

首次启动后在“系统设置 → API”配置兼容 OpenAI Chat Completions 的地址、模型和密钥。
本地项目能力依赖 sidecar；只启动静态页面时，聊天仍可工作，但文件和终端工具不可用。

## 2. 推荐阅读顺序

1. `src/types.ts`：持久化数据模型，是兼容性边界。
2. `src/store/useAppStore.ts`：会话、流式生成、澄清、归档和项目绑定的编排层。
3. `src/lib/agentTurn.ts`：主会话与澄清共用的模型执行器。
4. `src/lib/contextBuilder.ts`：发送给模型的对话和 Clarify 附加上下文。
5. `src/lib/contextMemory.ts`、`src/lib/clarificationMemory.ts`、`src/lib/archive.ts`：三种不同用途的记忆。
6. `src/lib/agentTools.ts`、`src/lib/sidecar.ts`、`sidecar/index.js`：工具定义、客户端和本机执行端。
7. `src/components/MainPanel.tsx`、`MainChatMessageList.tsx`、`BranchFloatLayer.tsx`：主要交互界面。

## 3. 常见改动放在哪里

| 需求 | 主要位置 | 同步检查 |
|---|---|---|
| 会话或分支字段 | `src/types.ts` | `storage.ts` 导入校验、分享/导出、迁移兼容 |
| 主会话发送逻辑 | `useAppStore.ts` 的 `askMain` | 停止、切换会话、计划批准、持久化 |
| 澄清逻辑 | `askBranch`、`continueBranch` | 共享记忆、归档、浮层恢复、并发队列 |
| 模型提示词 | `contextBuilder.ts`、`agentTools.ts` | 中英文、主线/澄清一致性、结构提示是否重复 |
| 归档格式 | `archive.ts` | 首次归档、增量归档、大小上限、压缩复用 |
| 本地工具 | `agentTools.ts` + `sidecar.ts` + `sidecar/index.js` | schema、客户端、路由三处必须一致 |
| 设置项 | `types.ts`、`settings.ts`、`SettingsPanel.tsx` | 默认值、持久化、脏状态比较、中英文文案 |
| Electron | `electron/`、`shared/`、`package.json` | 开发/生产路径、CSP、打包文件、三平台 CI |

## 4. 数据与兼容性规则

- 会话和设置保存在浏览器 `localStorage`。改持久化结构时，新字段优先设为可选并提供默认行为。
- 导入入口会把外部 JSON 当作不可信数据；新增字段必须在 `src/lib/storage.ts` 中校验，不能只改类型。
- `ChatSession.thread` 是主线和分支树的事实来源；`clarificationMemory` 是可注入模型的紧凑索引，不应反向覆盖原始分支。
- 流式内容使用延迟持久化降低写放大；完成、停止、报错、切换会话前必须刷新最终状态。
- 异步任务必须固定到发起时的 `sessionId`，不得在完成时重新读取“当前会话”作为写入目标。

## 5. 主线、澄清和记忆

主会话和 Clarify 最终都进入 `runAgentTurn`。差异只在写入目标和 Clarify 的附加消息：

- `askMain` 写入 `ChatMessage`。
- `askBranch` 创建 `BranchNode`；`continueBranch` 追加 `BranchReply`。
- 成功完成的澄清由 `syncSessionClarificationMemory` 压成会话级摘要。
- `buildAgentMemoryAddendum` 把共享澄清作为 `working` 层注入，因此下一轮主线和其他分支都能使用。
- 选中片段只用于限定当前子问题，不代表开启独立会话。
- `currentTurnQuery` 必须是当前实际问题，避免主线上一问的回答结构污染澄清回答。

记忆层不要混用：

- `clarificationMemory`：同一会话内的局部补充知识，最多保留最近条目。
- `contextMemory`：长对话压缩后的 SUMMARY/TASKS/DECISIONS。
- `sessionMemory` 和偏好模型：用户显式记录、反馈策略和跨轮偏好。
- `ArchiveSnapshot`：用户可见的开发日志，也是 archive 模式的上下文底座。

导出同样分层：Settings → Data 的 JSON 是可恢复备份；会话分享窗口的 Markdown/HTML 是默认排除内部推理的可读笔记。不要把两者合并成一个含糊的“导出”按钮。

## 6. Sidecar 安全约束

sidecar 能读写文件、运行命令，修改时应保留以下两层边界：

1. 每个请求都要携带 `X-ForkNote-Sidecar-Token`；令牌由 `shared/sidecarAuth.cjs` 管理。
2. 文件、Git 和终端路由必须带 `expectedRoot`，并与当前绑定项目的真实路径匹配。

另外，终端命令还有项目外访问批准、危险命令拒绝列表、超时、输出上限和请求取消。新增路由时应复用现有校验，不要直接对用户输入调用文件系统或 shell。

## 7. 提交前检查

1. 运行与改动最接近的测试脚本。
2. 运行 `npm run build`。
3. 运行 `git diff --check`。
4. 检查 `git status --short`，确认没有构建产物或临时目录被纳入提交。
5. 行为改动应增加回归测试；测试脚本放在 `scripts/test-*.mts` 或 `scripts/test-*.mjs`。

项目当前没有统一的 `npm test` 聚合命令，完整本地回归方式见 [`TESTING.md`](TESTING.md)。

## 8. 发布与回滚

- 合并目标分支为 `leading`。
- 发布前更新版本并运行生产构建及桌面管道检查。
- 推送 `v*` tag 会触发 macOS、Windows、Linux 发布工作流。
- 当前节点可用 Git tag 记录稳定基线；回滚时优先新建修复提交，不要重写共享分支历史。
- macOS 签名和公证依赖 README 中列出的 GitHub Secrets；缺少凭据时产物为未签名版本。

## 9. 排障入口

- 页面白屏：先看浏览器控制台，再运行 `npm run build` 检查类型和懒加载模块。
- sidecar 不可达：检查 `8787` 端口、认证令牌和 `/health`，桌面模式还要检查 UI 代理。
- 会话内容串线：重点检查异步回调捕获的 `sessionId` 和 ownership 判断。
- 澄清记忆缺失：检查分支是否真正完成、是否调用同步函数、导入数据是否保留该字段。
- 归档重复或丢内容：检查 `throughMessageId`、归档时间戳以及增量澄清的 `createdAt`。
- UI 被浮层遮挡：业务弹窗应使用 `AccessibleModal`，不要自行创建低层级 backdrop。
