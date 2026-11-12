import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RequestHandler } from 'express'
import AdmZip from 'adm-zip'
import multer from 'multer'
import { extract as tarExtract } from 'tar'
import { IGNORED_DIRS, REPO_ROOT, SKILL_NAME_RE } from './config.js'
import { badRequest, HttpError } from './errors.js'
import { assertNoSymlinks, atomicReplace, exists, isInside } from './fsutil.js'
import { parseFrontmatter } from './skills.js'

export interface ImportResult {
  name: string
  dir: string
  replaced: boolean
}

interface ImportOptions {
  skillName?: string
  overwrite: boolean
}

const MB = 1024 * 1024
const MAX_UPLOAD_BYTES = 20 * MB
const MAX_EXTRACTED_BYTES = 100 * MB
const MAX_FILES = 2000
const SKIPPED_SEGMENTS = new Set(['.git', 'node_modules', '__MACOSX', '.DS_Store'])
const TAR_FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile', 'Directory'])
const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

let importing = false

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES, fields: 10, fieldSize: MB },
})

export function uploadMiddleware(kind: 'folder' | 'archive'): RequestHandler {
  const handler = kind === 'folder' ? upload.array('files', MAX_FILES) : upload.single('file')
  return (req, res, next) => {
    const length = Number(req.headers['content-length'])
    if (!length) return next(new HttpError(411, '缺少 Content-Length'))
    if (length > MAX_UPLOAD_BYTES + MB) return next(new HttpError(413, `上传内容超过 ${MAX_UPLOAD_BYTES / MB}MB 限制`))
    handler(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError) next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, `上传失败：${err.message}`))
      else next(err)
    })
  }
}

function checkSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name) || name.includes('..')) throw badRequest(`非法的 Skill 名称：${name}`)
  if (IGNORED_DIRS.has(name)) throw badRequest(`Skill 名称与保留目录冲突：${name}`)
}

function parseOptions(body: unknown): ImportOptions {
  const input = (body ?? {}) as Record<string, unknown>
  const skillName = typeof input.skillName === 'string' && input.skillName.trim() ? input.skillName.trim() : undefined
  if (skillName) checkSkillName(skillName)
  return { skillName, overwrite: input.overwrite === 'true' }
}

/** Returns null for entries that should be silently skipped; throws on unsafe paths. */
function safeSegments(raw: string): string[] | null {
  const normalized = raw.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) {
    throw badRequest(`非法的文件路径：${raw}`)
  }
  const segments = normalized.split('/').filter((s) => s && s !== '.')
  if (segments.includes('..')) throw badRequest(`文件路径不能包含 ..：${raw}`)
  if (!segments.length || segments.some((s) => SKIPPED_SEGMENTS.has(s))) return null
  return segments
}

function resolveInside(root: string, segments: string[]): string {
  const abs = path.resolve(root, ...segments)
  if (!isInside(abs, root)) throw badRequest(`文件路径越界：${segments.join('/')}`)
  return abs
}

async function writeEntry(abs: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, data, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EEXIST' || err.code === 'EISDIR' || err.code === 'ENOTDIR') throw badRequest(`文件路径冲突：${abs}`)
    throw err
  })
}

const isFile = (p: string) => lstat(p).then((s) => s.isFile(), () => false)

async function locateSkillRoot(dir: string): Promise<string> {
  if (await isFile(path.join(dir, 'SKILL.md'))) return dir
  const entries = await readdir(dir, { withFileTypes: true })
  if (entries.length === 1 && entries[0].isDirectory()) {
    const nested = path.join(dir, entries[0].name)
    if (await isFile(path.join(nested, 'SKILL.md'))) return nested
  }
  throw badRequest('未找到 SKILL.md（需位于根目录或唯一的顶层目录中）')
}

async function commitSkill(root: string, opts: ImportOptions): Promise<ImportResult> {
  await assertNoSymlinks(root)
  const { data } = parseFrontmatter(await readFile(path.join(root, 'SKILL.md'), 'utf8'))
  const fmName = typeof data.name === 'string' ? data.name.trim() : ''
  const fmDesc = typeof data.description === 'string' ? data.description.trim() : ''
  if (!fmName || !fmDesc) throw badRequest('SKILL.md 缺少合法的 name 或 description frontmatter')

  const name = opts.skillName ?? fmName
  checkSkillName(name)
  const target = path.join(REPO_ROOT, name)
  if (!opts.overwrite && (await exists(target))) throw new HttpError(409, `Skill「${name}」已存在，如需覆盖请勾选「覆盖已存在」`)

  const result = await atomicReplace(target, opts.overwrite, (staged) => cp(root, staged, { recursive: true, dereference: false }))
  return { name, dir: name, replaced: result === 'replaced' }
}

async function withImport(opts: ImportOptions, fn: (tmp: string) => Promise<void>): Promise<ImportResult> {
  if (importing) throw new HttpError(409, '已有导入任务正在进行')
  if (opts.skillName && !opts.overwrite && (await exists(path.join(REPO_ROOT, opts.skillName)))) {
    throw new HttpError(409, `Skill「${opts.skillName}」已存在，如需覆盖请勾选「覆盖已存在」`)
  }
  importing = true
  let tmp: string | undefined
  try {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'skills-import-'))
    await fn(tmp)
    await assertNoSymlinks(tmp)
    return await commitSkill(await locateSkillRoot(tmp), opts)
  } finally {
    importing = false
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

function parsePaths(body: unknown, files: Express.Multer.File[]): string[] {
  const raw = ((body ?? {}) as Record<string, unknown>).paths
  if (typeof raw !== 'string') return files.map((f) => f.originalname)
  let paths: unknown
  try {
    paths = JSON.parse(raw)
  } catch {
    throw badRequest('paths 格式错误')
  }
  if (!Array.isArray(paths) || paths.length !== files.length || paths.some((p) => typeof p !== 'string')) {
    throw badRequest('paths 与上传文件数量不一致')
  }
  return paths as string[]
}

export async function importFolder(files: Express.Multer.File[] | undefined, body: unknown): Promise<ImportResult> {
  const opts = parseOptions(body)
  if (!files?.length) throw badRequest('请选择要导入的文件夹')
  const paths = parsePaths(body, files)
  const total = files.reduce((sum, f) => sum + f.size, 0)
  if (total > MAX_UPLOAD_BYTES) throw new HttpError(413, `文件夹总大小超过 ${MAX_UPLOAD_BYTES / MB}MB 限制`)

  return withImport(opts, async (tmp) => {
    let written = 0
    for (let i = 0; i < files.length; i++) {
      const segments = safeSegments(paths[i])
      if (!segments) continue
      await writeEntry(resolveInside(tmp, segments), files[i].buffer)
      written++
    }
    if (!written) throw badRequest('没有可导入的文件')
  })
}

async function extractZip(buf: Buffer, dir: string): Promise<void> {
  let zip: AdmZip
  try {
    zip = new AdmZip(buf)
  } catch {
    throw badRequest('无法解析 zip 压缩包')
  }
  const entries = zip.getEntries()
  if (entries.length > MAX_FILES) throw badRequest(`压缩包内条目超过 ${MAX_FILES} 个`)

  let total = 0
  for (const entry of entries) {
    const segments = safeSegments(entry.entryName)
    if (!segments) continue
    const abs = resolveInside(dir, segments)
    const fileType = (entry.attr >>> 16) & S_IFMT
    if (fileType && fileType !== S_IFREG && fileType !== S_IFDIR) {
      throw badRequest(`压缩包包含符号链接或特殊文件，已拒绝：${entry.entryName}`)
    }
    if (entry.isDirectory) {
      await mkdir(abs, { recursive: true })
      continue
    }
    total += entry.header.size
    if (total > MAX_EXTRACTED_BYTES) throw new HttpError(413, `解压后大小超过 ${MAX_EXTRACTED_BYTES / MB}MB 限制`)
    const data = entry.getData()
    if (data.length !== entry.header.size) throw badRequest(`压缩包条目损坏：${entry.entryName}`)
    await writeEntry(abs, data)
  }
}

async function extractTar(buf: Buffer, dir: string): Promise<void> {
  let violation: unknown
  let total = 0
  let count = 0
  const reject = (err: unknown) => {
    violation ??= err
    return false
  }

  await pipeline(
    Readable.from([buf]),
    tarExtract({
      cwd: dir,
      strict: true,
      filter: (entryPath, entry) => {
        if (violation) return false
        let segments: string[] | null
        try {
          segments = safeSegments(entryPath)
          if (segments) resolveInside(dir, segments)
        } catch (err) {
          return reject(err)
        }
        if (!segments) return false
        const type = 'type' in entry ? entry.type : 'File'
        if (!TAR_FILE_TYPES.has(type)) return reject(badRequest(`压缩包包含链接或特殊文件（${type}），已拒绝：${entryPath}`))
        if (++count > MAX_FILES) return reject(badRequest(`压缩包内条目超过 ${MAX_FILES} 个`))
        total += entry.size
        if (total > MAX_EXTRACTED_BYTES) return reject(new HttpError(413, `解压后大小超过 ${MAX_EXTRACTED_BYTES / MB}MB 限制`))
        return true
      },
    }),
  ).catch((err: unknown) => {
    if (!violation) throw badRequest(`解压失败：${err instanceof Error ? err.message : String(err)}`)
  })
  if (violation) throw violation
}

function archiveKind(file: Express.Multer.File): 'zip' | 'tar' {
  const name = file.originalname.toLowerCase()
  const b = file.buffer
  if (name.endsWith('.zip') && b[0] === 0x50 && b[1] === 0x4b) return 'zip'
  if ((name.endsWith('.tar.gz') || name.endsWith('.tgz')) && b[0] === 0x1f && b[1] === 0x8b) return 'tar'
  throw badRequest('仅支持 .zip、.tar.gz、.tgz 压缩包（或文件内容与扩展名不符）')
}

export async function importArchive(file: Express.Multer.File | undefined, body: unknown): Promise<ImportResult> {
  const opts = parseOptions(body)
  if (!file) throw badRequest('请选择要导入的压缩包')
  const kind = archiveKind(file)
  return withImport(opts, (tmp) => (kind === 'zip' ? extractZip(file.buffer, tmp) : extractTar(file.buffer, tmp)))
}
