# 快速开始

本仓库是日常使用的 Skill 合集，包含三部分：

- **Skill 目录**：仓库根目录下的每个 `<skill-name>/` 目录即一个 Skill。
- **Web 管理台 / 桌面端**：`web/server`（本地 API）+ `web/client`（Vue 3 界面），支持通过 Tauri 打包为独立 `.exe`，内置对 Magpie 统一库的深度协同与自动分发。
- **文档站点**：`docs/`（VuePress v2），推送到 `main` 后自动发布到 `gh-pages`。

::: tip 运行模型与本地沙箱说明
Web 管理台**必须在用户自己的机器上启动**，不能由他人托管为公网 SaaS 页面直接管理访客的本地文件。  
原因在于浏览器的安全沙箱机制——纯 Web 前端没有任何权限静默访问或修改访客磁盘上的 Agent 目录（例如 `~/.claude/skills` 或 `C:\Users\xxx\.gemini`）。所有的文件落盘与软链接同步均由本机本地的守护进程完成。
:::

## 环境要求

- Node.js >= 20
- Git

## 安装与启动

```bash
npm install          # 安装全部依赖（npm workspaces）
npm run dev          # 同时启动 API 服务与 Web 管理台
```

- API 服务：`http://127.0.0.1:3001`（仅本机可访问）
- Web 管理台：`http://127.0.0.1:5173`

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 `web/server` 与 `web/client` 开发服务 |
| `npm run dev:server` | 仅启动 API 服务（`tsx watch`） |
| `npm run dev:client` | 仅启动前端（Vite） |
| `npm run build` | 构建 `web/server`（tsc）与 `web/client`（Vite） |
| `npm start` | 运行构建后的 API 服务 |
| `npm run docs:dev` | 本地预览文档 |
| `npm run docs:build` | 构建文档到 `docs/.vuepress/dist` |
