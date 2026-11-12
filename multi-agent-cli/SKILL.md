---
name: multi-agent-cli
description: >-
  Orchestrate multi-agent collaboration across Claude Code (`claude`) and OpenAI
  Codex (`codex`) from any CLI, shell (`bash`/`dsh`), or inside either agent.
  Use when splitting work between an Implementer agent and an independent
  Reviewer agent, invoking `claude -p` from Codex/shell, or invoking
  `codex exec` from Claude Code/shell.
---

# Multi-Agent CLI Collaboration (`claude` & `codex`)

Enables specialized multi-agent workflows ("各司其职") by calling `claude`
(Claude Code) and `codex` (Codex CLI) non-interactively from `bash`, `dsh`,
PowerShell/WSL, or from inside each other.

## 1. Environment Discovery (`local` vs `WSL`)

Before invoking any agent, identify **where the caller runs** and **where the
target CLI (`claude` / `codex`) and workspace live** (`local` vs `WSL`):

1. **Check local environment first**:
   - On **Linux / macOS / inside WSL**:
     ```bash
     which claude codex || bash -ic "which claude; which codex"
     ```
     *(Use `bash -ic` when non-interactive shells skip `~/.bashrc` / nvm / custom `bin/`.)*
   - On **Windows (PowerShell)**:
     ```powershell
     Get-Command claude, codex -ErrorAction SilentlyContinue
     ```
2. **Fall back to or prefer WSL (when on Windows)**:
   - If the CLI is missing in Windows `local`—or the active workspace is a WSL
     path (`\\wsl.localhost\<distro>\...`)—probe WSL via an interactive shell:
     ```powershell
     wsl bash -ic "which claude; claude --version; which codex; codex --version"
     ```
3. **Cross-environment path mapping (Windows -> WSL)**:
   - Strip `\\wsl.localhost\<distro>` prefix (e.g. `\\wsl.localhost\U22.04\home\dev\...`
     -> `/home/dev/...`).
   - Convert Windows drive paths (`C:\...`) to `/mnt/c/...` (or use `wslpath -u`).
   - Always `cd` into the mapped workspace path inside WSL before invoking the CLI.

---

## 2. Role Separation & Permission Modes (各司其职)

Assign clear, non-overlapping roles and use the minimum required permissions:

| Role | Recommended Mode | `claude` Command | `codex` Command |
| :--- | :--- | :--- | :--- |
| **Reviewer / Auditor** | Read-only (safe second pair of eyes) | `claude -p --permission-mode plan` (or instruct read-only + `--allowedTools Read,Glob,Grep`) | `codex exec --sandbox read-only -` |
| **Implementer / Builder** | Workspace write + commands | `claude -p --dangerously-skip-permissions` (or `--permission-mode acceptEdits`) | `codex exec --full-auto -` |

> **Concurrency Rule**: Never let two write-enabled agents edit the same
> working tree simultaneously. Either run **Builder -> Reviewer -> Fix**
> sequentially, or isolate parallel writers in separate `git worktree`s.

---

## 3. Safe Prompt Passing (Avoid Shell Quoting Bugs)

Never pass multi-line prompts, backticks, parentheses, or Chinese text via
inline nested quotes across PowerShell / `bash -ic`. Always pass the prompt via
a **file** or **stdin**:

```bash
# Recommended: pipe from a prompt file
cat <<'EOF' > /tmp/agent-prompt.txt
Review this repository for security issues and edge cases.
Do NOT modify any files. Return a prioritized list (Critical/High/Medium/Low).
EOF

# Call Codex as read-only reviewer
codex exec -m <model> --sandbox read-only - < /tmp/agent-prompt.txt

# Or call Claude Code as implementer
claude -p --model <model> --dangerously-skip-permissions < /tmp/agent-prompt.txt
```

Or use the helper script [run-agent.sh](./scripts/run-agent.sh):

```bash
./multi-agent-cli/scripts/run-agent.sh --agent codex --mode review --model <model> --prompt-file /tmp/agent-prompt.txt
./multi-agent-cli/scripts/run-agent.sh --agent claude --mode build --model <model> --prompt-file /tmp/agent-prompt.txt
```

---

## 4. Model, Profile & Dynamic Config (`--model` / `--settings` / `--profile`)

- **Default-first rule (strict)**: Use the CLI's **default** model and config
  unless the user **explicitly** requests an override (`--model`,
  `--profile` / `--settings`, temporary `--base-url` / `--api-key`, or
  `--save-profile`). Do not silently switch profiles, build custom configs, or
  persist profile files without explicit user instruction.
- **When to suggest extensions**: If the default call fails (e.g.
  `model_not_found`, `400 unknown provider`, `503 auth_unavailable`,
  `409 Conflict`, or rate/quota limits) or the task clearly calls for a
  different provider, report the exact error and **hint** that the user can
  specify a `--model`, switch to a named `--profile`, or supply a temporary
  `URL + key + model`.

Both CLIs accept `--model <model>` (`codex` also accepts `-m <model>`).

- **Named profile auto-discovery (Claude & Codex)**: When the user asks to use
  a named setting/profile (e.g., *"使用 zx 的 setting"* / *"use zx profile"*):
  - **For Claude Code** (`.json`): search in priority order:
    1. Project-level: `./.claude/settings-<name>.json` or `./.claude/setting-<name>.json`
       (or `./settings-<name>.json` / `./setting-<name>.json`)
    2. User-level: `~/.claude/settings-<name>.json` or `~/.claude/setting-<name>.json`
       (in `local` or `WSL`, matching where `claude` runs)
    - Pass the matched `.json` path via `--settings <path>` (or if no named
      profile is requested, `claude` natively loads `./.claude/settings.json`).
  - **For Codex** (`.toml`):
    1. Check `$CODEX_HOME/<name>.config.toml` (default `~/.codex/<name>.config.toml`)
       or `[profiles.<name>]` in `~/.codex/config.toml` -> pass via `-p <name>`
       (`--profile <name>`).
    2. If the user provides a project-level `./.codex/<name>.config.toml`, run
       with an ephemeral `CODEX_HOME` layering it or `-c` overrides.
    3. Without a named profile, Codex natively reads `~/.codex/config.toml` and
       project-level `./.codex/config.toml` (in trusted repos).
  - If multiple or zero matches are found, list the candidates or ask the user.
- **Dynamic ephemeral / synced config (URL + temporary key + model)**: When
  the user provides an API `URL`, a temporary `API key`, and a `model` directly
  in chat:
  - **Sync with default settings**: Always start from the user's existing
    default config (`~/.claude/settings.json` for Claude, `~/.codex/config.toml`
    and `skills/` for Codex) and override **only** `URL`, `key`, and `model`,
    keeping all other settings (permissions, hooks, reasoning effort, MCP
    servers, skills) synchronized with the defaults.
  - **Ephemeral by default**: Write temporary configs in `/tmp` (`chmod 600` /
    `700`, cleaned up on exit via `trap`), or pass `--base-url` + `--api-key` +
    `--model` to [run-agent.sh](./scripts/run-agent.sh). Never write temporary
    keys into the repository or overwrite default `~/.claude/settings.json` /
    `~/.codex/config.toml`.
  - **Persist only when requested**: If the user explicitly asks to save the
    assembled config as a named profile, pass `--save-profile <name>` (writes
    `~/.claude/settings-<name>.json` or `~/.codex/<name>.config.toml` synced
    with defaults).
  - Never echo or print the raw API key in logs or final responses.
- **Do not guess model IDs** when using custom API relays/proxies: aliases like
  `opus` or unconfigured names may fail with `400 unknown provider` or
  `model_not_found`.
- If a model call fails with `model_not_found` / `unknown provider` or relay
  `409 Conflict`, **stop and report the exact error** to the user so they can
  provide a supported model ID or confirm switching models.

---

## 5. Collaboration Examples (Flexible Composition)

Any CLI, shell (`bash`, `dsh`, PowerShell), or agent can orchestrate others as
needed—the examples below are common patterns, not a fixed limit:

- **Implement -> Cross-Review -> Fix**:
  1. **Builder** (e.g. Claude Code or Codex in `build` mode) implements changes.
  2. **Reviewer** (another agent in `review` / read-only mode) audits security
     (command injection, path traversal, symlinks), edge cases, and spec drift.
  3. **Fix & Verify**: Address findings, then **always run local build/test
     verification** (`npm run build`, `git status`, etc.) directly before
     reporting completion.
- **Inside Claude Code / Codex**:
  - Call the peer CLI in read-only `review` mode for a second opinion, or
    delegate an independent subtask (e.g., docs/UI vs backend/audit).
- **From `dsh` / Shell / CI Scripts**:
  - Chain `run-agent.sh` stages in `dsh` or shell pipelines, capturing stdout and
    exiting non-zero on failure. If running from Windows against WSL-hosted CLIs,
    invoke `wsl bash -ic "<workdir>/multi-agent-cli/scripts/run-agent.sh ..."`
    with mapped paths.

---

## 6. Final Output Requirements

At the end of every multi-agent task, **explicitly report** the execution
summary in the final response:

1. **CLI & Environment**: Which CLI(s) ran (`claude` / `codex`) and where
   (`local` or `WSL`).
2. **Model Used**: The exact model ID passed via `--model` / `-m` (or
   `default` if no override was passed).
3. **Role & Outcome**: Each agent's role (`build` / `review`), key findings or
   modified files, and the directly verified build/test results.

Example summary table:

| Stage | CLI | Environment | Model | Role | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Implement | `claude` | `WSL` | `claude-opus-5-5` | `build` | Completed Phase 1-3, builds passed |
| Audit | `codex` | `WSL` | `gpt-5.6-sol` | `review` (read-only) | Found 3 High, 6 Medium, 3 Low |
