# Skill 合集仓库开发计划

## 1. 仓库定位与核心目标

本仓库定位为**日常使用的 Skill 合集管理仓库**，用于统一收集、整理、预览与维护工作流相关的各类 Skill，并支持通过 Web 界面完成日常操作。

### 核心目标
1. **Skill 标准化收纳**：遵循 `SKILL.md` + `resources/` / `scripts/` / `references/` 标准目录规范，兼容 `skills.sh` 生态（既可收录外部 Skill，也可作为 Skill 源被其他项目安装）。
2. **Web 界面可视化管理**：提供本地 Web 管理界面，支持浏览/搜索本地 Skill、渲染查看 `SKILL.md` 内容、一键通过 `skills.sh` 下载新 Skill 到本地、以及一键执行 Git 提交与推送。
3. **自动化文档与发布**：遵循 `github-vuepress-pages` 规范，为仓库配置 VuePress v2 文档与 GitHub Actions，每次推送到 GitHub 时默认通过官方 Pages Artifact 直接部署（可选推送到 `gh-pages` 分支）。

---

## 2. 推荐仓库目录结构

```text
skills/
├── README.md                     # 仓库说明与 Skill 目录索引
├── DEVELOPMENT_PLAN.md           # 本开发计划
├── github-vuepress-pages/        # 已创建的 Skill 示例
│   ├── SKILL.md
│   └── resources/
├── <other-skill>/                # 后续收录的各类 Skill（平铺或统一置于 skills/ 下）
│   └── SKILL.md
├── web/                          # Web 管理界面（前端 + 本地控制服务端）
│   ├── client/                   # 前端页面（Vue 3 / React + Vite）
│   └── server/                   # 本地 Node.js API 服务（封装 skills.sh 与 Git CLI）
├── docs/                         # VuePress v2 文档站点
│   ├── .vuepress/
│   ├── guide/
│   └── README.md
└── .github/
    └── workflows/
        └── deploy-docs.yml       # 自动构建 VuePress 并发布至 gh-pages 分支
```

---

## 3. 核心功能模块设计

### 模块 A：Skill 规范与 `skills.sh` 接入
- **目录规范**：每个 Skill 独立目录，必须包含带 YAML Frontmatter（`name`、`description`）的 `SKILL.md`。
- **下载能力**：集成 `skills.sh`（如 `npx skills add <owner/repo> --skill <name>`），支持：
  - 解析用户输入的 `skills.sh` 链接、仓库名或安装命令。
  - 将下载的 Skill 落盘至本仓库指定目录，并检查是否已存在同名 Skill（提示覆盖或跳过）。
  - 自动解析新增 Skill 的 Frontmatter，更新前端列表或仓库索引。

### 模块 B：本地控制服务端 (`web/server`)
由于浏览器无法直接执行本地 CLI 与 Git 操作，需要一个轻量本地 Node.js 服务（仅监听 `127.0.0.1`）：
- `GET /api/skills`：扫描仓库内所有 `SKILL.md`，解析 `name`、`description` 与附属文件列表。
- `GET /api/skills/:name`：读取指定 Skill 的完整 `SKILL.md` 及资源文件详情。
- `POST /api/skills/install`：调用 `npx skills` 下载指定 Skill 到本地仓库，支持实时日志输出（SSE）。
- `GET /api/git/status`：获取当前仓库变更状态（新增、修改、未跟踪文件、当前分支与远程状态）。
- `POST /api/git/sync`：执行 `git add` -> `git commit` -> `git push origin <branch>`，并返回执行结果。

### 模块 C：Web 管理界面 (`web/client`)
- **Skill 列表与检索**：卡片/列表展示所有已收录 Skill，支持按名称、关键词过滤。
- **Skill 详情预览**：Markdown 渲染查看 `SKILL.md`，展示关联的 `resources/`、`scripts/` 文件结构。
- **导入弹窗（`skills.sh`）**：输入 `owner/repo` 或 `skills.sh` URL/命令，点击下载后实时展示安装日志与结果。
- **Git 同步面板**：展示待提交的变更文件，提供自动生成 Commit Message 的快捷模板（如 `feat(skill): add <skill-name>`），一键提交并推送到远程 GitHub。

### 模块 D：VuePress 文档与 GitHub Pages 自动发布
- 使用仓库内的 `github-vuepress-pages` Skill 初始化 `docs/` 文档与 `.github/workflows/deploy-docs.yml`。
- 每次推送更新到默认分支后，GitHub Actions 自动构建 `docs/.vuepress/dist` 并推送至 `gh-pages` 分支发布。

---

## 4. 分阶段开发计划

### Phase 1：仓库基础与文档流水线搭建
- [x] 初始化本地 Git 仓库（`main` 分支）。
- [ ] 关联远程 GitHub 仓库（待创建远程后执行 `git remote add origin ...`）。
- [x] 确定 Skill 存放路径约定：根目录平铺 `<skill-name>/`。
- [x] 完善根目录 `README.md`，说明仓库用途及本地启动方式。
- [x] 应用 `github-vuepress-pages` Skill 为本仓库生成 `docs/` 与 `.github/workflows/deploy-docs.yml`（本地构建通过）。
- [ ] 验证 GitHub Pages 发布畅通（需推送到远程后验证）。

### Phase 2：本地服务与 CLI 封装 (`web/server`)
- [x] 初始化 Node.js 后端工程（Express 5 + TypeScript）。
- [x] 实现本地 Skill 扫描与 Frontmatter 解析接口。
- [x] 封装 `skills.sh`（`npx skills`）下载逻辑，处理安装路径整理与错误捕获。
- [x] 封装 `git status / add / commit / push` 接口，处理无变更、推送冲突、认证失败等异常场景。

### Phase 3：Web 界面开发 (`web/client`)
- [x] 初始化前端工程（Vue 3 + Vite）。
- [x] 实现 Skill 列表页与 Markdown 详情预览页。
- [x] 实现「从 `skills.sh` 下载 Skill」交互界面与实时日志展示。
- [x] 实现「Git 变更查看与一键提交推送」面板。

### Phase 4：联调测试与日常工作流验证
- [ ] 端到端链路测试：Web 界面触发 `skills.sh` 下载 -> 本地校验文件落盘 -> Web 界面提交并推送 GitHub -> 验证远程提交成功及 Actions 自动部署 GitHub Pages。
- [x] 补充根级启动脚本（如 `npm run dev` 同时启动前后端 Web 管理台）。
- [ ] 补充常见异常提示与使用说明。

---

## 5. 技术约束与安全规范

1. **仅限本地运行**：`web/server` 仅绑定 `127.0.0.1` / `localhost`，严禁直接暴露到公网，防止未授权执行本地文件写入与 Git 推送。
2. **防命令注入**：后端调用 `npx skills` 和 `git` 命令时，必须使用 `child_process.execFile` 或 `spawn` 传参数组形式，并对用户输入的仓库名、Skill 名称、Commit Message 进行格式校验，禁止直接拼接 shell 字符串。
3. **操作幂等与防误覆盖**：下载同名 Skill 前提示确认；执行 `git push` 前展示待提交文件清单，避免误提交敏感文件（如 `.env`、本地密钥等）。
