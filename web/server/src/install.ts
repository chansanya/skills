import { cp, lstat, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { IGNORED_DIRS, REPO_ROOT, SKILL_NAME_RE } from './config.js'
import { badRequest, HttpError } from './errors.js'
import { assertNoSymlinks, atomicReplace, exists } from './fsutil.js'
import { run, stripAnsi } from './process.js'
import { parseFrontmatter, skillExists } from './skills.js'

export interface InstallRequest {
  repo: string
  skill: string
  overwrite: boolean
}

export interface InspectResult {
  inspectId: string
  name: string
  description: string
  repo: string
  files: string[]
  existsLocally: boolean
}

interface CachedInspect {
  id: string
  repo: string
  skill: string
  name: string
  description: string
  files: string[]
  tmpDir: string
  sourceDir: string
  createdAt: number
}

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/
const INSTALL_TIMEOUT_MS = 5 * 60_000
const CACHE_TTL_MS = 10 * 60_000

let installing = false
const inspectCache = new Map<string, CachedInspect>()

function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [id, item] of inspectCache.entries()) {
    if (now - item.createdAt > CACHE_TTL_MS) {
      inspectCache.delete(id)
      rm(item.tmpDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function parseSource(raw: string): { repo?: string; skill?: string } {
  const source = raw.trim()
  if (!source) return {}

  const url = /^https?:\/\/(?:www\.)?(github\.com|skills\.sh)\/([^/\s]+)\/([^/\s#?]+)(?:\/([^\s#?]+))?/i.exec(source)
  if (url) {
    const [, host, owner, repo, rest] = url
    const repoName = repo.replace(/\.git$/, '')
    return { repo: `${owner}/${repoName}`, skill: host.toLowerCase() === 'skills.sh' && rest ? rest.split('/')[0] : undefined }
  }
  return { repo: source.replace(/\.git$/, '') }
}

export function parseAndValidateSource(body: unknown): { repo: string; skill: string } {
  const input = (body ?? {}) as Record<string, unknown>
  if (typeof input.source !== 'string' || !input.source.trim()) throw badRequest('source 不能为空')
  if (input.source.length > 500) throw badRequest('source 过长')

  const parsed = parseSource(input.source)
  const skill = (typeof input.skill === 'string' && input.skill.trim()) || parsed.skill
  const repo = parsed.repo

  if (!repo || !REPO_RE.test(repo)) throw badRequest('无法识别仓库，请输入 owner/repo、GitHub 地址或 skills.sh 链接')
  if (!skill) throw badRequest('请指定要安装的 Skill 名称')
  if (!SKILL_NAME_RE.test(skill) || skill.includes('..')) throw badRequest(`非法的 Skill 名称：${skill}`)
  if (IGNORED_DIRS.has(skill)) throw badRequest(`Skill 名称与保留目录冲突：${skill}`)

  return { repo, skill }
}

export async function validateInstall(body: unknown): Promise<InstallRequest> {
  const { repo, skill } = parseAndValidateSource(body)
  const input = (body ?? {}) as Record<string, unknown>
  const overwrite = input.overwrite === true
  if (!overwrite && (await skillExists(skill))) throw new HttpError(409, `Skill「${skill}」已存在，如需覆盖请勾选「覆盖」`)
  if (installing) throw new HttpError(409, '已有安装任务正在进行')
  return { repo, skill, overwrite }
}

async function isDir(p: string): Promise<boolean> {
  return lstat(p).then((s) => s.isDirectory(), () => false)
}

async function listFilesRecursive(dir: string, rel = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const e of entries) {
    const nextRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      files.push(...(await listFilesRecursive(path.join(dir, e.name), nextRel)))
    } else if (e.isFile()) {
      files.push(nextRel)
    }
  }
  return files.sort()
}

async function validateAndExtractSkillInfo(
  sourceDir: string,
  expectedName: string,
): Promise<{ name: string; description: string; files: string[] }> {
  const skillMdPath = path.join(sourceDir, 'SKILL.md')
  const fileStat = await lstat(skillMdPath).catch(() => null)
  if (!fileStat || !fileStat.isFile()) {
    throw new HttpError(502, '安装结果缺少有效的 SKILL.md')
  }
  const content = await readFile(skillMdPath, 'utf8')
  const { data } = parseFrontmatter(content)
  const fmName = typeof data.name === 'string' ? data.name.trim() : ''
  const fmDesc = typeof data.description === 'string' ? data.description.trim() : ''
  if (!fmName || !fmDesc) {
    throw new HttpError(502, '安装结果的 SKILL.md 缺少合法的 name 或 description frontmatter')
  }
  if (fmName !== expectedName) {
    throw new HttpError(502, `安装的 Skill 名称（${fmName}）与请求（${expectedName}）不一致`)
  }
  const allFiles = await listFilesRecursive(sourceDir)
  return { name: fmName, description: fmDesc, files: allFiles }
}

export async function inspectSkill(
  body: unknown,
  log?: (line: string) => void,
  signal?: AbortSignal,
): Promise<InspectResult> {
  cleanExpiredCache()
  const { repo, skill } = parseAndValidateSource(body)

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'skills-inspect-'))
  let success = false
  try {
    const args = ['--yes', 'skills', 'add', repo, '--skill', skill, '--agent', 'claude-code', '--copy', '-y']
    log?.(`$ npx ${args.join(' ')}`)
    const result = await run('npx', args, {
      cwd: tmp,
      env: { NO_COLOR: '1', FORCE_COLOR: '0' },
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onData: (chunk) => {
        if (!log) return
        for (const line of stripAnsi(chunk).split(/\r?\n/)) if (line.trim()) log(line)
      },
    })
    if (signal?.aborted) throw new HttpError(499, '操作已取消')
    if (result.code !== 0) throw new HttpError(502, `获取 Skill 失败，退出码 ${result.code}`)

    const installedRoot = path.join(tmp, '.claude', 'skills')
    const source = path.join(installedRoot, skill)
    if (!(await isDir(source))) {
      throw new HttpError(502, `未在仓库中找到技能：${skill}`)
    }

    await assertNoSymlinks(source)
    const { name, description, files } = await validateAndExtractSkillInfo(source, skill)

    const inspectId = `inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    inspectCache.set(inspectId, {
      id: inspectId,
      repo,
      skill,
      name,
      description,
      files,
      tmpDir: tmp,
      sourceDir: source,
      createdAt: Date.now(),
    })
    success = true

    const existsLocally = await skillExists(skill)
    return {
      inspectId,
      name,
      description,
      repo,
      files,
      existsLocally,
    }
  } finally {
    if (!success) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export async function installInspected(body: unknown): Promise<{ name: string; dir: string }> {
  cleanExpiredCache()
  const input = (body ?? {}) as Record<string, unknown>
  const inspectId = typeof input.inspectId === 'string' ? input.inspectId.trim() : ''
  if (!inspectId) throw badRequest('缺少 inspectId')

  const cached = inspectCache.get(inspectId)
  if (!cached) throw new HttpError(404, '预检已过期或不存在，请重新检测')

  const overwrite = input.overwrite === true
  const target = path.join(REPO_ROOT, cached.skill)
  if (!overwrite && (await exists(target))) {
    throw new HttpError(409, `Skill「${cached.skill}」已存在，如需覆盖请勾选「覆盖」`)
  }

  inspectCache.delete(inspectId)
  try {
    await assertNoSymlinks(cached.sourceDir)
    await atomicReplace(target, overwrite, async (staged) => {
      await cp(cached.sourceDir, staged, { recursive: true, dereference: false })
      await assertNoSymlinks(staged)
    })
    return { name: cached.name, dir: cached.skill }
  } finally {
    await rm(cached.tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function installSkill(
  req: InstallRequest,
  log: (line: string) => void,
  signal?: AbortSignal,
): Promise<{ name: string; dir: string }> {
  if (installing) throw new HttpError(409, '已有安装任务正在进行')
  installing = true
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'skills-install-'))
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const staged = path.join(REPO_ROOT, `.tmp-install-${req.skill}-${suffix}`)
  const backup = path.join(REPO_ROOT, `.tmp-backup-${req.skill}-${suffix}`)
  let backedUp = false

  try {
    const args = ['--yes', 'skills', 'add', req.repo, '--skill', req.skill, '--agent', 'claude-code', '--copy', '-y']
    log(`$ npx ${args.join(' ')}`)
    const result = await run('npx', args, {
      cwd: tmp,
      env: { NO_COLOR: '1', FORCE_COLOR: '0' },
      timeoutMs: INSTALL_TIMEOUT_MS,
      signal,
      onData: (chunk) => {
        for (const line of stripAnsi(chunk).split(/\r?\n/)) if (line.trim()) log(line)
      },
    })
    if (signal?.aborted) throw new HttpError(499, '客户端已断开，安装已取消')
    if (result.code !== 0) throw new HttpError(502, `npx skills add 退出码 ${result.code}`)

    const installedRoot = path.join(tmp, '.claude', 'skills')
    const source = path.join(installedRoot, req.skill)
    if (!(await isDir(source))) {
      throw new HttpError(502, `未找到安装结果 .claude/skills/${req.skill}`)
    }

    await assertNoSymlinks(source)
    await validateAndExtractSkillInfo(source, req.skill)

    await cp(source, staged, { recursive: true, dereference: false })
    await assertNoSymlinks(staged)

    const target = path.join(REPO_ROOT, req.skill)
    const targetExists = await stat(target).then(() => true, () => false)
    if (targetExists) {
      if (!req.overwrite) throw new HttpError(409, `Skill「${req.skill}」已存在`)
      log(`覆盖已有目录 ${req.skill}/`)
      await rename(target, backup)
      backedUp = true
    }

    try {
      await rename(staged, target)
    } catch (err) {
      if (backedUp) {
        await rename(backup, target).catch(() => {})
        backedUp = false
      }
      throw err
    }

    if (backedUp) {
      await rm(backup, { recursive: true, force: true }).catch(() => {})
      backedUp = false
    }

    log(`已写入 ${path.relative(REPO_ROOT, target)}/`)
    return { name: req.skill, dir: req.skill }
  } finally {
    installing = false
    await rm(staged, { recursive: true, force: true }).catch(() => {})
    if (!backedUp) await rm(backup, { recursive: true, force: true }).catch(() => {})
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}
