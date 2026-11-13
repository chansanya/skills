import { HttpError } from './errors.js'
import { SKILL_NAME_RE } from './config.js'

export interface SkillSearchResult {
  name: string
  slug: string
  source: string
  installs: number
}

const SEARCH_ENDPOINT = 'https://skills.sh/api/search'
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/
const SEARCH_TIMEOUT_MS = 10_000
const MAX_RESULTS = 25
const MAX_RESPONSE_BYTES = 1024 * 1024

const cleanText = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength) : ''

export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  const q = query.trim()
  if (!q) throw new HttpError(400, '请输入 Skill 名称或关键词')
  if (q.length > 100) throw new HttpError(400, '搜索关键词过长')

  try {
    const url = new URL(SEARCH_ENDPOINT)
    url.searchParams.set('q', q)
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })
    if (!response.ok) throw new HttpError(502, `Skills 搜索服务返回 ${response.status}`)

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw new HttpError(502, 'Skills 搜索结果过大')

    const payload = (await response.json()) as { skills?: unknown }
    if (!Array.isArray(payload.skills)) throw new HttpError(502, 'Skills 搜索服务返回了无效数据')

    return payload.skills
      .map((item): SkillSearchResult | null => {
        if (!item || typeof item !== 'object') return null
        const raw = item as Record<string, unknown>
        const name = cleanText(raw.name, 64)
        const slug = cleanText(raw.id, 200)
        const source = cleanText(raw.source, 201).replace(/\.git$/, '')
        const installs = typeof raw.installs === 'number' && Number.isFinite(raw.installs)
          ? Math.max(0, Math.floor(raw.installs))
          : 0
        if (!slug || !SKILL_NAME_RE.test(name) || name.includes('..') || !REPO_RE.test(source)) return null
        return { name, slug, source, installs }
      })
      .filter((item): item is SkillSearchResult => item !== null)
      .slice(0, MAX_RESULTS)
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new HttpError(504, 'Skills 搜索超时，请稍后重试')
    }
    throw new HttpError(502, '暂时无法连接 Skills 搜索服务')
  }
}
