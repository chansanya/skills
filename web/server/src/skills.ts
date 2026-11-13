import { randomUUID } from 'node:crypto'
import { chmod, lstat, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { IGNORED_DIRS, REPO_ROOT, SKILL_NAME_RE } from './config.js'
import { HttpError } from './errors.js'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

export interface SkillSummary {
  name: string
  dir: string
  description: string
  files: string[]
}

export interface SkillDetail extends SkillSummary {
  content: string
  body: string
  frontmatter: Record<string, unknown>
  tree: FileNode[]
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const MAX_DEPTH = 6

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_RE.exec(content)
  if (!match) return { data: {}, body: content }
  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
  } catch {
    data = {}
  }
  return { data, body: content.slice(match[0].length) }
}

async function buildTree(absDir: string, relDir: string, depth: number): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await readdir(absDir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: rel, type: 'dir', children: await buildTree(abs, rel, depth + 1) })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path: rel, type: 'file', size: (await stat(abs)).size })
    }
  }
  return nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

function flatten(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) => (n.type === 'dir' ? flatten(n.children ?? []) : [n.path]))
}

export async function skillDirs(): Promise<string[]> {
  const entries = await readdir(REPO_ROOT, { withFileTypes: true })
  const dirs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
    if (!SKILL_NAME_RE.test(entry.name)) continue
    try {
      if ((await stat(path.join(REPO_ROOT, entry.name, 'SKILL.md'))).isFile()) dirs.push(entry.name)
    } catch {
      // not a skill directory
    }
  }
  return dirs.sort()
}

async function loadSkill(dir: string): Promise<SkillDetail> {
  const abs = path.join(REPO_ROOT, dir)
  const content = await readFile(path.join(abs, 'SKILL.md'), 'utf8')
  const { data, body } = parseFrontmatter(content)
  const tree = await buildTree(abs, '', 0)
  const rawName = typeof data.name === 'string' ? data.name.trim() : ''
  const name = rawName && SKILL_NAME_RE.test(rawName) ? rawName : dir
  return {
    name,
    dir,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    files: flatten(tree).filter((f) => f !== 'SKILL.md'),
    content,
    body,
    frontmatter: data,
    tree,
  }
}

export async function listSkills(): Promise<SkillSummary[]> {
  const skills = await Promise.all((await skillDirs()).map(loadSkill))
  return skills.map(({ name, dir, description, files }) => ({ name, dir, description, files }))
}

export async function getSkill(name: string): Promise<SkillDetail | null> {
  if (!SKILL_NAME_RE.test(name)) return null
  const dirs = await skillDirs()
  if (dirs.includes(name)) return loadSkill(name)
  for (const dir of dirs) {
    const skill = await loadSkill(dir)
    if (skill.name === name) return skill
  }
  return null
}

export interface SkillFileContent {
  path: string
  size: number
  binary: boolean
  tooLarge: boolean
  content: string | null
}

const MAX_VIEW_FILE_BYTES = 512 * 1024 // 512 KB
const savingFiles = new Set<string>()

export async function skillExists(name: string): Promise<boolean> {
  return (await skillDirs()).includes(name)
}

export async function getSkillFile(nameOrDir: string, rawRelPath: string): Promise<SkillFileContent | null> {
  if (!SKILL_NAME_RE.test(nameOrDir)) return null
  const dirs = await skillDirs()
  let targetDir = dirs.includes(nameOrDir) ? nameOrDir : null
  if (!targetDir) {
    for (const dir of dirs) {
      const skill = await loadSkill(dir)
      if (skill.name === nameOrDir) {
        targetDir = dir
        break
      }
    }
  }
  if (!targetDir) return null

  const normalized = rawRelPath.replace(/\\/g, '/').trim()
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/')) return null
  const segments = normalized.split('/')
  if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s === 'node_modules')) return null

  const skillRoot = await realpath(path.join(REPO_ROOT, targetDir))
  const abs = path.resolve(skillRoot, ...segments)
  if (!abs.startsWith(skillRoot + path.sep)) return null

  const info = await lstat(abs).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isFile()) return null
  const realAbs = await realpath(abs).catch(() => null)
  if (!realAbs || !realAbs.startsWith(skillRoot + path.sep)) return null

  const size = info.size
  if (size > MAX_VIEW_FILE_BYTES) {
    return { path: segments.join('/'), size, binary: false, tooLarge: true, content: null }
  }

  const buf = await readFile(realAbs)
  const sample = buf.subarray(0, Math.min(buf.length, 8192))
  if (sample.includes(0)) {
    return { path: segments.join('/'), size, binary: true, tooLarge: false, content: null }
  }

  return { path: segments.join('/'), size, binary: false, tooLarge: false, content: buf.toString('utf8') }
}

export async function saveSkillFile(nameOrDir: string, rawRelPath: string, content: unknown, original: unknown): Promise<void> {
  if (typeof content !== 'string' || typeof original !== 'string') throw new HttpError(400, '缺少文件内容或原始内容')
  if (Buffer.byteLength(content, 'utf8') > MAX_VIEW_FILE_BYTES || Buffer.byteLength(original, 'utf8') > MAX_VIEW_FILE_BYTES) {
    throw new HttpError(413, '文件内容超过 512 KB 限制')
  }
  if (content.includes('\0') || original.includes('\0')) throw new HttpError(400, '不能编辑二进制文件')
  const dirs = await skillDirs()
  if (!dirs.includes(nameOrDir)) throw new HttpError(404, '未找到 Skill 目录')
  const normalized = rawRelPath.replace(/\\/g, '/')
  const segments = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s === 'node_modules')) {
    throw new HttpError(400, '非法文件路径')
  }
  const root = path.join(REPO_ROOT, nameOrDir)
  const rootInfo = await lstat(root).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new HttpError(400, 'Skill 目录不安全')
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const info = await lstat(current).catch(() => null)
    if (!info || info.isSymbolicLink()) throw new HttpError(400, '文件不存在或包含符号链接')
  }
  const rootReal = await realpath(root)
  const fileReal = await realpath(current)
  if (!fileReal.startsWith(rootReal + path.sep)) throw new HttpError(400, '文件路径越界')
  if (savingFiles.has(fileReal)) throw new HttpError(409, '文件正在保存，请稍后重试')
  savingFiles.add(fileReal)
  try {
    const info = await lstat(current)
    if (!info.isFile() || info.size > MAX_VIEW_FILE_BYTES) throw new HttpError(400, '只能编辑 512 KB 以内的普通文件')
    const bytes = await readFile(current)
    if (bytes.includes(0)) throw new HttpError(400, '不能编辑二进制文件')
    let diskContent: string
    try { diskContent = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) } catch { throw new HttpError(400, '只能编辑 UTF-8 文本文件') }
    if (diskContent !== original) throw new HttpError(409, '文件已被外部修改，请复制当前编辑内容后重新加载')
    const temporary = path.join(path.dirname(current), `.skills-edit-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', info.mode)
      try { await handle.writeFile(content, 'utf8') } finally { await handle.close() }
      await chmod(temporary, info.mode)
      const latest = await lstat(current)
      if (!latest.isFile() || latest.isSymbolicLink() || latest.ino !== info.ino || latest.mtimeMs !== info.mtimeMs || latest.size !== info.size) {
        throw new HttpError(409, '文件已被外部修改，请复制当前编辑内容后重新加载')
      }
      await rename(temporary, current)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  } finally {
    savingFiles.delete(fileReal)
  }
}
