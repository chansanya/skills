#!/usr/bin/env bash
set -euo pipefail

AGENT=""
MODE="review"
MODEL=""
SETTINGS=""
PROFILE=""
BASE_URL=""
API_KEY=""
SAVE_PROFILE=""
PROMPT_FILE=""
WORKDIR="$(pwd)"
TMP_CONFIG=""

cleanup() {
  if [[ -n "$TMP_CONFIG" && -e "$TMP_CONFIG" ]]; then
    rm -rf "$TMP_CONFIG"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage: run-agent.sh --agent <claude|codex> [options]

Options:
  --agent <claude|codex>     Target CLI agent (required)
  --mode <review|build>      review = read-only/plan, build = write+exec (default: review)
  --model <model_id>         Optional model name passed via --model / -m
  --settings <file-or-json>  Optional Claude settings JSON file path or JSON string
  --profile <name>           Optional named profile (auto-finds Claude settings-<name>.json or passes -p <name> to Codex)
  --base-url <url>           Optional temporary API base URL (inherits default settings)
  --api-key <key>            Optional temporary API key (used with ephemeral config, never persisted unless --save-profile)
  --save-profile <name>      Optional: save generated config (synced with defaults) as a named profile
  --prompt-file <path>       Prompt file path (reads stdin if omitted)
  --workdir <dir>            Working directory (default: current directory)
  -h, --help                 Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --mode) MODE="${2:-}"; shift 2 ;;
    --model) MODEL="${2:-}"; shift 2 ;;
    --settings) SETTINGS="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --api-key) API_KEY="${2:-}"; shift 2 ;;
    --save-profile) SAVE_PROFILE="${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="${2:-}"; shift 2 ;;
    --workdir) WORKDIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ "$AGENT" != "claude" && "$AGENT" != "codex" ]]; then
  echo "Error: --agent must be 'claude' or 'codex'" >&2
  exit 2
fi

if [[ "$MODE" != "review" && "$MODE" != "build" ]]; then
  echo "Error: --mode must be 'review' or 'build'" >&2
  exit 2
fi

if [[ -n "$PROMPT_FILE" && ! -f "$PROMPT_FILE" ]]; then
  echo "Error: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi

if [[ -n "$SAVE_PROFILE" && ! "$SAVE_PROFILE" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: --save-profile must match ^[a-zA-Z0-9_-]+$" >&2
  exit 2
fi

cd "$WORKDIR"

CMD=()
if [[ "$AGENT" == "claude" ]]; then
  CMD=(claude -p)
  if [[ -n "$MODEL" ]]; then
    CMD+=(--model "$MODEL")
  fi

  if [[ -n "$BASE_URL" || -n "$API_KEY" || -n "$SAVE_PROFILE" ]]; then
    if [[ -n "$SAVE_PROFILE" ]]; then
      mkdir -p "${HOME}/.claude"
      TARGET_CFG="${HOME}/.claude/settings-${SAVE_PROFILE}.json"
    else
      TMP_CONFIG="$(mktemp /tmp/claude-temp-settings.XXXXXX.json)"
      TARGET_CFG="$TMP_CONFIG"
    fi

    BASE_CFG="${HOME}/.claude/settings.json"
    TEMP_BASE_URL="$BASE_URL" TEMP_API_KEY="$API_KEY" TEMP_MODEL="$MODEL" BASE_CFG="$BASE_CFG" node -e '
      const fs = require("fs");
      let cfg = {};
      try {
        if (fs.existsSync(process.env.BASE_CFG)) {
          const parsed = JSON.parse(fs.readFileSync(process.env.BASE_CFG, "utf8"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cfg = parsed;
        }
      } catch {}
      cfg.env = (cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)) ? { ...cfg.env } : {};
      if (process.env.TEMP_BASE_URL) cfg.env.ANTHROPIC_BASE_URL = process.env.TEMP_BASE_URL;
      if (process.env.TEMP_API_KEY) cfg.env.ANTHROPIC_AUTH_TOKEN = process.env.TEMP_API_KEY;
      if (process.env.TEMP_MODEL) cfg.model = process.env.TEMP_MODEL;
      fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
    ' "$TARGET_CFG"
    chmod 600 "$TARGET_CFG"
    SETTINGS="$TARGET_CFG"
    CMD+=(--settings "$TARGET_CFG")
  elif [[ -n "$SETTINGS" ]]; then
    if [[ "$SETTINGS" != \{* && ! -f "$SETTINGS" ]]; then
      echo "Error: settings file not found: $SETTINGS" >&2
      exit 2
    fi
    CMD+=(--settings "$SETTINGS")
  elif [[ -n "$PROFILE" ]]; then
    FOUND=""
    for cand in \
      ".claude/settings-${PROFILE}.json" \
      ".claude/setting-${PROFILE}.json" \
      "settings-${PROFILE}.json" \
      "setting-${PROFILE}.json" \
      "${HOME}/.claude/settings-${PROFILE}.json" \
      "${HOME}/.claude/setting-${PROFILE}.json"; do
      if [[ -f "$cand" ]]; then
        FOUND="$cand"
        break
      fi
    done
    if [[ -z "$FOUND" ]]; then
      echo "Error: Claude profile '${PROFILE}' not found in .claude/ or ~/.claude/" >&2
      exit 2
    fi
    SETTINGS="$FOUND"
    CMD+=(--settings "$FOUND")
  fi

  if [[ "$MODE" == "review" ]]; then
    CMD+=(--permission-mode plan)
  else
    CMD+=(--dangerously-skip-permissions)
  fi
else
  CMD=(codex exec)
  if [[ -n "$MODEL" ]]; then
    CMD+=(-m "$MODEL")
  fi

  if [[ -n "$BASE_URL" || -n "$API_KEY" || -n "$SAVE_PROFILE" ]]; then
    CODEX_BASE_DIR="${CODEX_HOME:-${HOME}/.codex}"
    BASE_TOML="${CODEX_BASE_DIR}/config.toml"

    if [[ -n "$SAVE_PROFILE" ]]; then
      mkdir -p "$CODEX_BASE_DIR"
      TARGET_TOML="${CODEX_BASE_DIR}/${SAVE_PROFILE}.config.toml"
      PROVIDER_NAME="$SAVE_PROFILE"
      CMD+=(-p "$SAVE_PROFILE")
    else
      TMP_CONFIG="$(mktemp -d /tmp/codex-temp-home.XXXXXX)"
      chmod 700 "$TMP_CONFIG"
      if [[ -d "${CODEX_BASE_DIR}/skills" ]]; then
        ln -s "${CODEX_BASE_DIR}/skills" "${TMP_CONFIG}/skills"
      fi
      if [[ -f "${CODEX_BASE_DIR}/auth.json" ]]; then
        ln -s "${CODEX_BASE_DIR}/auth.json" "${TMP_CONFIG}/auth.json"
      fi
      TARGET_TOML="${TMP_CONFIG}/config.toml"
      PROVIDER_NAME="temp"
      export CODEX_HOME="$TMP_CONFIG"
    fi

    TEMP_BASE_URL="$BASE_URL" TEMP_MODEL="$MODEL" BASE_TOML="$BASE_TOML" PROVIDER_NAME="$PROVIDER_NAME" SAVE_MODE="${SAVE_PROFILE:+1}" node -e '
      const fs = require("fs");
      const basePath = process.env.BASE_TOML;
      const prov = process.env.PROVIDER_NAME;
      const model = process.env.TEMP_MODEL;
      const baseUrl = process.env.TEMP_BASE_URL;
      let existing = "";
      try {
        if (fs.existsSync(basePath)) existing = fs.readFileSync(basePath, "utf8");
      } catch {}

      const lines = existing ? existing.split(/\r?\n/) : [];
      const firstTableIdx = lines.findIndex((l) => /^\s*\[/.test(l));
      const topLines = (firstTableIdx === -1 ? lines : lines.slice(0, firstTableIdx))
        .filter((l) => !/^\s*(model|model_provider)\s*=/.test(l));
      const restLines = firstTableIdx === -1 ? [] : lines.slice(firstTableIdx);

      const header = [];
      if (model) header.push(`model = ${JSON.stringify(model)}`);
      header.push(`model_provider = ${JSON.stringify(prov)}`);

      const providerBlock = [
        "",
        `[model_providers.${prov}]`,
        `name = ${JSON.stringify(prov)}`,
        ...(baseUrl ? [`base_url = ${JSON.stringify(baseUrl)}`] : []),
        `env_key = "TEMP_CODEX_API_KEY"`,
        `wire_api = "responses"`,
      ];

      const out = [...header, ...topLines, ...restLines, ...providerBlock].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
      fs.writeFileSync(process.argv[1], out, { mode: 0o600 });
    ' "$TARGET_TOML"
    chmod 600 "$TARGET_TOML"
    if [[ -n "$API_KEY" ]]; then
      export TEMP_CODEX_API_KEY="$API_KEY"
    fi
  elif [[ -n "$PROFILE" ]]; then
    CMD+=(-p "$PROFILE")
  fi

  if [[ "$MODE" == "review" ]]; then
    CMD+=(--sandbox read-only)
  else
    CMD+=(--full-auto)
  fi
  CMD+=(-)
fi

ENV_KIND="local"
if grep -qiE "microsoft|wsl" /proc/version 2>/dev/null; then
  ENV_KIND="wsl"
fi
echo "[multi-agent-cli] cli=${AGENT} env=${ENV_KIND} mode=${MODE} model=${MODEL:-default}${PROFILE:+ profile=${PROFILE}}${SAVE_PROFILE:+ saved_profile=${SAVE_PROFILE}}${SETTINGS:+ settings=${SETTINGS}}${BASE_URL:+ base_url=${BASE_URL}}" >&2

if [[ -n "$PROMPT_FILE" ]]; then
  "${CMD[@]}" < "$PROMPT_FILE"
else
  "${CMD[@]}"
fi
