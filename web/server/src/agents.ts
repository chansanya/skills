import { execSync } from 'node:child_process'
import { cp, mkdir, realpath, symlink } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO_ROOT } from './config.js'
import { badRequest, HttpError } from './errors.js'
import { assertNoSymlinks, atomicReplace, exists, isInside } from './fsutil.js'
import { skillDirs } from './skills.js'

export type SyncMode = 'copy' | 'symlink'

export interface AgentTarget {
  id: string
  label: string
  env: 'wsl' | 'host'
  envLabel: string
  path: string
  displayPath: string
  parentExists: boolean
  exists: boolean
  isCrossEnv: boolean
}

export interface SkillSyncResult {
  skill: string
  status: 'synced' | 'skipped' | 'error'
  message?: string
}

export interface TargetSyncResult {
  id: string
  label: string
  env: 'wsl' | 'host'
  path: string
  displayPath: string
  error?: string
  skills: SkillSyncResult[]
}

interface TargetItem {
  id: string
  label: string
  env: 'wsl' | 'host'
  path: string
  displayPath: string
  isCrossEnv: boolean
}

interface SyncRequest {
  skills: string[]
  targets: TargetItem[]
  overwrite: boolean
  mode: SyncMode
}

const LOCAL_HOME = os.homedir()
const MAX_TARGETS = 30
const MAX_SKILLS = 500

const AGENT_DEFS = [
  { key: 'claude-code', label: 'Claude Code', rel: '.claude/skills' },
  { key: 'codex', label: 'Codex', rel: '.codex/skills' },
  { key: 'agents', label: 'Agents (Universal)', rel: '.agents/skills' },
  { key: 'antigravity', label: 'Antigravity', rel: '.gemini/antigravity/skills' },
  { key: 'antigravity-config', label: 'Antigravity (config)', rel: '.gemini/config/skills' },
  { key: 'cursor', label: 'Cursor', rel: '.cursor/skills' },
]

interface HostInfo {
  winProfile: string
  localPath: string
}

interface WslInfo {
  uncPath: string
}

let cachedHostInfo: HostInfo | null | undefined
let cachedWslInfo: WslInfo | null | undefined

function checkIsWSL(): boolean {
  if (process.platform !== 'linux') return false
  return (
    process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.WSL_INTEROP !== undefined ||
    (fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'))
  )
}

function detectHostInfo(): HostInfo | null {
  if (cachedHostInfo !== undefined) return cachedHostInfo

  if (process.platform === 'win32') {
    cachedHostInfo = { winProfile: LOCAL_HOME, localPath: LOCAL_HOME }
    return cachedHostInfo
  }

  // 仅在 WSL 下嗅探 Windows 宿主环境，macOS 和原生 Linux 不需要
  if (!checkIsWSL()) {
    cachedHostInfo = null
    return null
  }

  try {
    const rawWin = execSync('cmd.exe /c "echo %USERPROFILE%"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim()

    if (!rawWin || rawWin.includes('%')) {
      cachedHostInfo = null
      return null
    }

    const localMnt = execSync(`wslpath -u "${rawWin}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim()

    if (localMnt && fs.existsSync(localMnt)) {
      cachedHostInfo = { winProfile: rawWin, localPath: localMnt }
      return cachedHostInfo
    }
  } catch {
    // ignore
  }

  cachedHostInfo = null
  return null
}

function detectWslFromWindows(): WslInfo | null {
  if (cachedWslInfo !== undefined) return cachedWslInfo

  // 仅在 Windows 环境下嗅探 WSL，macOS 和原生 Linux 不需要
  if (process.platform !== 'win32') {
    cachedWslInfo = null
    return null
  }

  try {
    const raw = execSync('wsl.exe -e sh -c "wslpath -w ~"', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim()

    if (raw && fs.existsSync(raw)) {
      cachedWslInfo = { uncPath: raw }
      return cachedWslInfo
    }
  } catch {
    // wsl 未安装或未启动
  }

  cachedWslInfo = null
  return null
}

function getAllowedHomes(): string[] {
  const homes = [LOCAL_HOME]
  const host = detectHostInfo()
  if (host && host.localPath !== LOCAL_HOME && !homes.includes(host.localPath)) {
    homes.push(host.localPath)
  }
  const wsl = detectWslFromWindows()
  if (wsl && wsl.uncPath !== LOCAL_HOME && !homes.includes(wsl.uncPath)) {
    homes.push(wsl.uncPath)
  }
  return homes
}

let syncing = false

function buildAllPresets(): AgentTarget[] {
  const targets: AgentTarget[] = []
  const isWSL = checkIsWSL()

  if (isWSL) {
    // 1. WSL 自身环境（原生本地，不跨环境）
    for (const def of AGENT_DEFS) {
      const fullPath = path.join(LOCAL_HOME, def.rel)
      targets.push({
        id: `wsl:${def.key}`,
        label: def.label,
        env: 'wsl',
        envLabel: 'WSL',
        path: fullPath,
        displayPath: `~/${def.rel}`,
        parentExists: false,
        exists: false,
        isCrossEnv: false,
      })
    }

    // 2. 外部宿主 Windows 主机环境（跨环境，仅支持复制）
    const host = detectHostInfo()
    if (host) {
      for (const def of AGENT_DEFS) {
        const fullPath = path.join(host.localPath, def.rel)
        const winDisplay = `${host.winProfile}\\${def.rel.replace(/\//g, '\\')}`
        targets.push({
          id: `host:${def.key}`,
          label: def.label,
          env: 'host',
          envLabel: '主机',
          path: fullPath,
          displayPath: winDisplay,
          parentExists: false,
          exists: false,
          isCrossEnv: true, // 从 WSL 下发到宿主 Windows，属于跨环境
        })
      }
    }
  } else if (process.platform === 'win32') {
    // 运行在 Windows 环境中：
    // 1. Windows 本地主机环境（原生本地）
    for (const def of AGENT_DEFS) {
      const fullPath = path.join(LOCAL_HOME, def.rel)
      targets.push({
        id: `host:${def.key}`,
        label: def.label,
        env: 'host',
        envLabel: '主机',
        path: fullPath,
        displayPath: `${LOCAL_HOME}\\${def.rel.replace(/\//g, '\\')}`,
        parentExists: false,
        exists: false,
        isCrossEnv: false,
      })
    }

    // 2. 嗅探是否有 WSL 环境（跨环境，仅支持复制）
    const wsl = detectWslFromWindows()
    if (wsl) {
      for (const def of AGENT_DEFS) {
        const fullPath = path.join(wsl.uncPath, def.rel)
        targets.push({
          id: `wsl:${def.key}`,
          label: def.label,
          env: 'wsl',
          envLabel: 'WSL',
          path: fullPath,
          displayPath: `~/${def.rel}`,
          parentExists: false,
          exists: false,
          isCrossEnv: true, // 从 Windows 下发到 WSL UNC 路径，属于跨环境
        })
      }
    }
  } else {
    // macOS 或原生 Linux：不嗅探 WSL，只有唯一的「主机」选项
    for (const def of AGENT_DEFS) {
      const fullPath = path.join(LOCAL_HOME, def.rel)
      targets.push({
        id: `host:${def.key}`,
        label: def.label,
        env: 'host',
        envLabel: '主机',
        path: fullPath,
        displayPath: `~/${def.rel}`,
        parentExists: false,
        exists: false,
        isCrossEnv: false, // 原生同主机，不跨环境，支持软链接
      })
    }
  }

  return targets
}

export async function listTargets(): Promise<AgentTarget[]> {
  const presets = buildAllPresets()
  return Promise.all(
    presets.map(async (p) => ({
      ...p,
      parentExists: await exists(path.dirname(p.path)),
      exists: await exists(p.path),
    })),
  )
}

function resolveCustomTarget(raw: string): TargetItem {
  const input = raw.trim()
  if (!input || input.length > 500 || input.includes('\0')) throw badRequest(`非法的目标路径：${raw}`)
  const isWSL = checkIsWSL()
  const isWin = process.platform === 'win32'
  const host = detectHostInfo()
  const wsl = detectWslFromWindows()

  let abs: string
  let display: string
  let env: 'wsl' | 'host' = isWSL ? 'wsl' : 'host'
  let isCrossEnv = false

  if (isWSL) {
    // 运行在 WSL 内部
    if (/^[a-zA-Z]:[/\\]/.test(input)) {
      if (!host) throw badRequest('未检测到 Windows 主机环境，不支持指定 Windows 盘符路径')
      try {
        abs = execSync(`wslpath -u "${input}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      } catch {
        throw badRequest(`无法解析 Windows 路径：${input}`)
      }
      display = input
      env = 'host'
      isCrossEnv = true
    } else {
      const normalized = input.replace(/\\/g, '/')
      if (normalized.split('/').includes('..')) throw badRequest(`目标路径不能包含 ..：${raw}`)

      if (normalized === '~' || normalized.startsWith('~/')) {
        abs = path.join(LOCAL_HOME, normalized.slice(1))
        display = normalized
      } else if (path.isAbsolute(input)) {
        abs = path.resolve(input)
        display = abs
      } else {
        throw badRequest(`目标路径必须以 ~/ 或绝对路径（如 C:\\...）开头：${raw}`)
      }
    }
  } else if (isWin) {
    // 运行在 Windows 上
    if (/^\\\\wsl(\.localhost)?\\/i.test(input)) {
      abs = path.resolve(input)
      display = input
      env = 'wsl'
      isCrossEnv = true
    } else if (/^[a-zA-Z]:[/\\]/.test(input)) {
      abs = path.resolve(input)
      display = input
      env = 'host'
      isCrossEnv = false
    } else if (input === '~' || input.startsWith('~/') || input.startsWith('~\\')) {
      if (wsl) {
        const rel = input.slice(1).replace(/^[/\\]+/, '')
        abs = path.join(wsl.uncPath, rel)
        display = `~/${rel.replace(/\\/g, '/')}`
        env = 'wsl'
        isCrossEnv = true
      } else {
        abs = path.join(LOCAL_HOME, input.slice(1))
        display = abs
        env = 'host'
        isCrossEnv = false
      }
    } else if (path.isAbsolute(input)) {
      abs = path.resolve(input)
      display = abs
      env = 'host'
      isCrossEnv = false
    } else {
      throw badRequest(`目标路径格式无效：${raw}`)
    }
  } else {
    // macOS 或原生 Linux
    const normalized = input.replace(/\\/g, '/')
    if (normalized.split('/').includes('..')) throw badRequest(`目标路径不能包含 ..：${raw}`)

    if (normalized === '~' || normalized.startsWith('~/')) {
      abs = path.join(LOCAL_HOME, normalized.slice(1))
      display = normalized
    } else if (path.isAbsolute(input)) {
      abs = path.resolve(input)
      display = abs
    } else {
      throw badRequest(`目标路径必须以 ~/ 或绝对路径开头：${raw}`)
    }
    env = 'host'
    isCrossEnv = false
  }

  const allowed = getAllowedHomes()
  const insideAllowed = allowed.some((h) => isInside(abs, h) || abs === h)
  if (!insideAllowed) {
    throw badRequest(`目标路径必须位于用户主目录内：${raw}`)
  }
  if (abs === REPO_ROOT || isInside(abs, REPO_ROOT) || isInside(REPO_ROOT, abs)) {
    throw badRequest(`目标路径不能与 Skill 仓库重叠：${raw}`)
  }

  return {
    id: `custom:${input}`,
    label: '自定义路径',
    env,
    path: abs,
    displayPath: display,
    isCrossEnv,
  }
}

export async function validateAgentSync(body: unknown): Promise<SyncRequest> {
  const input = (body ?? {}) as Record<string, unknown>

  if (!Array.isArray(input.skills) || !input.skills.length) throw badRequest('请至少选择一个 Skill')
  if (input.skills.length > MAX_SKILLS) throw badRequest('选择的 Skill 过多')
  const available = new Set(await skillDirs())
  const skills = [...new Set(input.skills)]
  for (const s of skills) {
    if (typeof s !== 'string' || !available.has(s)) throw badRequest(`未找到 Skill：${String(s)}`)
  }

  if (!Array.isArray(input.targets) || !input.targets.length) throw badRequest('请至少选择一个目标目录')
  if (input.targets.length > MAX_TARGETS) throw badRequest('目标目录过多')

  const presets = buildAllPresets()
  const targets: TargetItem[] = []
  for (const t of input.targets) {
    if (typeof t !== 'string') throw badRequest('目标目录格式错误')
    const preset = presets.find((p) => p.id === t)
    const target = preset
      ? {
          id: preset.id,
          label: preset.label,
          env: preset.env,
          path: preset.path,
          displayPath: preset.displayPath,
          isCrossEnv: preset.isCrossEnv,
        }
      : resolveCustomTarget(t)

    if (!targets.some((x) => x.path === target.path)) targets.push(target)
  }

  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw badRequest('overwrite 必须为布尔值')
  const mode = input.mode ?? 'symlink'
  if (mode !== 'copy' && mode !== 'symlink') throw badRequest(`不支持的同步方式：${String(mode)}`)
  if (syncing) throw new HttpError(409, '已有同步任务正在进行')

  return { skills: skills as string[], targets, overwrite: input.overwrite === true, mode }
}

async function assertRealInsideAllowed(dir: string): Promise<void> {
  const realDir = await realpath(dir)
  const allowed = getAllowedHomes()
  for (const h of allowed) {
    const realH = await realpath(h).catch(() => h)
    if (isInside(realDir, realH) || realDir === realH) return
  }
  throw new Error('目标目录不在允许的用户主目录内')
}

async function syncSkill(skill: string, root: string, isCrossEnv: boolean, req: SyncRequest): Promise<SkillSyncResult> {
  const source = path.join(REPO_ROOT, skill)
  const dest = path.join(root, skill)
  try {
    if (!req.overwrite && (await exists(dest))) return { skill, status: 'skipped', message: '已存在，未覆盖' }
    await assertNoSymlinks(source)

    // 对于跨环境（从 WSL 写入 Windows NTFS 宿主目录），若使用 symlink，Windows 原生进程可能无法解析 Linux 绝对路径，
    // 因此跨环境时自动使用物理复制以确保 Windows 原生 Agent 100% 兼容。
    const effectiveMode = isCrossEnv && req.mode === 'symlink' ? 'copy' : req.mode

    const result = await atomicReplace(dest, req.overwrite, (staged) =>
      effectiveMode === 'symlink'
        ? symlink(source, staged, 'dir')
        : cp(source, staged, { recursive: true, dereference: false }),
    )

    let msg = result === 'replaced' ? '已覆盖' : '已同步'
    if (isCrossEnv && req.mode === 'symlink') {
      msg += ' (跨主机已转复制)'
    }
    return { skill, status: 'synced', message: msg }
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return { skill, status: 'skipped', message: '已存在，未覆盖' }
    return { skill, status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

export async function syncToAgents(req: SyncRequest): Promise<TargetSyncResult[]> {
  if (syncing) throw new HttpError(409, '已有同步任务正在进行')
  syncing = true
  try {
    const results: TargetSyncResult[] = []
    for (const target of req.targets) {
      const entry: TargetSyncResult = {
        id: target.id,
        label: target.label,
        env: target.env,
        path: target.path,
        displayPath: target.displayPath,
        skills: [],
      }
      results.push(entry)
      try {
        await mkdir(target.path, { recursive: true })
        await assertRealInsideAllowed(target.path)
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err)
        continue
      }
      for (const skill of req.skills) {
        entry.skills.push(await syncSkill(skill, target.path, target.isCrossEnv, req))
      }
    }
    return results
  } finally {
    syncing = false
  }
}
