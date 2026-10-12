# ForkNote 测试指南

## 1. 最小检查

Agent 核心回归入口为 `npm run test:agent`，CI 的 Build 作业也会执行它。覆盖计划完成判定、跨审批预算、诊断恢复、权限、会话隔离、真实用量解析、Reflect 超时和工作记忆。

小改动至少执行：

```bash
npm run build
git diff --check
```

`npm run build` 会先执行 `tsc --noEmit`，再创建 Vite 生产包。Mermaid 等依赖可能触发大分包警告；警告不等于构建失败，但体积明显增长时应检查懒加载边界。

## 2. 测试脚本约定

- `scripts/test-*.mts`：前端逻辑、状态和静态接线探针，使用 `npx tsx` 运行。
- `scripts/test-*.mjs`：sidecar、Electron、共享模块和打包探针，使用 `node` 运行。
- `scripts/smoke-*.mts`：跨模块业务冒烟。
- 真实 API 代理测试需要可用的服务和凭据，不应在无配置环境中当作普通离线测试运行。

示例：

```bash
npx tsx scripts/test-clarification-shared-memory.mts
npx tsx scripts/test-incremental-archive.mts
node scripts/test-fs-agent-tools.mjs
```

## 3. 按改动选择测试

| 改动区域 | 建议测试 |
|---|---|
| 澄清与共享记忆 | `test-clarification-shared-memory.mts`、`test-clarify-branch-rollback.mts`、`smoke-clarify-during-main.mts` |
| 归档 | `test-archive-source-sizing.mts`、`test-incremental-archive.mts`、`test-archive-mode-rollback.mts` |
| 会话并发 | `test-session-summary-jobs.mts`、`test-session-summary-store.mts`、`test-agent-activity-by-session.mts` |
| 提示和回答结构 | `test-answer-structure-mode.mts`、`smoke-agent-goal-focus.mts`、`smoke-answer-only-intent.mts` |
| Jev / Agent Reflect | `test-jev-reflect.mts`、相关 `test-agent-*` 脚本；真实 API 仅在有专用测试 Key 时运行 |
| 流式与持久化 | `test-stream-storage-throttle.mts`、`test-stream-render-crash-guard.mts`、`test-localstorage-quota.mts` |
| 弹窗与可访问性 | `test-accessible-modal.mts`、`test-modal-above-floats.mts`、`test-accessible-control-labels.mts` |
| Sidecar 文件工具 | `node scripts/test-fs-agent-tools.mjs` |
| 代码分析工具 | `test-dep-graph.mjs`、`test-semantic-search.mjs`、`test-symbol-ast.mjs` |
| 终端工具 | 启动 sidecar 后运行 `node scripts/test-run-terminal.mjs` |
| Agent 错误恢复 | `test-agent-loop.mts`（混合权限错误熔断）、`test-agent-diagnostics-recovery.mts`（模拟模型与 sidecar，写入→诊断失败→修复→复检通过） |
| Electron 与打包 | `test-electron-startup-guard.mjs`、`npm run test:desktop-build-pipelines`、`test-packaged-ui-csp.mjs` |

## 4. 完整离线回归

`npm run test:agent` 运行核心子集；完整离线回归仍可在 macOS/Linux 的 zsh/bash 中运行：

```bash
for f in scripts/test-*.mts; do
  npx tsx "$f" || exit 1
done

for f in scripts/smoke-*.mts; do
  case "$f" in
    *openai-proxy*) continue ;;
  esac
  npx tsx "$f" || exit 1
done
```

`test-*.mjs` 的前置条件不完全一致，不建议盲目一条命令全跑。多数会自行启动临时 sidecar；`test-run-terminal.mjs` 需要先启动 sidecar，例如：

```bash
npm run sidecar
node scripts/test-run-terminal.mjs
```

## 5. 人工验证清单

涉及交互时，自动测试之后至少检查：

1. 新建会话、切换会话、停止生成后内容不会串线。
2. 选中助手文本能打开 Clarify，连续追问仍在同一浮层。
3. 澄清完成后回到主线追问，模型能使用已补充的信息。
4. 中英文切换确认框可见，确认后界面和模型语言一致。
5. 窄屏下会话抽屉、输入框工具和设置入口可达。
6. 打开项目后读取、修改和终端计划批准路径正常；断开项目后工具不可用。
7. 归档后可在归档正文和演进记录间切换，后续对话仍以选中归档为底座。
8. Jev 默认关闭时不产生请求；开启但无 Key、低置信度或服务失败时仍能完成原有 Reflect 回退。

## 6. 新增测试原则

- 优先测试可观察行为和稳定接口，不要只搜索某段代码必须位于某个旧组件。
- 静态接线测试应跟随职责边界，例如业务组件验证使用 `AccessibleModal`，portal 细节由公共组件测试负责。
- sidecar 集成测试必须发送认证令牌和 `expectedRoot`。
- 测试临时目录应在结束时清理；启动的子进程必须在 `finally` 中终止。
- macOS 上比较 `/tmp` 路径时，应在目录创建后调用 `realpath`，以处理 `/private/tmp` 映射。
- 每个已修复缺陷至少保留一个能在修复前失败的断言。
