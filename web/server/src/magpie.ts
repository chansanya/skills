import { exec, execSync } from 'node:child_process'
import fs from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, readlink, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface MagpieJunction {
  agentKey: string
  linkPath: string
  targetPath: string
  skillName: string
}

export interface MagpieStatus {
  /** Magpie 是否被检测到 */
  detected: boolean
  /** Magpie library skills 目录的绝对路径（本地文件系统访问路径） */
  libraryPath: string | null
  /** 显示用路径（Windows 格式，例如 C:\Users\xxx\.config\magpie\library\skills） */
  displayPath: string | null
  /** Magpie 管理的 skill 名称列表（已存在于 library 中的） */
  managedSkills: string[]
  /** Magpie 版本号（从 gateway.json 读取） */
  version: string | null
  /** Gateway 是否可达 */
  gatewayOnline: boolean
  /** 各 Agent 目录中被 Magpie Junction 管理的 skill 条目 */
  junctions: MagpieJunction[]
  /** Magpie CLI 是否可用 */
  cliAvailable: boolean
}

export interface MigratableSkill {
  agentKey: string
  agentLabel: string
  skillName: string
  path: string
  displayPath: string
  existsInMagpieLibrary: boolean
}

const LOCAL_HOME = os.homedir()

function checkIsWSL(): boolean {
  if (process.platform !== 'linux') return false
  return (
    process.env.WSL_DISTRO_NAME !== undefined ||
    process.env.WSL_INTEROP !== undefined ||
    (fs.existsSync('/proc/version') &&
      fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'))
  )
}

interface MagpiePaths {
  configDir: string
  libraryDir: string
  gatewayJson: string
  displayPath: string
  isCrossEnv: boolean
}

function resolveMagpiePaths(): MagpiePaths | null {
  if (process.platform === 'win32') {
    const configDir = path.join(LOCAL_HOME, '.config', 'magpie')
    const libraryDir = path.join(configDir, 'library', 'skills')
    return {
      configDir,
      libraryDir,
      gatewayJson: path.join(configDir, 'gateway.json'),
      displayPath: `${LOCAL_HOME}\\.config\\magpie\\library\\skills`,
      isCrossEnv: false,
    }
  }

  if (checkIsWSL()) {
    try {
      const rawWin = execSync('cmd.exe /c "echo %USERPROFILE%"', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim()

      if (rawWin && !rawWin.includes('%')) {
        const localMnt = execSync(`wslpath -u "${rawWin}"`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 3000,
        }).trim()

        if (localMnt && fs.existsSync(localMnt)) {
          const configDir = path.join(localMnt, '.config', 'magpie')
          const libraryDir = path.join(configDir, 'library', 'skills')
          return {
            configDir,
            libraryDir,
            gatewayJson: path.join(configDir, 'gateway.json'),
            displayPath: `${rawWin}\\.config\\magpie\\library\\skills`,
            isCrossEnv: true,
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // macOS / 原生 Linux
  const configDir = path.join(LOCAL_HOME, '.config', 'magpie')
  const libraryDir = path.join(configDir, 'library', 'skills')
  return {
    configDir,
    libraryDir,
    gatewayJson: path.join(configDir, 'gateway.json'),
    displayPath: `~/.config/magpie/library/skills`,
    isCrossEnv: false,
  }
}

const AGENT_DEFS = [
  { key: 'claude-code', label: 'Claude Code', rel: '.claude/skills' },
  { key: 'codex', label: 'Codex', rel: '.codex/skills' },
  { key: 'antigravity', label: 'Antigravity', rel: '.gemini/antigravity/skills' },
  { key: 'antigravity-config', label: 'Antigravity (config)', rel: '.gemini/config/skills' },
  { key: 'cursor', label: 'Cursor', rel: '.cursor/skills' },
]

function getAgentDirs(paths: MagpiePaths): { key: string; label: string; dir: string; displayPrefix: string }[] {
  const isWSL = checkIsWSL()
  const baseDir = isWSL && paths.isCrossEnv ? path.dirname(path.dirname(paths.configDir)) : LOCAL_HOME

  return AGENT_DEFS.map((def) => ({
    key: def.key,
    label: def.label,
    dir: path.join(baseDir, def.rel),
    displayPrefix: paths.displayPath.replace(/\\\.config\\magpie\\library\\skills$/, `\\${def.rel.replace(/\//g, '\\')}`),
  }))
}

/**
 * 寻找 Magpie CLI 可执行文件
 */
export function resolveMagpieCli(): string | null {
  const isWSL = checkIsWSL()

  if (process.platform === 'win32') {
    const candidates = [
      path.join(LOCAL_HOME, 'AppData', 'Local', 'Programs', 'magpie', 'magpie.com'),
      path.join(LOCAL_HOME, 'AppData', 'Local', 'Programs', 'magpie', 'magpie.exe'),
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'magpie', 'magpie.com')
        : '',
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'magpie', 'magpie.exe')
        : '',
    ].filter(Boolean)

    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }

    try {
      execSync('where magpie', { stdio: 'ignore', timeout: 1000 })
      return 'magpie'
    } catch {
      return null
    }
  }

  if (isWSL) {
    const paths = resolveMagpiePaths()
    if (paths && paths.isCrossEnv) {
      const userMnt = path.dirname(path.dirname(paths.configDir))
      const winCliCandidate = path.join(userMnt, 'AppData', 'Local', 'Programs', 'magpie', 'magpie.com')
      const winExeCandidate = path.join(userMnt, 'AppData', 'Local', 'Programs', 'magpie', 'magpie.exe')
      const winUser = paths.displayPath.split('\\.config')[0]

      if (fs.existsSync(winCliCandidate)) {
        return `${winUser}\\AppData\\Local\\Programs\\magpie\\magpie.com`
      }
      if (fs.existsSync(winExeCandidate)) {
        return `${winUser}\\AppData\\Local\\Programs\\magpie\\magpie.exe`
      }
    }
  }

  return null
}

/**
 * 扫描各 Agent 目录中的 Junction / symlink 条目
 */
async function scanJunctions(paths: MagpiePaths): Promise<MagpieJunction[]> {
  const junctions: MagpieJunction[] = []
  const normalizedLibrary = path.resolve(paths.libraryDir)
  const agentDirs = getAgentDirs(paths)

  for (const agent of agentDirs) {
    if (!fs.existsSync(agent.dir)) continue

    let entries
    try {
      entries = await readdir(agent.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      const fullPath = path.join(agent.dir, entry.name)
      try {
        const stat = await lstat(fullPath)
        if (!stat.isSymbolicLink()) continue

        const target = await readlink(fullPath)
        const normalizedTarget = path.resolve(target)
        if (
          normalizedTarget === normalizedLibrary ||
          normalizedTarget.startsWith(normalizedLibrary + path.sep) ||
          target.includes('magpie')
        ) {
          junctions.push({
            agentKey: agent.key,
            linkPath: fullPath,
            targetPath: normalizedTarget,
            skillName: entry.name,
          })
        }
      } catch {
        // broken link
      }
    }
  }

  return junctions
}

/**
 * 检测 Magpie 状态
 */
export async function detectMagpie(): Promise<MagpieStatus> {
  const paths = resolveMagpiePaths()
  const result: MagpieStatus = {
    detected: false,
    libraryPath: null,
    displayPath: null,
    managedSkills: [],
    version: null,
    gatewayOnline: false,
    junctions: [],
    cliAvailable: false,
  }

  if (!paths || !fs.existsSync(paths.libraryDir)) {
    return result
  }

  result.detected = true
  result.libraryPath = paths.libraryDir
  result.displayPath = paths.displayPath

  try {
    const entries = await readdir(paths.libraryDir, { withFileTypes: true })
    result.managedSkills = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    // ignore
  }

  try {
    const gwRaw = await readFile(paths.gatewayJson, 'utf8')
    const gw = JSON.parse(gwRaw)
    result.version = typeof gw.version === 'string' ? gw.version : null
  } catch {
    // ignore
  }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1000)
    const res = await fetch('http://127.0.0.1:3425', { signal: ctrl.signal })
    clearTimeout(timer)
    result.gatewayOnline = res.ok || res.status < 500
  } catch {
    result.gatewayOnline = false
  }

  result.junctions = await scanJunctions(paths)
  result.cliAvailable = resolveMagpieCli() !== null

  return result
}

// ── 缓存 ───────────────────────────────────────────────

let cachedStatus: MagpieStatus | null = null
let cacheTimestamp = 0
const CACHE_TTL = 30_000

export async function getMagpieStatus(force = false): Promise<MagpieStatus> {
  if (!force && cachedStatus && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cachedStatus
  }
  cachedStatus = await detectMagpie()
  cacheTimestamp = Date.now()
  return cachedStatus
}

export function invalidateMagpieCache(): void {
  cachedStatus = null
  cacheTimestamp = 0
}

/**
 * 触发 Magpie library 分发（同步到各 Agent）
 */
export async function syncMagpieLibrary(): Promise<{ success: boolean; message: string }> {
  const cli = resolveMagpieCli()
  if (!cli) {
    return {
      success: false,
      message: '未找到 Magpie CLI 可执行文件，请在 Magpie 界面中手动点击刷新分发。',
    }
  }

  const isWSL = checkIsWSL()
  return new Promise((resolve) => {
    const cmd = isWSL && cli.includes('\\')
      ? `cmd.exe /c "${cli} library sync"`
      : `"${cli}" library sync`

    exec(cmd, { timeout: 10000 }, (error, stdout, stderr) => {
      invalidateMagpieCache()
      if (error) {
        resolve({
          success: false,
          message: stderr?.trim() || error.message || '分发命令执行失败',
        })
      } else {
        const out = stdout?.trim() || '已通知 Magpie 同步分发'
        resolve({
          success: true,
          message: out,
        })
      }
    })
  })
}

/**
 * 扫描各 Agent 目录下尚未被 Magpie 管理（非 Junction、独立真实目录）的 Skills
 */
export async function scanMigratableSkills(): Promise<MigratableSkill[]> {
  const paths = resolveMagpiePaths()
  if (!paths || !fs.existsSync(paths.libraryDir)) return []

  const status = await getMagpieStatus()
  const managedSet = new Set(status.managedSkills)
  const junctionMap = new Set(status.junctions.map((j) => `${j.agentKey}:${j.skillName}`))

  const migratable: MigratableSkill[] = []
  const agentDirs = getAgentDirs(paths)

  for (const agent of agentDirs) {
    if (!fs.existsSync(agent.dir)) continue

    let entries
    try {
      entries = await readdir(agent.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.')) continue

      const fullPath = path.join(agent.dir, entry.name)
      try {
        const stat = await lstat(fullPath)
        // 如果是符号链接/Junction，检查是不是指向 Magpie
        if (stat.isSymbolicLink()) {
          const target = await readlink(fullPath)
          if (target.includes('magpie')) continue // 已经是 Magpie 管理的，不需迁移
        }

        if (junctionMap.has(`${agent.key}:${entry.name}`)) continue

        migratable.push({
          agentKey: agent.key,
          agentLabel: agent.label,
          skillName: entry.name,
          path: fullPath,
          displayPath: `${agent.displayPrefix}\\${entry.name}`,
          existsInMagpieLibrary: managedSet.has(entry.name),
        })
      } catch {
        // ignore
      }
    }
  }

  return migratable
}

/**
 * 执行迁移：将 Agent 目录下的独立 Skill 迁入 Magpie Library，并触发 Magpie 分发
 */
export async function migrateSkillToMagpie(
  agentKey: string,
  skillName: string,
  overwrite = false,
): Promise<{ success: boolean; message: string }> {
  const paths = resolveMagpiePaths()
  if (!paths || !fs.existsSync(paths.libraryDir)) {
    return { success: false, message: '未找到 Magpie Library 目录' }
  }

  const agentDirs = getAgentDirs(paths)
  const agent = agentDirs.find((a) => a.key === agentKey)
  if (!agent) {
    return { success: false, message: `未知的 Agent: ${agentKey}` }
  }

  const sourceDir = path.join(agent.dir, skillName)
  const destDir = path.join(paths.libraryDir, skillName)

  if (!fs.existsSync(sourceDir)) {
    return { success: false, message: `源 Skill 目录不存在: ${sourceDir}` }
  }

  const destExists = fs.existsSync(destDir)

  try {
    // 1. 如果统一库中不存在，将源目录完整复制入库；若已存在且勾选了 overwrite，则覆盖统一库
    if (!destExists || overwrite) {
      await mkdir(path.dirname(destDir), { recursive: true })
      await cp(sourceDir, destDir, { recursive: true })
    }

    // 2. 清理原 Agent 目录下的独立实体目录，以便 Magpie 创建 Junction
    await rm(sourceDir, { recursive: true, force: true })

    // 3. 触发 Magpie library sync
    const syncRes = await syncMagpieLibrary()

    const actionText = !destExists
      ? '已迁入统一库并建立链接'
      : overwrite
        ? '已覆盖统一库并建立链接'
        : '已安全接入统一库并建立链接（保留库中现有版本）'

    return {
      success: true,
      message: syncRes.success
        ? `「${skillName}」${actionText} (${syncRes.message})`
        : `「${skillName}」${actionText}，但分发提示: ${syncRes.message}`,
    }
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}
