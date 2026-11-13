# Repository Guidelines

## Project Structure & Module Organization

This repository combines reusable agent Skills, a local management UI, and documentation. Each Skill lives in a top-level kebab-case directory such as `multi-agent-cli/` and must contain `SKILL.md` with YAML frontmatter (`name` and `description`). Optional Skill content belongs in `resources/`, `scripts/`, or `references/`.

The application uses npm workspaces: `web/server/src/` contains the Express 5 and TypeScript API, while `web/client/src/` contains the Vue 3 and Vite interface. VuePress content is under `docs/`; deployment automation is in `.github/workflows/`. Treat `web/*/dist/` and `docs/.vuepress/{.temp,.cache,dist}/` as generated output.

## Build, Test, and Development Commands

Use Node.js 20 or newer; CI currently runs Node.js 24.

- `npm install` — install root and workspace dependencies.
- `npm run dev` — start the API on `127.0.0.1:3001` and the UI on `127.0.0.1:5173`.
- `npm run dev:server` / `npm run dev:client` — run one workspace only.
- `npm -w web/server run typecheck` — validate server TypeScript without emitting files.
- `npm run build` — build both web workspaces.
- `npm run docs:dev` / `npm run docs:build` — preview or build the VuePress site.
- `npm start` — run the compiled server from `web/server/dist/`.

## Coding Style & Naming Conventions

Follow the existing TypeScript/Vue style: two-space indentation, single quotes, no semicolons, and trailing commas in multiline literals. Keep strict TypeScript clean; unused locals and parameters are errors. Use `PascalCase.vue` for components, `camelCase` for functions and variables, and descriptive kebab-case Skill directories. Keep server modules focused and avoid weakening path, host, origin, or symlink protections.

## Testing Guidelines

No automated test runner or coverage threshold is configured. At minimum, run server type checking and the build relevant to your change. Manually verify affected import, preview, synchronization, and documentation flows. If adding tests, colocate them with the feature and use clear `*.test.ts` names; avoid broad fixture sets for small behavior changes.

## Commit & Pull Request Guidelines

Git history follows Conventional Commits, commonly `feat(scope):`, `fix(scope):`, `style(scope):`, and `docs(scope):`. Keep commits narrowly scoped, for example `fix(ci): use Node 24 for docs build`. Pull requests should explain the problem and solution, list validation performed, link related issues, and include screenshots for UI changes. Call out security-sensitive filesystem or synchronization changes explicitly; never commit `.env`, keys, logs, dependencies, or generated builds.
