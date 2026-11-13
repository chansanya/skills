import { cp, mkdir, realpath, symlink } from 'node:fs/promises'
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
  path: string
  displayPath: string
  parentExists: boolean
  exists: boolean
}

export interface SkillSyncResult {
  skill: string
  status: 'synced' | 'skipped' | 'error'
  message?: string
}

export interface TargetSyncResult {
  id: string
  label: string
  path: string
  displayPath: string
  error?: string
  skills: SkillSyncResult[]
}

interface SyncRequest {
  skills: string[]
  targets: { id: string; label: string; path: string }[]
  overwrite: boolean
  mode: SyncMode
}

const HOME = os.homedir()
const MAX_TARGETS = 20
const MAX_SKILLS = 500

const PRESETS = [
  { id: 'claude-code', label: 'Claude Code', rel: '.claude/skills' },
  { id: 'codex', label: 'Codex', rel: '.codex/skills' },
  { id: 'agents', label: 'Agents (Universal)', rel: '.agents/skills' },
  { id: 'antigravity', label: 'Antigravity', rel: '.gemini/antigravity/skills' },
  { id: 'antigravity-config', label: 'Antigravity (config)', rel: '.gemini/config/skills' },
  { id: 'cursor', label: 'Cursor', rel: '.cursor/skills' },
].map((p) => ({ id: p.id, label: p.label, path: path.join(HOME, p.rel) }))

let syncing = false

const displayPath = (abs: string): string =>
  isInside(abs, HOME) ? `~/${path.relative(HOME, abs).split(path.sep).join('/')}` : abs

export async function listTargets(): Promise<AgentTarget[]> {
  return Promise.all(
    PRESETS.map(async (p) => ({
      ...p,
      displayPath: displayPath(p.path),
      parentExists: await exists(path.dirname(p.path)),
      exists: await exists(p.path),
    })),
  )
}

function resolveCustomTarget(raw: string): string {
  const input = raw.trim()
  if (!input || input.length > 500 || input.includes('\0')) throw badRequest(`非法的目标路径：${raw}`)
  const normalized = input.replace(/\\/g, '/')
  if (normalized.split('/').includes('..')) throw badRequest(`目标路径不能包含 ..：${raw}`)

  let abs: string
  if (normalized === '~' || normalized.startsWith('~/')) abs = path.join(HOME, normalized.slice(1))
  else if (path.isAbsolute(input)) abs = path.resolve(input)
  else throw badRequest(`目标路径必须以 ~/ 开头或为绝对路径：${raw}`)

  if (!isInside(abs, HOME)) throw badRequest(`目标路径必须位于用户主目录内：${raw}`)
  if (abs === REPO_ROOT || isInside(abs, REPO_ROOT) || isInside(REPO_ROOT, abs)) {
    throw badRequest(`目标路径不能与 Skill 仓库重叠：${raw}`)
  }
  return abs
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
  const targets: SyncRequest['targets'] = []
  for (const t of input.targets) {
    if (typeof t !== 'string') throw badRequest('目标目录格式错误')
    const preset = PRESETS.find((p) => p.id === t)
    const target = preset ?? { id: `custom:${t.trim()}`, label: '自定义', path: resolveCustomTarget(t) }
    if (!targets.some((x) => x.path === target.path)) targets.push(target)
  }

  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw badRequest('overwrite 必须为布尔值')
  const mode = input.mode ?? 'symlink'
  if (mode !== 'copy' && mode !== 'symlink') throw badRequest(`不支持的同步方式：${String(mode)}`)
  if (syncing) throw new HttpError(409, '已有同步任务正在进行')

  return { skills: skills as string[], targets, overwrite: input.overwrite === true, mode }
}

async function assertRealInsideHome(dir: string): Promise<void> {
  const [realDir, realHome] = await Promise.all([realpath(dir), realpath(HOME)])
  if (!isInside(realDir, realHome)) throw new Error('目标目录（解析符号链接后）不在用户主目录内')
}

async function syncSkill(skill: string, root: string, req: SyncRequest): Promise<SkillSyncResult> {
  const source = path.join(REPO_ROOT, skill)
  const dest = path.join(root, skill)
  try {
    if (!req.overwrite && (await exists(dest))) return { skill, status: 'skipped', message: '已存在，未覆盖' }
    await assertNoSymlinks(source)
    const result = await atomicReplace(dest, req.overwrite, (staged) =>
      req.mode === 'symlink' ? symlink(source, staged, 'dir') : cp(source, staged, { recursive: true, dereference: false }),
    )
    return { skill, status: 'synced', message: result === 'replaced' ? '已覆盖' : '已创建' }
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
      const entry: TargetSyncResult = { ...target, displayPath: displayPath(target.path), skills: [] }
      results.push(entry)
      try {
        await mkdir(target.path, { recursive: true })
        await assertRealInsideHome(target.path)
      } catch (err) {
        entry.error = err instanceof Error ? err.message : String(err)
        continue
      }
      for (const skill of req.skills) entry.skills.push(await syncSkill(skill, target.path, req))
    }
    return results
  } finally {
    syncing = false
  }
}
