# Skills

日常使用的 Skill 合集管理仓库：统一收纳、预览与维护各类 Skill，提供本地 Web 管理台（支持多方式导入、全文件在线预览与下发至各 Agent 全局目录），并通过 VuePress + GitHub Actions 自动发布文档。

## 目录约定

每个 Skill 平铺在仓库根目录，独立一个目录，必须包含带 YAML Frontmatter（`name`、`description`）的 `SKILL.md`：

```text
<skill-name>/
├── SKILL.md
├── resources/    # 可选：模板、配置等资源
├── scripts/      # 可选：可执行脚本
└── references/   # 可选：参考资料
```

## Skill 索引

| Skill | 说明 |
| --- | --- |
| [github-vuepress-pages](./github-vuepress-pages/SKILL.md) | 生成 VuePress v2 文档并配置 GitHub Actions 发布到 GitHub Pages（默认官方 Actions 部署，可选 `gh-pages` 分支） |
| [multi-agent-cli](./multi-agent-cli/SKILL.md) | 在 `local` / `WSL` 中跨 CLI 协同调度 Claude Code 与 Codex，支持角色隔离、命名配置与临时配置 |

## 仓库结构

```text
.
├── <skill-name>/            # 各 Skill
├── web/server/              # 本地 API 服务（Express + TypeScript，仅监听 127.0.0.1:3001）
├── web/client/              # Web 管理台（Vue 3 + Vite）
├── docs/                    # VuePress v2 文档站点
└── .github/workflows/       # GitHub Actions 自动构建并发布至 GitHub Pages
```

## 本地启动

要求 Node.js >= 20。

```bash
npm install          # 安装全部依赖（npm workspaces）
npm run dev          # 同时启动 API 服务 (127.0.0.1:3001) 与管理台 (http://127.0.0.1:5173)
npm run build        # 构建 web/server 与 web/client
npm start            # 运行构建后的 API 服务
npm run docs:dev     # 本地预览文档
npm run docs:build   # 构建文档到 docs/.vuepress/dist
```

## 安全说明

- API 服务仅绑定 `127.0.0.1`，并校验 `Host` / `Origin` 请求头，不要暴露到公网。
- GitHub 仓库通过 `git` 参数数组调用下载，不经过 shell。
- 导入（`skills.sh`、本地文件夹、压缩包）与同步到 Agent 目录均会拦截符号链接与路径穿越，覆盖操作采用临时暂存与原子替换。
