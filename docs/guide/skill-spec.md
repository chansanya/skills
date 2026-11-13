# Skill 规范

## 存放路径约定

所有 Skill 平铺在仓库根目录，一个 Skill 一个目录，目录名即 Skill 名（小写字母、数字、`-`）。

```text
<skill-name>/
├── SKILL.md        # 必需
├── resources/      # 可选：模板、配置等资源
├── scripts/        # 可选：可执行脚本
└── references/     # 可选：参考资料
```

本地服务扫描根目录下的一级子目录，凡包含 `SKILL.md` 的即视为 Skill；`web/`、`docs/`、`node_modules/` 及以 `.` 开头的目录会被忽略。

## `SKILL.md` Frontmatter

`SKILL.md` 必须以 YAML Frontmatter 开头，至少包含 `name` 与 `description`：

```markdown
---
name: github-vuepress-pages
description: >-
  Generate VuePress documentation for a project and configure a GitHub Actions
  workflow to build and deploy it to GitHub Pages (defaulting to official
  GitHub Actions artifact deployment, with an optional `gh-pages` branch mode).
---

# 标题

正文：使用场景、步骤、注意事项……
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | Skill 唯一名称，建议与目录名一致 |
| `description` | 是 | 何时使用该 Skill，供 Agent 判断是否触发 |

## 与 `skills.sh` 生态的关系

- **收录外部 Skill**：在 Web 管理台的「导入」面板使用「Skills 搜索」或「GitHub 仓库」，输入 `owner/repo`、GitHub URL 或 `skills.sh` 链接；服务端直接获取并分析 GitHub 仓库，确认后将选中的 Skill 写入仓库根目录 `<skill-name>/`。
- **作为 Skill 源**：本仓库推送到 GitHub 后，其他项目可通过 `npx skills add <owner>/skills --skill <name>` 安装其中的 Skill。
