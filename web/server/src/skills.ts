import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { IGNORED_DIRS, REPO_ROOT, SKILL_NAME_RE } from './config.js'

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
