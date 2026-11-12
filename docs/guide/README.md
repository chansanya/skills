# 快速开始

本仓库是日常使用的 Skill 合集，包含三部分：

- **Skill 目录**：仓库根目录下的每个 `<skill-name>/` 目录即一个 Skill。
- **Web 管理台**：`web/server`（本地 API）+ `web/client`（Vue 3 界面）。
- **文档站点**：`docs/`（VuePress v2），推送到 `main` 后自动发布到 `gh-pages`。

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
