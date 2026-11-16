#!/usr/bin/env python3
"""
AI Weekly Report Collector
从多个 AI 工具收集本周会话记录，输出结构化 JSON 供周报生成使用。

支持数据源（全部读取本地文件，零网络请求）：
  - Antigravity (Windows)        transcript.jsonl
  - Codex Desktop (Windows)      sessions/*.jsonl + memories_v2/rollout_summaries/*.md
  - Claude Code (WSL)            ~/.claude/projects/*/*.jsonl
  - Codex CLI (WSL)              ~/.codex/archived_sessions/*.jsonl + memories/memory_summary.md
  - Codex CLI history (WSL)      ~/.codex/history.jsonl

用法:
  python collect.py                   # 默认收集最近 7 天
  python collect.py --days 14         # 最近 14 天
  python collect.py --since 2026-11-11  # 指定起始日期
  python collect.py --week            # 本周一到今天
"""

import json
import os
import re
import sys
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

# ─────────────────────────── 配置 ───────────────────────────
# 自动检测运行环境（Windows 或 WSL）
_IS_WSL = os.path.exists("/proc/version") and "microsoft" in open("/proc/version").read().lower()

# Windows 用户目录
_WIN_USERNAME = "98403"  # ← 如需修改请改这里
if _IS_WSL:
    WIN_HOME = Path(f"/mnt/c/Users/{_WIN_USERNAME}")
else:
    WIN_HOME = Path(os.environ.get("USERPROFILE", f"C:/Users/{_WIN_USERNAME}"))

# WSL 发行版 & 用户
WSL_DISTRO = "U22.04"   # ← 如需修改请改这里
WSL_USER = "dev"         # ← 如需修改请改这里
if _IS_WSL:
    WSL_HOME = Path(f"/home/{WSL_USER}")
else:
    WSL_HOME = Path(f"//wsl.localhost/{WSL_DISTRO}/home/{WSL_USER}")

# 私人内容关键词黑名单（包含这些词的 user 消息会被跳过）
PRIVATE_KEYWORDS = [
    # 在此添加需要过滤的关键词，如人名、个人账号等
    # 例如: "老婆", "银行卡", "密码"
]
# ─────────────────────────────────────────────────────────────


def parse_ts(ts) -> Optional[datetime]:
    """解析多种时间戳格式，统一返回 UTC aware datetime"""
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            # Unix 秒级或毫秒级时间戳
            if ts > 1e12:
                ts = ts / 1000
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        s = str(ts).strip()
        # 尝试多种 ISO 格式
        for fmt in [
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S.%f%z",
            "%Y-%m-%dT%H:%M:%S%z",
        ]:
            try:
                dt = datetime.strptime(s, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
            except ValueError:
                continue
    except Exception:
        pass
    return None


def in_range(dt: Optional[datetime], start: datetime, end: datetime) -> bool:
    if dt is None:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return start <= dt <= end


def is_private(text: str) -> bool:
    if not text:
        return False
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in PRIVATE_KEYWORDS)


_XML_TAG_RE = re.compile(r"<[A-Z_]+>.*?</[A-Z_]+>", re.DOTALL)
_META_RE = re.compile(r"<(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)[^>]*>|</(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>", re.IGNORECASE)

def clean_text(text: str, max_len: int = 300) -> str:
    """截断 + 去除多余空白 + 剥离 Antigravity 包装标签"""
    if not text:
        return ""
    # 提取 <USER_REQUEST> 内容
    m = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", text, re.DOTALL | re.IGNORECASE)
    if m:
        text = m.group(1)
    # 移除其余 XML 标签
    text = _META_RE.sub("", text)
    text = " ".join(text.split())
    return text[:max_len] + ("…" if len(text) > max_len else "")


def extract_project(cwd: Optional[str]) -> str:
    if not cwd:
        return "未知项目"
    p = Path(cwd)
    # 取最后两级路径作为项目标识
    parts = p.parts
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return p.name


# ═══════════════════════════════════════════════════════════
#  数据源 1: Antigravity (Windows)
# ═══════════════════════════════════════════════════════════
def collect_antigravity(start, end):
    """读取 Antigravity brain 目录下所有对话的 transcript.jsonl"""
    results = []
    brain_dir = WIN_HOME / ".gemini" / "antigravity" / "brain"
    if not brain_dir.exists():
        return results

    for conv_dir in brain_dir.iterdir():
        if not conv_dir.is_dir():
            continue
        transcript = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
        if not transcript.exists():
            continue

        try:
            lines = transcript.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        session_msgs = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if obj.get("type") != "USER_INPUT":
                continue

            ts = parse_ts(obj.get("created_at"))
            if not in_range(ts, start, end):
                continue

            content = obj.get("content", "")
            if isinstance(content, list):
                content = " ".join(
                    c.get("text", "") for c in content if isinstance(c, dict)
                )
            content = str(content).strip()
            if not content or is_private(content):
                continue

            session_msgs.append({
                "ts": ts.isoformat(),
                "text": clean_text(content),
            })

        if session_msgs:
            results.append({
                "source": "Antigravity",
                "project": "—",
                "session_id": conv_dir.name[:8],
                "messages": session_msgs,
            })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 2: Codex Desktop rollout_summaries (Windows)
# ═══════════════════════════════════════════════════════════
def collect_codex_desktop_rollouts(start, end):
    """读取 Codex Desktop 的 rollout_summaries — 已是 AI 生成的高质量摘要"""
    results = []
    rollouts_dir = WIN_HOME / ".codex" / "memories_v2" / "rollout_summaries"
    if not rollouts_dir.exists():
        return results

    for md_file in rollouts_dir.glob("*.md"):
        try:
            content = md_file.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        # 解析 frontmatter: updated_at: YYYY-MM-DDTHH:MM:SS+00:00
        ts = None
        cwd = None
        git_branch = None
        for line in content.splitlines()[:10]:
            if line.startswith("updated_at:"):
                ts = parse_ts(line.split(":", 1)[1].strip())
            elif line.startswith("cwd:"):
                cwd = line.split(":", 1)[1].strip()
            elif line.startswith("git_branch:"):
                git_branch = line.split(":", 1)[1].strip()

        # 如果没有 updated_at，从文件名提取日期
        if ts is None:
            m = re.search(r"(\d{4}-\d{2}-\d{2})", md_file.name)
            if m:
                ts = parse_ts(m.group(1) + "T00:00:00Z")

        if not in_range(ts, start, end):
            continue

        # 摘要正文（跳过 frontmatter 前几行）
        body_lines = [l for l in content.splitlines() if not l.startswith(("thread_id:", "updated_at:", "rollout_path:", "cwd:", "git_branch:"))]
        summary = " ".join(body_lines).strip()

        if is_private(summary):
            continue

        results.append({
            "source": "Codex Desktop (Rollout Summary)",
            "project": extract_project(cwd),
            "git_branch": git_branch or "—",
            "ts": ts.isoformat() if ts else "—",
            "summary": clean_text(summary, 600),
            "filename": md_file.name,
        })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 3: Codex Desktop sessions — 明文 .jsonl (Windows)
# ═══════════════════════════════════════════════════════════
def collect_codex_desktop_sessions(start, end):
    """读取 Codex Desktop sessions 目录下的明文 .jsonl 会话"""
    results = []
    sessions_dir = WIN_HOME / ".codex" / "sessions"
    if not sessions_dir.exists():
        return results

    # 目录结构: sessions/YYYY/MM/DD/*.jsonl
    for jsonl_file in sessions_dir.rglob("*.jsonl"):
        # 从路径提取日期做粗过滤
        m = re.search(r"(\d{4})[/\\](\d{2})[/\\](\d{2})", str(jsonl_file))
        if m:
            file_date = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
            if file_date < start - timedelta(days=1) or file_date > end + timedelta(days=1):
                continue

        try:
            lines = jsonl_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        session_cwd = None
        session_git = None
        session_msgs = []

        for line in lines:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # 从 session_meta 提取 cwd/git
            if obj.get("type") == "session_meta":
                payload = obj.get("payload", {})
                session_cwd = payload.get("cwd")
                git_info = payload.get("git", {})
                session_git = git_info.get("branch") if git_info else None

            # 提取用户消息
            if obj.get("type") == "response_item":
                payload = obj.get("payload", {})
                if payload.get("role") == "user":
                    ts = parse_ts(obj.get("timestamp"))
                    if not in_range(ts, start, end):
                        continue
                    content_items = payload.get("content", [])
                    text = ""
                    if isinstance(content_items, list):
                        for c in content_items:
                            if isinstance(c, dict) and c.get("type") == "input_text":
                                text = c.get("text", "")
                                break
                    elif isinstance(content_items, str):
                        text = content_items
                    text = text.strip()
                    if text and not is_private(text) and len(text) > 5:
                        session_msgs.append({
                            "ts": ts.isoformat() if ts else "—",
                            "text": clean_text(text),
                        })

        if session_msgs:
            results.append({
                "source": "Codex Desktop",
                "project": extract_project(session_cwd),
                "git_branch": session_git or "—",
                "session_file": jsonl_file.name[:30],
                "messages": session_msgs,
            })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 4: Claude Code (WSL) — projects/*.jsonl
# ═══════════════════════════════════════════════════════════
def collect_claude_code_wsl(start, end):
    """读取 Claude Code 在 WSL 里按项目组织的会话 JSONL"""
    results = []
    projects_dir = WSL_HOME / ".claude" / "projects"
    if not projects_dir.exists():
        return results

    for proj_dir in projects_dir.iterdir():
        if not proj_dir.is_dir():
            continue

        # 目录名是项目路径转换: -home-dev-... → /home/dev/...
        raw_proj = proj_dir.name
        project_path = raw_proj.replace("-", "/").lstrip("/")
        # 只取最后两段
        parts = [p for p in project_path.split("/") if p]
        project_name = "/".join(parts[-2:]) if len(parts) >= 2 else raw_proj

        for jsonl_file in proj_dir.glob("*.jsonl"):
            try:
                lines = jsonl_file.read_text(encoding="utf-8", errors="ignore").splitlines()
            except Exception:
                continue

            session_msgs = []
            for line in lines:
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if obj.get("type") != "user":
                    continue

                ts = parse_ts(obj.get("timestamp"))
                if not in_range(ts, start, end):
                    continue

                # 提取消息内容
                msg = obj.get("message", {})
                content = msg.get("content", "") if isinstance(msg, dict) else ""
                if isinstance(content, list):
                    text = ""
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text":
                            text = c.get("text", "")
                            break
                else:
                    text = str(content)
                text = text.strip()

                if text and not is_private(text) and len(text) > 5:
                    session_msgs.append({
                        "ts": ts.isoformat() if ts else "—",
                        "text": clean_text(text),
                    })

            if session_msgs:
                results.append({
                    "source": "Claude Code (WSL)",
                    "project": project_name,
                    "session_file": jsonl_file.name[:20],
                    "messages": session_msgs,
                })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 5: Codex CLI archived_sessions (WSL)
# ═══════════════════════════════════════════════════════════
def collect_codex_cli_sessions(start, end):
    """读取 Codex CLI (WSL) 的 archived_sessions/*.jsonl"""
    results = []
    sessions_dir = WSL_HOME / ".codex" / "archived_sessions"
    if not sessions_dir.exists():
        return results

    for jsonl_file in sessions_dir.glob("rollout-*.jsonl"):
        # 从文件名提取日期做粗过滤: rollout-YYYY-MM-DDTHH-MM-SS-...
        m = re.search(r"rollout-(\d{4}-\d{2}-\d{2})", jsonl_file.name)
        if m:
            file_date = parse_ts(m.group(1) + "T00:00:00Z")
            if file_date and not in_range(file_date, start - timedelta(days=1), end + timedelta(days=1)):
                continue

        try:
            lines = jsonl_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        session_cwd = None
        session_git = None
        session_msgs = []

        for line in lines:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # session_meta 提取 cwd/git
            if obj.get("type") == "session_meta":
                payload = obj.get("payload", {})
                session_cwd = payload.get("cwd")
                git_info = payload.get("git", {})
                session_git = git_info.get("branch") if isinstance(git_info, dict) else None

            # 用户消息
            if obj.get("type") == "response_item":
                payload = obj.get("payload", {})
                if payload.get("role") == "user":
                    ts = parse_ts(obj.get("timestamp"))
                    if not in_range(ts, start, end):
                        continue
                    content_items = payload.get("content", [])
                    text = ""
                    if isinstance(content_items, list):
                        for c in content_items:
                            if isinstance(c, dict) and c.get("type") == "input_text":
                                text = c.get("text", "")
                                break
                    text = text.strip()
                    if text and not is_private(text) and len(text) > 5:
                        session_msgs.append({
                            "ts": ts.isoformat() if ts else "—",
                            "text": clean_text(text),
                        })

        if session_msgs:
            results.append({
                "source": "Codex CLI (WSL)",
                "project": extract_project(session_cwd),
                "git_branch": session_git or "—",
                "session_file": jsonl_file.name[:40],
                "messages": session_msgs,
            })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 6: Codex CLI history (WSL) — 命令历史
# ═══════════════════════════════════════════════════════════
def collect_codex_cli_history(start, end):
    """读取 Codex CLI (WSL) 的 history.jsonl — 用户输入的简短记录"""
    results = []
    history_file = WSL_HOME / ".codex" / "history.jsonl"
    if not history_file.exists():
        return results

    try:
        lines = history_file.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return results

    msgs = []
    for line in lines:
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        ts = parse_ts(obj.get("ts"))
        if not in_range(ts, start, end):
            continue

        text = obj.get("text", "").strip()
        if not text or is_private(text) or len(text) < 3:
            continue

        msgs.append({
            "ts": ts.isoformat() if ts else "—",
            "text": clean_text(text, 200),
            "session_id": obj.get("session_id", "")[:8],
        })

    if msgs:
        results.append({
            "source": "Codex CLI history (WSL)",
            "project": "—",
            "messages": msgs,
        })

    return results


# ═══════════════════════════════════════════════════════════
#  数据源 7: Codex CLI memories (WSL) — 精炼记忆
# ═══════════════════════════════════════════════════════════
def collect_codex_cli_memories():
    """读取 Codex CLI (WSL) 的 memory_summary.md — 随时间积累的精炼记忆"""
    mem_file = WSL_HOME / ".codex" / "memories" / "memory_summary.md"
    if not mem_file.exists():
        return None
    try:
        content = mem_file.read_text(encoding="utf-8", errors="ignore").strip()
        return {"source": "Codex CLI memories (WSL)", "content": content}
    except Exception:
        return None


# ═══════════════════════════════════════════════════════════
#  主入口
# ═══════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="AI Weekly Report Collector")
    parser.add_argument("--days", type=int, default=7, help="收集最近 N 天的数据（默认 7）")
    parser.add_argument("--since", type=str, help="起始日期 YYYY-MM-DD")
    parser.add_argument("--week", action="store_true", help="收集本周一到今天")
    parser.add_argument("--output", type=str, default="-", help="输出文件路径（默认 stdout）")
    args = parser.parse_args()

    now = datetime.now(tz=timezone.utc)

    if args.week:
        # 本周一 00:00
        days_since_monday = now.weekday()
        start = (now - timedelta(days=days_since_monday)).replace(hour=0, minute=0, second=0, microsecond=0)
    elif args.since:
        start = parse_ts(args.since + "T00:00:00Z")
    else:
        start = now - timedelta(days=args.days)

    end = now

    print(f"[Collector] 收集范围: {start.strftime('%Y-%m-%d')} → {end.strftime('%Y-%m-%d')}", file=sys.stderr)

    report = {
        "generated_at": now.isoformat(),
        "period": {
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
        "sessions": [],
        "rollout_summaries": [],
        "memories": [],
    }

    # 收集各数据源
    print("[Collector] 读取 Antigravity...", file=sys.stderr)
    report["sessions"].extend(collect_antigravity(start, end))

    print("[Collector] 读取 Codex Desktop rollout_summaries...", file=sys.stderr)
    report["rollout_summaries"].extend(collect_codex_desktop_rollouts(start, end))

    print("[Collector] 读取 Codex Desktop sessions...", file=sys.stderr)
    report["sessions"].extend(collect_codex_desktop_sessions(start, end))

    print("[Collector] 读取 Claude Code (WSL)...", file=sys.stderr)
    report["sessions"].extend(collect_claude_code_wsl(start, end))

    print("[Collector] 读取 Codex CLI archived_sessions (WSL)...", file=sys.stderr)
    report["sessions"].extend(collect_codex_cli_sessions(start, end))

    print("[Collector] 读取 Codex CLI history (WSL)...", file=sys.stderr)
    report["sessions"].extend(collect_codex_cli_history(start, end))

    print("[Collector] 读取 Codex CLI memories (WSL)...", file=sys.stderr)
    mem = collect_codex_cli_memories()
    if mem:
        report["memories"].append(mem)

    # 统计
    total_sessions = len(report["sessions"])
    total_rollouts = len(report["rollout_summaries"])
    total_msgs = sum(len(s.get("messages", [])) for s in report["sessions"])
    print(f"[Collector] 完成: {total_sessions} 个会话, {total_msgs} 条用户消息, {total_rollouts} 条 rollout 摘要", file=sys.stderr)

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output == "-":
        print(output)
    else:
        Path(args.output).write_text(output, encoding="utf-8")
        print(f"[Collector] 已写入: {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
