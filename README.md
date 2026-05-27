# Branch Chat

针对 AI 长回答的 **选中追问** 工具：拖选一段文字 → 弹窗提问 → 分支回答挂在原文下方，左侧树形目录导航。

- 纯 Web（Vite + React）
- OpenAI 兼容 API（默认适配 DeepSeek）
- **多会话**：左侧会话列表，新建/切换/删除，每条对话独立保存
- 无登录；数据保存在浏览器 `localStorage`

## 快速开始

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local，填入 VITE_OPENAI_API_KEY
npm run dev
```

浏览器打开终端提示的地址（通常是 http://localhost:5173）。

1. 右上角 **设置** 填写 API Key、Model（如 `deepseek-chat`）
2. 输入主问题，等待主回答
3. 在回答中 **拖选文字** → 点击「针对选中追问」
4. 在左侧 **分支目录** 点击节点，跳转到对应分支

## 连接本机大模型（Ollama / LM Studio 等）

任意提供 **OpenAI 兼容** `POST /v1/chat/completions` 的本地服务均可。

### 1. 启动本地服务

**Ollama**（常见）：

```bash
ollama serve          # 若未在后台运行
ollama pull llama3.2  # 或 qwen2.5:7b 等
ollama list           # 记下 MODEL 列名称，填到设置里
```

**LM Studio**：加载模型 → 开启 **Local Server**（兼容 OpenAI API），默认 `http://127.0.0.1:1234`。

### 2. 在 Branch Chat 里配置

1. 右上角 **设置**
2. 点 **Ollama** / **LM Studio** 预设（或手动填写 Base URL）
3. **Model** 填本地真实模型名（与 `ollama list` 或 LM Studio 一致）
4. **API Key** 留空即可（多数本地服务不需要）
5. 勾选 **使用本地代理** → 保存

| 服务 | Base URL | Model 示例 |
|------|----------|------------|
| Ollama | `http://127.0.0.1:11434` | `llama3.2`、`qwen2.5:7b` |
| LM Studio | `http://127.0.0.1:1234` | 界面里显示的名称 |

### 3. 自测本地 API 是否正常

```bash
curl http://127.0.0.1:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"hi"}],"stream":false}'
```

若 curl 成功而页面失败，检查 Model 名称、端口、以及是否勾选了代理。

## API 与代理

开发模式下建议开启 **本地代理**：

- 前端请求：`/openai/chat/completions`
- Vite 根据设置里的 Base URL 转发到本机或云端（无需改代码重启即可在设置里切换）

这样可避免浏览器直连时的 CORS 问题。

生产构建（`npm run build`）后若部署到静态服务器，需要自行配置反向代理，或关闭代理并确保 API 允许跨域。

## 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_OPENAI_BASE_URL` | 如 `https://api.deepseek.com` |
| `VITE_OPENAI_API_KEY` | 可选，也可只在页面设置里填 |
| `VITE_OPENAI_MODEL` | 如 `deepseek-chat` |

## 项目结构

```
src/
  components/     # UI：选中、弹窗、分支块、树侧栏
  lib/            # OpenAI 流式、上下文组装、选中偏移
  store/          # Zustand 状态
  types.ts        # 树节点类型
```

## 后续可扩展

- 内联高亮锚点（当前以分支卡片展示选中原文）
- 导出 Markdown（含树结构）
- 登录与云端同步
