import { IGNORED_DIRS, SKILL_NAME_RE } from './config.js'
import { badRequest, HttpError } from './errors.js'
import { analyzeRepository, discardRepositoryAnalysis, installRepositorySkills } from './repository.js'
import { skillExists } from './skills.js'

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

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/
const CACHE_TTL_MS = 10 * 60_000
const inspectCache = new Map<string, { skillId: string; name: string; createdAt: number }>()

function parseSource(raw: string): { repo: string; skill?: string } {
  const source = raw.trim()
  const url = /^https?:\/\/(?:www\.)?(github\.com|skills\.sh)\/([^/\s]+)\/([^/\s#?]+)(?:\/([^\s#?]+))?/i.exec(source)
  if (url) {
    const [, host, owner, repo, rest] = url
    return {
      repo: `${owner}/${repo.replace(/\.git$/, '')}`,
      skill: host.toLowerCase() === 'skills.sh' && rest ? rest.split('/')[0] : undefined,
    }
  }
  return { repo: source.replace(/\.git$/, '') }
}

export function parseAndValidateSource(body: unknown): { repo: string; skill: string } {
  const input = (body ?? {}) as Record<string, unknown>
  if (typeof input.source !== 'string' || !input.source.trim()) throw badRequest('source 不能为空')
  if (input.source.length > 500) throw badRequest('source 过长')
  const parsed = parseSource(input.source)
  const skill = (typeof input.skill === 'string' && input.skill.trim()) || parsed.skill
  if (!REPO_RE.test(parsed.repo)) throw badRequest('无法识别仓库，请输入 owner/repo、GitHub 地址或 skills.sh 链接')
  if (!skill) throw badRequest('请指定要安装的 Skill 名称')
  if (!SKILL_NAME_RE.test(skill) || skill.includes('..')) throw badRequest(`非法的 Skill 名称：${skill}`)
  if (IGNORED_DIRS.has(skill)) throw badRequest(`Skill 名称与保留目录冲突：${skill}`)
  return { repo: parsed.repo, skill }
}

export async function validateInstall(body: unknown): Promise<InstallRequest> {
  const { repo, skill } = parseAndValidateSource(body)
  const overwrite = ((body ?? {}) as Record<string, unknown>).overwrite === true
  if (!overwrite && await skillExists(skill)) throw new HttpError(409, `Skill「${skill}」已存在，如需覆盖请勾选「覆盖」`)
  return { repo, skill, overwrite }
}

export async function inspectSkill(
  body: unknown,
  log?: (line: string) => void,
  signal?: AbortSignal,
): Promise<InspectResult> {
  const { repo, skill } = parseAndValidateSource(body)
  for (const [id, item] of inspectCache) {
    if (Date.now() - item.createdAt > CACHE_TTL_MS) inspectCache.delete(id)
  }
  log?.(`正在分析 GitHub 仓库 ${repo}`)
  const analysis = await analyzeRepository({ source: repo }, signal)
  let keep = false
  try {
    if (signal?.aborted) throw new HttpError(499, '操作已取消')
    const matches = analysis.skills.filter((item) => item.name === skill)
    if (matches.length !== 1) {
      throw new HttpError(422, matches.length ? `仓库中存在多个同名 Skill：${skill}` : `未在仓库中找到技能：${skill}`)
    }
    const item = matches[0]
    if (item.status === 'invalid') throw new HttpError(422, `Skill「${skill}」不可导入：${item.issues.join('；')}`)
    inspectCache.set(analysis.inspectId, { skillId: item.id, name: item.name, createdAt: Date.now() })
    keep = true
    return {
      inspectId: analysis.inspectId,
      name: item.name,
      description: item.description,
      repo: analysis.repo,
      files: item.files,
      existsLocally: item.existsLocally,
    }
  } finally {
    if (!keep) await discardRepositoryAnalysis(analysis.inspectId)
  }
}

export async function installInspected(body: unknown): Promise<{ name: string; dir: string }> {
  const input = (body ?? {}) as Record<string, unknown>
  const inspectId = typeof input.inspectId === 'string' ? input.inspectId.trim() : ''
  if (!inspectId) throw badRequest('缺少 inspectId')
  const cached = inspectCache.get(inspectId)
  if (!cached || Date.now() - cached.createdAt > CACHE_TTL_MS) {
    inspectCache.delete(inspectId)
    throw new HttpError(404, '预检已过期或不存在，请重新检测')
  }
  const overwrite = input.overwrite === true
  if (!overwrite && await skillExists(cached.name)) {
    throw new HttpError(409, `Skill「${cached.name}」已存在，如需覆盖请勾选「覆盖」`)
  }
  const { results } = await installRepositorySkills({
    inspectId,
    skills: [cached.skillId],
    overwrite,
    metadataMode: 'normalize',
  })
  inspectCache.delete(inspectId)
  const result = results[0]
  if (!result || result.status === 'error') throw new HttpError(500, result?.message ?? '导入失败')
  return { name: result.name, dir: result.name }
}

export async function installSkill(
  req: InstallRequest,
  log: (line: string) => void,
  signal?: AbortSignal,
): Promise<{ name: string; dir: string }> {
  const inspected = await inspectSkill({ source: req.repo, skill: req.skill }, log, signal)
  if (signal?.aborted) {
    inspectCache.delete(inspected.inspectId)
    await discardRepositoryAnalysis(inspected.inspectId)
    throw new HttpError(499, '操作已取消')
  }
  log(`正在导入 ${inspected.name}`)
  return installInspected({ inspectId: inspected.inspectId, overwrite: req.overwrite })
}
