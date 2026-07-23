# ForkNote

面向开发与排障的「边读边澄清、再归档成日志」的工作台。

**Clarify as you read** — 针对 AI 长回答的选中澄清工具。

拖选一段文字 → **Clarify this** → 浮动澄清面板与 Fork 分支回答；对分点打 **Accept / Reject / Doubt**；右侧 **Branch rail** 导航；可选绑定本机目录做读写。

- 纯 Web（Vite + React）
- OpenAI 兼容 API（云端或本机 Ollama / LM Studio 等）
- **多笔记**：左侧列表新建 / 重命名 / 切换 / 删除
- 无登录；笔记与设置保存在浏览器 `localStorage`

---

## 安装与运行

```bash
npm install
cp .env.example .env.local   # 可选，也可只在页面 API Settings 里填
npm run dev                  # 前端，通常 http://localhost:5173
```

若要用 **本地项目读写**（agent 工具），再开一个终端：

```bash
npm run sidecar              # http://127.0.0.1:8787；开发时经 Vite 代理 /sidecar
```

| 脚本 | 作用 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run sidecar` | 本机 FS sidecar（**项目工具必需**） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run preview` | 预览构建产物 |

---

## API 设置

右上角打开 **API Settings**（或侧栏设置入口）。

1. 点预设芯片（如 **Ollama**、**LM Studio**、**DeepSeek**），或手动填 **Base URL** / **Model** / **API Key**
2. 本机服务一般 **API Key 留空**；云端填控制台密钥
3. 开发时勾选 **Use local proxy in development**（推荐）：请求走 `/openai/...`，由 Vite 按当前 Base URL 转发，减轻 CORS
4. **Save** 保存（亦写入 `localStorage`）

| 常见本机 | Base URL | Model 示例 |
|----------|----------|------------|
| Ollama | `http://127.0.0.1:11434` | `llama3.2`、`qwen2.5:7b`（须与 `ollama list` 一致） |
| LM Studio | `http://127.0.0.1:1234` | Local Server 里显示的名称 |

自测 Ollama：

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

curl 成功而页面失败时，核对 Model 名、端口、是否启用代理。

---

## 主对话

1. 在输入框提问 → **Send**（`Enter` 发送，`Shift+Enter` 换行）
2. 生成中按钮变为 **Stop**：中止流式输出
3. **Stop** 后，刚才发出的提示会 **恢复到输入框**，便于改写再发
4. 有对话后，底部为紧凑续写框；空笔记页有「Clarify as you read」引导

---

## 选中澄清与 Fork 面板

1. 在助手回答中 **拖选** 一段文字
2. 出现工具条 → 点 **Clarify this**
3. 弹出 **Clarify selection**：简短说明哪里不清 → **Submit**
4. 澄清回答以浮动 **Fork** 面板挂在选区附近；可继续在分支里选中澄清（嵌套）
5. 关闭面板或点 Branch rail / 评论轨上的节点，可重新打开对应分支

提示：澄清宜短，少引入新概念。

---

## 分点裁决（Point verdicts）

当回答含至少两个 `【1】【2】…` 分点时，每点旁可裁决：

| 操作 | UI | 含义（进入后续上下文） |
|------|-----|------------------------|
| 默认 / **Accept** | 未点或采纳 | 视为已采纳，正文保留 |
| **Reject** | 拒绝 | 后续对话省略该点正文 |
| **Doubt** | 存疑 | 保留正文；可填 **Doubt note** |

未标记的点按 **采纳** 处理。裁决会影响后续主对话 / 澄清的上下文组装。

---

## Branch rail

主回答右侧为 git-graph 风格的 **Branch rail**：

- 主干对齐各条助手消息；Fork 节点按深度向右展开
- 点击节点可聚焦 / 打开对应浮动分支面板
- 与左侧评论轨、浮动层配合，用于在长回答里跳转澄清分支

---

## 打开项目与 Agent 工具

主对话可绑定本机目录，模型通过工具 **列出 / 读取 / 写入 / 搜索** 文件（路径限制在项目根内）。

### 步骤

1. 先运行 `npm run sidecar`，再 `npm run dev`
2. 侧栏或输入区上方点 **Open project** → 对话框 **Local project**
3. **Sidecar URL** 默认 `/sidecar`（经 Vite 代理）；填项目 **绝对路径** → **Connect**
4. 路径记在 `localStorage`；下次若 sidecar 已开可自动重连
5. **Disconnect** 解除绑定

### 工具能力

| 工具 | 作用 |
|------|------|
| `list_dir` | 列目录 |
| `read_file` | 读文本（有大小上限） |
| `write_file` | 覆盖写入整文件 |
| `search_files` | 简单全文搜索 |

一轮内最多约 **8** 轮工具往返。活动日志与 **Changes this turn** 显示本轮读/写过的路径；可 **Clear log**。

示例提问：

> 读取 package.json，并在 README.md 顶部加一行说明本项目用途

### Sidecar HTTP（`127.0.0.1:8787`）

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/project/open` | `{ "path": "/abs/project" }` |
| `GET` | `/project` | 当前根目录 |
| `POST` | `/project/close` | 解除绑定 |
| `GET` | `/fs/list?path=` | 列目录 |
| `GET` | `/fs/read?path=` | 读文件 |
| `POST` | `/fs/write` | `{ "path", "content" }` |
| `POST` | `/fs/mkdir` | `{ "path" }` |
| `POST` | `/fs/search` | `{ "query", "path?" }` |
| `GET` | `/health` | 探活 |

安全：拒绝 `..` 与绝对路径逃逸；FS 操作必须落在绑定根下。

---

## 主题与笔记

- **Light / Dark**：侧栏主题切换；偏好键 `forknote-theme`
- **New note**：新建空笔记
- **重命名**：双击笔记标题，或菜单里重命名；手动命名后标题不再被首条消息自动覆盖
- **删除**：笔记菜单删除（数据在本地，无云端回收站）
- 笔记按日期分组显示在左侧

---

## 环境变量（`.env.local`）

从 `.env.example` 复制即可。均为可选；页面 **API Settings** 可覆盖。

| 变量 | 说明 |
|------|------|
| `VITE_OPENAI_BASE_URL` | 如 `http://127.0.0.1:11434` 或 `https://api.deepseek.com` |
| `VITE_OPENAI_API_KEY` | 可选；本地常留空 |
| `VITE_OPENAI_MODEL` | 如 `llama3.2`、`deepseek-chat` |

生产构建（`npm run build`）部署到静态站时，需自行配置反向代理，或关闭代理并确保 API 允许跨域。

---

## 项目结构

```
sidecar/          # 本机 FS sidecar（Node HTTP）
public/           # 静态资源
src/
  components/     # UI：选中、澄清面板、分点裁决、Branch rail、项目连接
  lib/            # OpenAI 流式、agent 工具、sidecar、上下文、主题
  store/          # Zustand
  types.ts
```
