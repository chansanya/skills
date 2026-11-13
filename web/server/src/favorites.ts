import fs from 'node:fs/promises'
import path from 'node:path'
import { REPO_ROOT, SKILL_NAME_RE } from './config.js'
import { HttpError } from './errors.js'

export interface FavoriteSkill {
  name: string
  source: string
  slug: string
  installs?: number
  description?: string
  addedAt?: string
}

const FAVORITES_FILE = path.join(REPO_ROOT, 'favorites.json')
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/

export async function listFavorites(): Promise<FavoriteSkill[]> {
  try {
    const raw = await fs.readFile(FAVORITES_FILE, 'utf8')
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export async function addFavorite(item: unknown): Promise<FavoriteSkill[]> {
  if (!item || typeof item !== 'object') {
    throw new HttpError(400, '无效的收藏数据')
  }

  const raw = item as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const source = typeof raw.source === 'string' ? raw.source.trim().replace(/\.git$/, '') : ''
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : `${source}/${name}`
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  const installs = typeof raw.installs === 'number' && Number.isFinite(raw.installs) ? Math.max(0, Math.floor(raw.installs)) : 0

  if (!name || !SKILL_NAME_RE.test(name) || name.includes('..')) {
    throw new HttpError(400, `非法的 Skill 名称：${name}`)
  }
  if (!source || !REPO_RE.test(source)) {
    throw new HttpError(400, `非法的仓库格式：${source}`)
  }

  const favorites = await listFavorites()
  const existingIdx = favorites.findIndex((f) => f.name.toLowerCase() === name.toLowerCase())
  const record: FavoriteSkill = {
    name,
    source,
    slug,
    installs,
    description,
    addedAt: new Date().toISOString(),
  }

  if (existingIdx >= 0) {
    favorites[existingIdx] = record
  } else {
    favorites.unshift(record)
  }

  const tmpFile = `${FAVORITES_FILE}.tmp.${Date.now()}`
  await fs.writeFile(tmpFile, JSON.stringify(favorites, null, 2), 'utf8')
  await fs.rename(tmpFile, FAVORITES_FILE)

  return favorites
}

export async function removeFavorite(name: string): Promise<FavoriteSkill[]> {
  const trimmed = (name || '').trim()
  if (!trimmed) throw new HttpError(400, '缺少要删除的 Skill 名称')

  const favorites = await listFavorites()
  const filtered = favorites.filter((f) => f.name.toLowerCase() !== trimmed.toLowerCase())

  const tmpFile = `${FAVORITES_FILE}.tmp.${Date.now()}`
  await fs.writeFile(tmpFile, JSON.stringify(filtered, null, 2), 'utf8')
  await fs.rename(tmpFile, FAVORITES_FILE)

  return filtered
}
