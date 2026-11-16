---
name: weekly-report
description: >
  自动生成 AI 辅助工作周报。从 Antigravity、Codex Desktop、Claude Code (WSL)、
  Codex CLI (WSL) 等多个 AI 工具收集本周会话记录，综合分析并生成结构化周报，
  自动过滤私人内容。触发词：生成周报、写周报、weekly report、本周做了什么。
---

# AI 多工具周报生成 Skill

## 概述

这个 Skill 帮你自动生成每周工作周报。它会：

1. 运行数据采集脚本，从所有本地 AI 工具收集本周会话记录
2. 综合分析工作内容，按项目归类
3. 过滤私人内容，生成可直接使用的周报

**数据来源（全本地，零网络）：**
- Antigravity（Windows）
- Codex Desktop sessions + rollout_summaries（Windows）
- Claude Code 项目会话（WSL）
- Codex CLI archived_sessions + memories（WSL）

---

## 使用方法

用户说"生成周报"、"写周报"或"本周做了什么"时，执行以下步骤：

### Step 1 — 运行采集脚本

```powershell
# 通过 WSL Python 运行（推荐，自动检测环境）
wsl -d U22.04 python3 /home/dev/workspace/projects/vscode/skills/weekly-report/scripts/collect.py --days 7

# 写入文件
wsl -d U22.04 python3 .../collect.py --days 7 --output /tmp/weekly_data.json

# 或指定时间范围
wsl -d U22.04 python3 .../collect.py --week          # 本周一至今
wsl -d U22.04 python3 .../collect.py --since 2026-11-11
```

脚本会输出一个 JSON，包含：
- `sessions[]`：各工具的会话消息列表（已过滤私人内容）
- `rollout_summaries[]`：Codex Desktop 自动生成的工作摘要（高质量）
- `memories[]`：Codex CLI 的精炼记忆文件

### Step 2 — 分析并生成周报

拿到 JSON 数据后，使用以下分析思路：

**分析原则：**
- 优先使用 `rollout_summaries` 中的内容（已是 AI 高质量摘要，直接可用）
- 对 `sessions` 中的 user 消息，从首句推断任务意图
- 按项目路径（`project` 字段）聚合同一项目的不同工具记录
- 识别工作类型：开发 / 调研 / 调试 / 文档 / 配置
- 合并重复或相关内容，不要逐条列举
- 如内容明显与工作无关（聊天、个人事务），跳过

**私人内容过滤原则（判断标准）：**
- 明显的个人情感表达
- 涉及家庭、私人账号、财务的内容
- 与技术/工作毫无关联的闲聊

### Step 3 — 输出周报

按以下 Markdown 格式输出：

```markdown
# 工作周报 YYYY-WNN（MM/DD - MM/DD）

## 本周工作摘要

### 🛠️ 项目名称（工具来源）
- 具体工作内容（简洁、可读）
- 另一条工作内容

### 🔧 另一个项目
- ...

## 技术调研 & 探索
- 调研了 XXX 技术/方案

## 工具使用分布
| 工具 | 会话数 |
|---|---|
| Antigravity | N |
| Codex Desktop | N |
| Claude Code (WSL) | N |
| Codex CLI (WSL) | N |

## 本周亮点
（1-2 句话总结本周最重要的产出）
```

---

## 配置私人内容过滤

编辑 `scripts/collect.py` 顶部的 `PRIVATE_KEYWORDS` 列表，添加需要过滤的关键词：

```python
PRIVATE_KEYWORDS = [
    "老婆", "老公", "银行",   # 个人关键词举例
]
```

---

## 定时自动生成

如需每周自动生成，可以告诉我："每周五下午 5 点帮我生成周报"，我会用 `/schedule` 设置定时任务。

---

## 数据路径参考

| 工具 | 路径 |
|---|---|
| Antigravity | `C:\Users\<你的用户名>\.gemini\antigravity\brain\` |
| Codex Desktop sessions | `C:\Users\<你的用户名>\.codex\sessions\` |
| Codex Desktop rollouts | `C:\Users\<你的用户名>\.codex\memories_v2\rollout_summaries\` |
| Claude Code (WSL) | `\\wsl.localhost\U22.04\home\dev\.claude\projects\` |
| Codex CLI sessions (WSL) | `\\wsl.localhost\U22.04\home\dev\.codex\archived_sessions\` |
| Codex CLI memories (WSL) | `\\wsl.localhost\U22.04\home\dev\.codex\memories\memory_summary.md` |

> [!NOTE]
> 脚本顶部的 `WIN_HOME`、`WSL_DISTRO`、`WSL_USER` 可以手动修改以适配不同用户名或 WSL 发行版。

---

## 故障排查

**脚本报错 `ModuleNotFoundError`**：脚本只使用 Python 标准库，确保 Python 3.8+。

**WSL 路径读不到**：确认 WSL 已启动（`wsl --list --running`），UNC 路径 `\\wsl.localhost\U22.04\...` 需要 WSL 在运行状态。

**某工具数据为空**：检查对应路径是否存在，部分工具会话可能在时间范围外。

**旧 Codex Desktop 会话（.zst 格式）**：当前版本跳过压缩会话，优先使用 `rollout_summaries`。如需解压，在 WSL 中运行 `zstd -d *.zst`。
