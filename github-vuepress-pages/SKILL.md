---
name: github-vuepress-pages
description: >-
  Generate VuePress documentation for a project and configure a GitHub Actions
  workflow to build and deploy it to GitHub Pages (defaulting to official
  GitHub Actions artifact deployment, with an optional `gh-pages` branch mode).
  Use this skill whenever preparing a project to push to GitHub, setting up
  project documentation with VuePress, or automating GitHub Pages deployment.
---

# GitHub VuePress & Pages Deployment

Automates generating a VuePress v2 documentation site for any project and
configuring a GitHub Actions workflow to build and publish it to GitHub Pages.

Supports two deployment modes (**Mode A is the default**):
- **Mode A (Default — GitHub Actions Direct Deployment)**: Uses
  `actions/upload-pages-artifact` + `actions/deploy-pages`. Keeps repository
  branches clean without creating a `gh-pages` branch.
- **Mode B (Optional — `gh-pages` Branch Deployment)**: Uses
  `peaceiris/actions-gh-pages` to push `docs/.vuepress/dist` to a dedicated
  `gh-pages` branch. Use only when the user explicitly requests a `gh-pages`
  branch or when Pages must be served from a branch.

## Prerequisites & Inputs

Before starting, inspect the target repository to determine:

1. **Project metadata**: Name, description, tech stack, and key features (from
   `README.md`, `package.json`, `pyproject.toml`, `go.mod`, etc.).
2. **GitHub remote**: Run `git remote -v` to extract `<owner>` and `<repo>`.
   - If the repo is `<owner>.github.io`, VuePress `base` is `/`.
   - Otherwise (standard project site), VuePress `base` **must** be `/<repo>/`.
3. **Default branch**: Check `git branch --show-current` or `git remote show origin`
   (typically `main` or `master`).
4. **Docs directory & package isolation**:
   - Check if `docs/` already exists and holds non-VuePress documentation:
     - If `docs/` is empty or absent, use `docs/`.
     - If `docs/` already has existing project docs, either organize them into
       `docs/guide/` or use `vuepress-docs/` to keep them separate. If using
       `vuepress-docs/`, update all `docs/` references consistently:
       `npm --prefix vuepress-docs`, `docsDir: 'vuepress-docs'` in `config.mjs`,
       `.gitignore` paths, `cache-dependency-path: vuepress-docs/package-lock.json`,
       `working-directory: vuepress-docs`, and `path` / `publish_dir`
       (`vuepress-docs/.vuepress/dist`) in the workflow.
   - **Recommended layout (All projects)**: Use an isolated `docs/package.json`
     (even for Node.js/Next.js/React projects) so VuePress, Vite, and
     `sass-embedded` do not conflict with the main project's dependencies or
     ESLint config. Only add to root `package.json` if the repository already
     uses workspaces or explicitly prefers root scripts.

---

## Step 1: Initialize VuePress v2

> **Important**: `@vuepress/theme-default` compiles `.scss` styles and
> **requires `sass-embedded`** (or `sass`). Always include `sass-embedded` in
> `devDependencies` or `vuepress build` will fail.

### Option A: Isolated `docs/package.json` (Recommended Default)

Create `docs/package.json`:

```json
{
  "name": "<repo>-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "docs:dev": "vuepress dev .",
    "docs:build": "vuepress build ."
  }
}
```

Then install VuePress v2 and `sass-embedded` inside `docs/` (this also generates
`docs/package-lock.json` required for CI caching and `npm ci`):

```bash
npm --prefix docs install -D vuepress@next @vuepress/bundler-vite@next @vuepress/theme-default@next sass-embedded
```

*(Note: Because `docs/` is the VuePress source dir, `.vuepress` lives at
`docs/.vuepress` and builds output to `docs/.vuepress/dist`. Be sure to commit
`docs/package-lock.json`.)*

### Option B: Root `package.json` (Monorepos / Workspaces)

```bash
npm install -D vuepress@next @vuepress/bundler-vite@next @vuepress/theme-default@next sass-embedded
```

Add scripts to root `package.json`:

```json
{
  "scripts": {
    "docs:dev": "vuepress dev docs",
    "docs:build": "vuepress build docs"
  }
}
```

---

## Step 2: Configure VuePress & Generate Documentation

1. **Create `docs/.vuepress/config.mjs`** using
   [vuepress-config.mjs](./resources/vuepress-config.mjs) as a template.
   - Replace `<REPO_NAME>`, `<PROJECT_TITLE>`, `<PROJECT_DESCRIPTION>`, and
     `<OWNER>/<REPO>`.
   - Verify `base: '/<repo>/'` matches the exact GitHub repository name (case-sensitive).

2. **Create `docs/README.md`** (homepage) using
   [docs-index.md](./resources/docs-index.md) as a template, tailored to the
   project's actual features and quick-start commands.

3. **Generate project documentation pages** under `docs/guide/`:
   - `docs/guide/README.md` (or `getting-started.md`): Installation, prerequisites,
     and quick start.
   - Additional pages based on the project (e.g., `configuration.md`,
     `architecture.md`, `api.md`, `changelog.md`).
   - Update `navbar` and `sidebar` in `docs/.vuepress/config.mjs` to match the
     generated files.

4. **Update `.gitignore`** at the repository root to exclude VuePress build and
   cache artifacts:

   ```gitignore
   # VuePress
   docs/.vuepress/.temp
   docs/.vuepress/.cache
   docs/.vuepress/dist
   node_modules/
   ```

### UI & Visual Enhancement (Recommended)

The default VuePress theme works out of the box, but to improve visual polish
(homepage hero layout, color palette, typography, or custom components):

1. **Discover a frontend skill first**: If `find-skills` (or an equivalent
   skill/marketplace lookup) is available, search for a relevant frontend
   design skill (such as `frontend-design`) and follow its design guidelines
   before writing custom styles.
2. **Scope customizations cleanly**: Place style overrides in
   `docs/.vuepress/styles/index.scss` (or `.css`) and custom Vue components in
   `docs/.vuepress/components/` rather than modifying generated build output.
3. **Preserve compatibility**: Ensure custom styles and components do not break
   VuePress v2 Vite bundling or `base` path asset resolution, and always verify
   with the local build in Step 3. If no frontend skill is available or found,
   proceed with the clean default theme.

---

## Step 3: Verify Local Build

Run the build locally before committing to catch broken links, invalid markdown,
or VuePress configuration errors:

- **Option A (`docs/` isolated — Recommended Default)**: `npm --prefix docs run docs:build`
- **Option B (root `package.json`)**: `npm run docs:build`

Confirm that `docs/.vuepress/dist/index.html` is generated with exit code `0`.

---

## Step 4: Add GitHub Actions Workflow

Choose the deployment workflow template (use **Mode A** by default unless the
user explicitly asks for a `gh-pages` branch):

- **Mode A (Default — GitHub Actions Direct Deployment)**: Create
  `.github/workflows/deploy-docs.yml` using
  [deploy-docs.yml](./resources/deploy-docs.yml).
  - Uses `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, and
    `actions/deploy-pages@v4` with `pages: write` + `id-token: write`
    permissions.
  - No extra `gh-pages` branch is created.
- **Mode B (Optional — `gh-pages` Branch)**: Create
  `.github/workflows/deploy-docs.yml` using
  [deploy-docs-gh-pages.yml](./resources/deploy-docs-gh-pages.yml).
  - Uses `peaceiris/actions-gh-pages@v4` with `contents: write`,
    `publish_branch: gh-pages`, and `publish_dir: docs/.vuepress/dist`.

Key details to adjust in either workflow:
- **`on.push.branches`**: Match the repository's default branch (`main` or `master`).
- **Node cache & build command**:
  - Option A (isolated `docs/package.json` — default in template): Keep
    `cache-dependency-path: docs/package-lock.json` on `actions/setup-node@v4`
    and `working-directory: docs` on the `npm ci && npm run docs:build` step.
    Ensure `docs/package-lock.json` is committed (not ignored).
  - Option B (root `package.json`): Remove `cache-dependency-path` and
    `working-directory: docs`, and run `npm ci && npm run docs:build` at repo root.

---

## Step 5: Commit, Push & Enable GitHub Pages

1. Commit and push all changes:
   - **Option A (`docs/` isolated)**:
     ```bash
     git add docs .github/workflows/deploy-docs.yml .gitignore
     ```
   - **Option B (root `package.json`)**:
     ```bash
     git add docs .github/workflows/deploy-docs.yml .gitignore package.json package-lock.json
     ```
   Then commit and push:
   ```bash
   git commit -m "docs: add VuePress documentation and GitHub Pages workflow"
   git push origin main
   ```

2. Verify the GitHub Actions run succeeds (if `gh` CLI is available):

   ```bash
   gh run list --workflow=deploy-docs.yml --limit 3
   ```

3. **One-time GitHub Repository Settings** (inform the user if not automated via `gh`):
   - **If using Mode A (Default)**:
     - **Settings -> Pages -> Build and deployment -> Source**: select
       **GitHub Actions**.
   - **If using Mode B (`gh-pages` branch)**:
     - **Settings -> Pages -> Build and deployment -> Source**: select
       **Deploy from a branch**, then select **`gh-pages`** / **`/ (root)`**.
     - **Settings -> Actions -> General -> Workflow permissions**: ensure
       **Read and write permissions** is enabled if the workflow fails with a
       `403` permission error when pushing to `gh-pages`.
   - Once enabled, the site will be live at `https://<owner>.github.io/<repo>/`.

---

## Step 6: Configure Repository "About" & GitHub Pages Website (Default)

Always populate the GitHub repository's **About** section and enable **Use your
GitHub Pages website** by default:

1. **Automated via `gh` CLI** (when `gh auth status` is logged in):
   - Derive a concise one-line description from the project and 3–6 lowercase
     hyphenated topics (e.g., `vuepress`, `documentation`, plus tech stack tags).
   - Set `homepage` to the exact GitHub Pages URL (`https://<owner>.github.io/<repo>/`,
     or `https://<owner>.github.io/` for `<owner>.github.io` repos), which
     populates the About website link (equivalent to **"Use your GitHub Pages
     website"**):
     ```bash
     gh repo edit <owner>/<repo> \
       --description "<PROJECT_DESCRIPTION>" \
       --homepage "https://<owner>.github.io/<repo>/" \
       --add-topic "vuepress,documentation,<topic3>"
     ```
2. **Manual fallback** (if `gh` CLI is unavailable):
   - On the GitHub repository page, click the gear icon next to **About**,
     fill in **Description** and **Topics**, and check **"Use your GitHub Pages
     website"**.
