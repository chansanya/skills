# Web 管理台

Web 管理台由两部分组成：

- `web/server`：Express 5 + TypeScript 本地 API 服务，**仅绑定 `127.0.0.1:3001`**，提供 Skill 扫描、全文件读取、多渠道导入与 Agent 目录同步能力。
- `web/client`：Vue 3 + Vite 前端，开发时将 `/api` 代理到 `127.0.0.1:3001`。

## 启动

```bash
npm install
npm run dev
```

启动后在浏览器打开 `http://127.0.0.1:5173`。

## 核心功能

- **Skill 列表与检索**：按名称、目录或描述关键字过滤本地 Skill。
- **全文件在线查看**：右侧文件树展示 `SKILL.md` 与 `resources/`、`scripts/`、`references/` 等所有文件，点击任意文件即可在线查看；`.md` 文件支持**预览 / 源码**切换，脚本与配置文件以等宽代码块展示，二进制或超过 `512 KB` 的文件会给出明确提示。
- **多方式导入 Skill**：
  - **skills.sh / GitHub**：输入 `owner/repo`、GitHub / `skills.sh` 链接或 `npx skills add ...` 命令，通过 SSE 实时查看安装日志；
  - **本地文件夹**：直接选择本地文件夹上传导入（支持自定义目录名与覆盖）；
  - **压缩包**：上传 `.zip`、`.tar.gz` 或 `.tgz` 压缩包（最大 `20 MB`），自动校验 `SKILL.md` Frontmatter 并原子落盘。
- **同步到 Agent 总目录**：支持多选 Skill，一键下发（复制文件或软链接）到常见 Agent 全局目录，并支持添加自定义 `~/...` 路径：
  - Claude Code：`~/.claude/skills`
  - Codex：`~/.codex/skills`
  - Agents (Universal)：`~/.agents/skills`
  - Antigravity：`~/.gemini/antigravity/skills`、`~/.gemini/config/skills`
  - Cursor：`~/.cursor/skills`

## API 参考

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/skills` | 列出所有 Skill（`name`、`dir`、`description`、资源文件） |
| `GET` | `/api/skills/:name` | 返回 `SKILL.md` 完整内容与文件树 |
| `GET` | `/api/skills/:name/file?path=...` | 读取 Skill 目录内指定文件的文本内容 |
| `POST` | `/api/skills/install` | 通过 `npx skills` 安装 Skill（SSE 实时日志流） |
| `POST` | `/api/skills/import-folder` | 上传本地文件夹导入 Skill（`multipart/form-data`） |
| `POST` | `/api/skills/import-archive` | 上传 `.zip` / `.tar.gz` / `.tgz` 导入 Skill |
| `GET` | `/api/agents/targets` | 检测并返回预置 Agent 全局目录状态 |
| `POST` | `/api/agents/sync` | 将选定 Skill 同步到选定 Agent 目录 |

### `POST /api/skills/install`

```json
{ "source": "vercel-labs/agent-skills", "skill": "web-design-guidelines", "overwrite": false }
```

`source` 支持 `owner/repo`、`https://github.com/<owner>/<repo>`、`https://skills.sh/<owner>/<repo>[/<skill>]` 或完整 `npx skills add ...` 命令。服务端在临时目录执行：

```bash
npx --yes skills add <owner/repo> --skill <name> --agent claude-code --copy -y
```

校验无符号链接且 `SKILL.md` Frontmatter 合法后，通过同文件系统暂存实现原子写入或覆盖。响应为 `text/event-stream`，事件类型：`log`、`done`、`error`。

## 安全约束

- 服务只监听 `127.0.0.1`，并校验 `Host` / `Origin` 请求头，防止 DNS rebinding 与跨站请求。
- 所有外部 CLI 调用均通过 `spawn` 以参数数组执行，`shell: false`，并限制输出大小与进程树超时终止。
- 导入与同步操作严格拦截符号链接与 `..` 路径穿越；自定义 Agent 目标路径必须位于当前用户主目录内且不与本仓库重叠。
