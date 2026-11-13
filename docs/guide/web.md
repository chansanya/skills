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

## 导入 Skill 实操指南

点击页面右上角的 **「导入 Skill」** 按钮，会打开导入弹窗，支持以下 3 种方式：

### 方式 1：在线导入（skills.sh / GitHub）

最常用方式。无论你在 GitHub 上看到某个开源仓库，还是在 [skills.sh](https://skills.sh) 上找到技能，都可以直接下载落盘：

| 你的输入内容 | 来源（Source）输入框 | Skill 名称输入框 |
| :--- | :--- | :--- |
| **网页链接** | `https://skills.sh/vercel-labs/agent-skills/web-design-guidelines` | *(留空即可)* |
| **命令行指令** | `npx skills add vercel-labs/agent-skills --skill web-design-guidelines` | *(留空即可)* |
| **仓库名** | `vercel-labs/agent-skills` | `web-design-guidelines` |

- **一键快捷试用**：弹窗内提供了示例按钮，点击「示例 1」、「示例 2」可自动填入示范参数测试。
- **预检测机制（安全防错）**：点击「预检测 Skill 信息」后，系统会先从远端探测并解析该技能的名称、简介说明、附属文件列表以及本地冲突状态。
- **卡片式信息确认**：查看技能简介无误后，点击「确认下载入库」瞬间完成落盘；若不想导入也可点击「返回修改」重新输入。
- **覆盖控制**：若本地已存在同名技能，预检会给出明确的黄色冲突提示，并自动勾选确认覆盖。

### 方式 2：本地文件夹导入

适用于你本地已经写好一个 Skill 文件夹，或者从其他项目拷过来的目录：

1. 切换到 **「方式 2：本地文件夹」**。
2. 点击 **「选择 Skill 文件夹」** 选取该目录。
   - **必需规范**：文件夹根目录下**必须包含 `SKILL.md`**（带有 `name` 与 `description` 前言信息）。附带的 `resources/`、`scripts/` 会自动一并上传导入。
3. **存入仓库的目录名**：可留空（自动读取 `SKILL.md` 中的 `name`），也可以自定义指定一个英文目录名（如 `my-tool`）。

### 方式 3：压缩包导入（.zip / .tar.gz / .tgz）

适用于别人打包发给你的 Skill 压缩包：

1. 切换到 **「方式 3：压缩包」**。
2. 点击选择本地的 `.zip`、`.tar.gz` 或 `.tgz` 文件（单文件最大 20MB）。
3. 系统在服务端安全解压并做路径防穿越与软链接校验，确认包含合法 `SKILL.md` 后落盘。

---

## 核心功能

- **Skill 列表与检索**：按名称、目录或描述关键字过滤本地 Skill。
- **全文件在线查看**：右侧文件树展示 `SKILL.md` 与 `resources/`、`scripts/`、`references/` 等所有文件，点击任意文件即可在线查看；`.md` 文件支持**预览 / 源码**切换，脚本与配置文件以等宽代码块展示，二进制或超过 `512 KB` 的文件会给出明确提示。
- **多方式导入 Skill**：
  - **skills.sh / GitHub**：输入 `owner/repo`、GitHub / `skills.sh` 链接或 `npx skills add ...` 命令，通过 SSE 实时查看安装日志；
  - **本地文件夹**：直接选择本地文件夹上传导入（支持自定义目录名与覆盖）；
  - **压缩包**：上传 `.zip`、`.tar.gz` 或 `.tgz` 压缩包（最大 `20 MB`），自动校验 `SKILL.md` Frontmatter 并原子落盘。
- **同步到 Agent 总目录（WSL / 主机环境区分）**：支持多选 Skill，一键下发到本地 Agent 全局目录：
  - **环境自适应**：在 Windows 与 WSL 环境下自动双向互嗅（Windows 下嗅探 WSL，WSL 下嗅探宿主 Windows），存在时提供「主机」与「WSL」两个独立切换选项；在 macOS 或原生 Linux 环境下不嗅探 WSL，直接作为单主机的「主机」选项；
  - **下发方式**：同环境（WSL 内或主机自身）默认采用高效的「软链接」（亦可切「复制文件」）；跨环境（WSL 与 Windows 主机之间跨边界）则移除软链接，强制采用「复制文件」，确保原生应用兼容；
  - **自定义目录**：支持在对应视图下额外添加自定义 `~/...` 或 Windows 盘符路径。

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
