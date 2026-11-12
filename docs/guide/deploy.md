# 文档发布

文档站点基于 VuePress v2（`@vuepress/bundler-vite` + `@vuepress/theme-default`），配置位于 `docs/.vuepress/config.mjs`，`base` 为 `/skills/`。

## 本地构建

```bash
npm run docs:dev     # 本地预览
npm run docs:build   # 输出到 docs/.vuepress/dist
```

## GitHub Actions

`.github/workflows/deploy-docs.yml` 默认采用 **模式 A（GitHub Actions 直接部署）**，在推送到 `main` 或手动触发时运行：

1. `npm ci` 安装依赖；
2. `npm run docs:build` 构建文档；
3. 使用官方 `actions/upload-pages-artifact` + `actions/deploy-pages` 直接发布至 GitHub Pages（无需额外创建 `gh-pages` 分支）。

## 首次启用（一次性）

1. 创建 GitHub 仓库 `skills` 并添加远程：`git remote add origin git@github.com:<owner>/skills.git`。
2. 推送 `main` 分支。
3. **Settings → Pages → Build and deployment → Source**：选择 **GitHub Actions**。

发布后访问 `https://<owner>.github.io/skills/`。

::: warning
若仓库名不是 `skills`，需同步修改 `docs/.vuepress/config.mjs` 中的 `base`（区分大小写）。
:::
