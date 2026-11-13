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
| [agent-browser](./agent-browser/SKILL.md) | 面向 AI Agent 的浏览器自动化 CLI，支持页面导航、表单填写、截屏、数据提取与应用质检 |
| [amap-jsapi-skill](./amap-jsapi-skill/SKILL.md) | 高德地图 JSAPI v2.0 (WebGL) 开发技能，涵盖生命周期管理、3D 视图与覆盖物绘制 |
| [android-llm-agent](./android-llm-agent/SKILL.md) | 高德地图 AI 智能助手 SDK (AMap LLM Agent SDK)，支持自然语言交互地图导航服务 |
| [cloudflare](./cloudflare/SKILL.md) | Cloudflare 全产品架构选型与故障排查（Workers、Pages、KV、D1、R2、AI 等） |
| [code-review](./code-review/SKILL.md) | 针对 Git 变更运行代码规范与需求契约双重独立审查 |
| [codebase-design](./codebase-design/SKILL.md) | 代码库深模块设计通用词汇与架构分层规范 |
| [design-mobile-apps](./design-mobile-apps/SKILL.md) | 使用 Sleek 设计移动应用界面并在 React Native / HTML 中落地 |
| [diagnosing-bugs](./diagnosing-bugs/SKILL.md) | 复杂 Bug 与性能回退的科学诊断定位闭环 |
| [domain-modeling](./domain-modeling/SKILL.md) | 领域驱动设计 (DDD) 与项目业务领域建模 |
| [durable-objects](./durable-objects/SKILL.md) | Cloudflare Durable Objects 有状态持久化协同与 RPC 服务构建 |
| [find-skills](./find-skills/SKILL.md) | 检索并发现 Agent 技能生态中的官方与社区扩展 |
| [frontend-design](./frontend-design/SKILL.md) | 具个性化与高品质的前端 UI/UX 设计决策指导 |
| [github-vuepress-pages](./github-vuepress-pages/SKILL.md) | 生成 VuePress v2 文档并配置 GitHub Actions 自动发布到 GitHub Pages |
| [grill-me](./grill-me/SKILL.md) | 通过交互式质询推敲技术方案与系统设计 |
| [improve-codebase-architecture](./improve-codebase-architecture/SKILL.md) | 扫描代码库架构改进机会并生成可视化诊断报告 |
| [multi-agent-cli](./multi-agent-cli/SKILL.md) | 在 `local` / `WSL` 中跨 CLI 协同调度 Claude Code 与 Codex，支持角色隔离与命名配置 |
| [personal-map](./personal-map/SKILL.md) | 高德地图专属个人地图生成工具，支持 POI 搜索、路线规划与小程序打卡二维码生成 |
| [prototype](./prototype/SKILL.md) | 验证状态逻辑与交互效果的快速一次性原型构建 |
| [tdd](./tdd/SKILL.md) | 测试驱动开发 (TDD) 红绿重构标准开发流 |
| [turnstile-spin](./turnstile-spin/SKILL.md) | Cloudflare Turnstile 人机验证端到端集成与服务端校验 |
| [workers-best-practices](./workers-best-practices/SKILL.md) | Cloudflare Workers 生产环境最佳架构实践与性能调优 |
| [wrangler](./wrangler/SKILL.md) | Cloudflare Workers CLI (Wrangler) 开发、调试、资源管理与运维 |

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
