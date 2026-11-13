import { cp, lstat, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { IGNORED_DIRS, REPO_ROOT, SKILL_NAME_RE } from './config.js'
import { badRequest, HttpError } from './errors.js'
import { assertNoSymlinks, atomicReplace, exists } from './fsutil.js'
import { run } from './process.js'
import { parseFrontmatter, skillExists } from './skills.js'

export type RepositorySkillStatus = 'standard' | 'compatible' | 'invalid'
export type MetadataMode = 'normalize' | 'preserve'

export interface RepositorySkillCandidate {
  id: string
  name: string
  originalName: string
  path: string
  description: string
  files: string[]
  existsLocally: boolean
  preserveExistsLocally: boolean
  status: RepositorySkillStatus
  issues: string[]
  canPreserve: boolean
}

export interface RepositoryAnalysisResult {
  inspectId: string
  repo: string
  skills: RepositorySkillCandidate[]
}

export interface RepositoryInstallResult {
  name: string
  status: 'installed' | 'replaced' | 'error'
  message?: string
}

interface CachedRepositorySkill extends RepositorySkillCandidate {
  sourceDir: string
  metadata: Record<string, unknown>
}

interface CachedRepositoryAnalysis {
  repo: string
  tmpDir: string
  skills: Map<string, CachedRepositorySkill>
  createdAt: number
}

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/
const CLONE_TIMEOUT_MS = 2 * 60_000
const CACHE_TTL_MS = 10 * 60_000
const MAX_SKILLS = 100
const MAX_SKILL_FILE_BYTES = 512 * 1024
const MAX_FILES_PER_SKILL = 2000
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

let analyzing = false
let installing = false
const repositoryCache = new Map<string, CachedRepositoryAnalysis>()

function parseRepositorySource(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw badRequest('请输入 GitHub 仓库地址')
  if (raw.length > 500) throw badRequest('GitHub 仓库地址过长')

  const value = raw.trim()
  const match = /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+)(?:[/?#].*)?$/i.exec(value)
  const repo = (match ? `${match[1]}/${match[2]}` : value).replace(/\.git$/, '')
  if (!REPO_RE.test(repo)) throw badRequest('请输入 owner/repo 或完整的 GitHub 仓库地址')
  return repo
}

function safeSkillName(value: string, fallback: string): string {
  const normalize = (input: string) => input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')

  let name = normalize(value) || normalize(fallback) || 'imported-skill'
  if (IGNORED_DIRS.has(name)) name = `skill-${name}`.slice(0, 64)
  return name
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function deriveDescription(body: string, fallbackName: string): string {
  const lines = body.replace(/```[\s\S]*?```/g, '').split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim()
    if (!line || /^#/.test(line)) continue

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, '').trim())
        index++
      }
      const cleaned = cleanMarkdown(quote.join(' '))
      if (cleaned) return cleaned.slice(0, 500)
      continue
    }

    if (/^([-*+]\s|\d+\.\s|\|)/.test(line)) continue
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index].trim()
      if (!current || /^(#|[-*+]\s|\d+\.\s|\||>)/.test(current)) break
      paragraph.push(current)
      index++
    }
    const cleaned = cleanMarkdown(paragraph.join(' '))
    if (cleaned) return cleaned.slice(0, 500)
  }
  return `${fallbackName} Skill`
}

function canUseOriginalName(name: string): boolean {
  return SKILL_NAME_RE.test(name) && !name.includes('..') && !IGNORED_DIRS.has(name)
}

async function cleanExpiredCache(): Promise<void> {
  const now = Date.now()
  for (const [id, cached] of repositoryCache) {
    if (now - cached.createdAt <= CACHE_TTL_MS) continue
    repositoryCache.delete(id)
    await rm(cached.tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function findSkillDirectories(root: string): Promise<string[]> {
  const found: string[] = []
  let visited = 0

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (++visited > 50_000) throw new HttpError(422, '仓库文件过多，无法安全分析')
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const info = await lstat(full)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) await walk(full)
      else if (info.isFile() && entry.name === 'SKILL.md') {
        found.push(dir)
        if (found.length > MAX_SKILLS) throw new HttpError(422, `仓库包含超过 ${MAX_SKILLS} 个 Skill，无法安全分析`)
      }
    }
  }

  await walk(root)
  return found
}

async function listSkillFiles(root: string): Promise<string[]> {
  const files: string[] = []

  async function walk(dir: string, relative: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const next = relative ? `${relative}/${entry.name}` : entry.name
      const info = await lstat(full)
      if (info.isSymbolicLink()) throw new HttpError(400, `检测到不安全的符号链接：${next}`)
      if (info.isDirectory()) await walk(full, next)
      else if (info.isFile()) files.push(next)
      if (files.length > MAX_FILES_PER_SKILL) throw new HttpError(422, `文件数量超过 ${MAX_FILES_PER_SKILL} 个`)
    }
  }

  await walk(root, '')
  return files.sort()
}

async function inspectCandidate(root: string, sourceDir: string, index: number): Promise<CachedRepositorySkill> {
  const relativePath = path.relative(root, sourceDir).split(path.sep).join('/') || '.'
  const originalName = path.basename(sourceDir)
  const issues: string[] = []
  let metadata: Record<string, unknown> = {}
  let name = safeSkillName(originalName, `skill-${index + 1}`)
  let description = `${originalName} Skill`
  let files: string[] = []
  let status: RepositorySkillStatus = 'standard'

  try {
    const skillFile = path.join(sourceDir, 'SKILL.md')
    const fileInfo = await stat(skillFile)
    if (fileInfo.size > MAX_SKILL_FILE_BYTES) throw new HttpError(422, 'SKILL.md 超过 512 KB')

    const content = await readFile(skillFile, 'utf8')
    const parsed = parseFrontmatter(content)
    metadata = parsed.data
    const rawName = typeof metadata.name === 'string' ? metadata.name.trim() : ''
    const rawDescription = typeof metadata.description === 'string' ? metadata.description.trim() : ''

    if (!rawName) issues.push('缺少 frontmatter.name')
    else if (!SKILL_NAME_RE.test(rawName) || rawName.includes('..') || IGNORED_DIRS.has(rawName)) {
      issues.push(`frontmatter.name 不规范：${rawName}`)
    }
    name = rawName && SKILL_NAME_RE.test(rawName) && !rawName.includes('..') && !IGNORED_DIRS.has(rawName)
      ? rawName
      : safeSkillName(rawName, originalName)

    if (!rawDescription) issues.push('缺少 frontmatter.description')
    description = rawDescription || deriveDescription(parsed.body, originalName)
    if (issues.length) status = 'compatible'

    await assertNoSymlinks(sourceDir)
    files = await listSkillFiles(sourceDir)
  } catch (error) {
    status = 'invalid'
    issues.push(error instanceof Error ? error.message : String(error))
  }

  const canPreserve = status !== 'invalid' && canUseOriginalName(originalName)
  if (status === 'compatible' && !canPreserve) issues.push(`目录名无法用于原样导入：${originalName}`)

  return {
    id: `skill-${index + 1}`,
    name,
    originalName,
    path: relativePath,
    description,
    files,
    existsLocally: status === 'invalid' ? false : await skillExists(name),
    preserveExistsLocally: status === 'invalid' ? false : await skillExists(originalName),
    status,
    issues: [...new Set(issues)],
    canPreserve,
    sourceDir,
    metadata,
  }
}

function publicCandidate(item: CachedRepositorySkill): RepositorySkillCandidate {
  return {
    id: item.id,
    name: item.name,
    originalName: item.originalName,
    path: item.path,
    description: item.description,
    files: item.files,
    existsLocally: item.existsLocally,
    preserveExistsLocally: item.preserveExistsLocally,
    status: item.status,
    issues: item.issues,
    canPreserve: item.canPreserve,
  }
}

function normalizedSkillContent(item: CachedRepositorySkill, content: string): string {
  const { body } = parseFrontmatter(content)
  const metadata = { ...item.metadata, name: item.name, description: item.description }
  return `---\n${stringifyYaml(metadata).trimEnd()}\n---\n\n${body.replace(/^\s+/, '')}`
}

export async function analyzeRepository(body: unknown, signal?: AbortSignal): Promise<RepositoryAnalysisResult> {
  await cleanExpiredCache()
  const input = (body ?? {}) as Record<string, unknown>
  const repo = parseRepositorySource(input.source)
  if (analyzing) throw new HttpError(409, '已有仓库分析任务正在进行')
  analyzing = true

  let tmpDir: string | undefined
  let cached = false
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skills-repository-'))
    const cloneDir = path.join(tmpDir, 'repository')
    const result = await run(
      'git',
      ['clone', '--depth', '1', '--single-branch', '--filter=blob:none', '--', `https://github.com/${repo}.git`, cloneDir],
      { cwd: tmpDir, timeoutMs: CLONE_TIMEOUT_MS, signal, env: { GIT_TERMINAL_PROMPT: '0' } },
    )
    if (signal?.aborted) throw new HttpError(499, '操作已取消')
    if (result.code !== 0) throw new HttpError(502, '无法读取 GitHub 仓库，请确认地址有效且仓库可访问')

    const directories = await findSkillDirectories(cloneDir)
    if (!directories.length) throw new HttpError(422, '仓库中没有找到 SKILL.md')

    const candidates = await Promise.all(directories.map((dir, index) => inspectCandidate(cloneDir, dir, index)))
    const normalizedCounts = new Map<string, number>()
    for (const item of candidates) {
      if (item.status !== 'invalid') normalizedCounts.set(item.name, (normalizedCounts.get(item.name) ?? 0) + 1)
    }
    for (const item of candidates) {
      if (item.status !== 'invalid' && (normalizedCounts.get(item.name) ?? 0) > 1) {
        item.status = 'invalid'
        item.issues.push(`仓库中存在重复的导入名称：${item.name}`)
        item.existsLocally = false
        item.preserveExistsLocally = false
        item.canPreserve = false
      }
    }

    const inspectId = `repository-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    repositoryCache.set(inspectId, {
      repo,
      tmpDir,
      skills: new Map(candidates.map((item) => [item.id, item])),
      createdAt: Date.now(),
    })
    cached = true
    return { inspectId, repo, skills: candidates.map(publicCandidate) }
  } finally {
    analyzing = false
    if (tmpDir && !cached) await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function discardRepositoryAnalysis(inspectId: string): Promise<void> {
  const cached = repositoryCache.get(inspectId)
  if (!cached) return
  repositoryCache.delete(inspectId)
  await rm(cached.tmpDir, { recursive: true, force: true }).catch(() => {})
}

export async function installRepositorySkills(body: unknown): Promise<{ results: RepositoryInstallResult[] }> {
  await cleanExpiredCache()
  if (installing) throw new HttpError(409, '已有仓库批量导入任务正在进行')

  const input = (body ?? {}) as Record<string, unknown>
  const inspectId = typeof input.inspectId === 'string' ? input.inspectId.trim() : ''
  const selectedIds = Array.isArray(input.skills)
    ? [...new Set(input.skills.filter((id): id is string => typeof id === 'string' && !!id.trim()))]
    : []
  const overwrite = input.overwrite === true
  const metadataMode: MetadataMode = input.metadataMode === 'preserve' ? 'preserve' : 'normalize'

  if (!inspectId) throw badRequest('缺少 inspectId')
  if (!selectedIds.length) throw badRequest('请至少选择一个 Skill')
  if (selectedIds.length > MAX_SKILLS) throw badRequest(`单次最多导入 ${MAX_SKILLS} 个 Skill`)

  const cached = repositoryCache.get(inspectId)
  if (!cached) throw new HttpError(404, '仓库分析结果已过期，请重新分析')

  const selected = selectedIds.map((id) => cached.skills.get(id))
  if (selected.some((item) => !item || item.status === 'invalid')) throw badRequest('选择项包含不可导入的 Skill')
  if (metadataMode === 'preserve' && selected.some((item) => !item?.canPreserve)) {
    throw badRequest('选择项包含无法原样导入的 Skill')
  }

  const targetNames = (selected as CachedRepositorySkill[]).map((item) =>
    metadataMode === 'preserve' ? item.originalName : item.name,
  )
  if (new Set(targetNames).size !== targetNames.length) throw badRequest('所选 Skill 的导入名称存在冲突')

  installing = true
  const results: RepositoryInstallResult[] = []
  try {
    for (let index = 0; index < selected.length; index++) {
      const item = selected[index] as CachedRepositorySkill
      const targetName = targetNames[index]
      try {
        await assertNoSymlinks(item.sourceDir)
        const target = path.join(REPO_ROOT, targetName)
        if ((await exists(target)) && !overwrite) {
          throw new HttpError(409, `Skill「${targetName}」已存在，请确认覆盖后重试`)
        }
        const result = await atomicReplace(target, overwrite, async (staged) => {
          await cp(item.sourceDir, staged, { recursive: true, dereference: false })
          if (metadataMode === 'normalize' && item.status === 'compatible') {
            const skillFile = path.join(staged, 'SKILL.md')
            await writeFile(skillFile, normalizedSkillContent(item, await readFile(skillFile, 'utf8')), 'utf8')
          }
        })
        results.push({ name: targetName, status: result === 'replaced' ? 'replaced' : 'installed' })
      } catch (error) {
        results.push({ name: targetName, status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    }
    return { results }
  } finally {
    installing = false
    repositoryCache.delete(inspectId)
    await rm(cached.tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
