import { lstat, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from './errors.js'

export async function exists(p: string): Promise<boolean> {
  return lstat(p).then(() => true, () => false)
}

export async function assertNoSymlinks(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const info = await lstat(full)
    if (info.isSymbolicLink()) {
      throw new HttpError(400, `检测到不安全的符号链接，已中止：${entry.name}`)
    }
    if (info.isDirectory()) {
      await assertNoSymlinks(full)
    }
  }
}

export const isInside = (child: string, parent: string): boolean => child.startsWith(parent + path.sep)

/**
 * Builds the new content next to `target` via `stage`, then swaps it in with renames on the same
 * filesystem. An existing target is moved aside and only deleted after the swap succeeds.
 */
export async function atomicReplace(
  target: string,
  overwrite: boolean,
  stage: (staged: string) => Promise<void>,
): Promise<'created' | 'replaced'> {
  const parent = path.dirname(target)
  const base = path.basename(target)
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const staged = path.join(parent, `.tmp-install-${base}-${suffix}`)
  const backup = path.join(parent, `.tmp-backup-${base}-${suffix}`)

  try {
    await stage(staged)

    const replaced = await exists(target)
    if (replaced) {
      if (!overwrite) throw new HttpError(409, `「${base}」已存在，如需覆盖请勾选「覆盖已存在」`)
      await rename(target, backup)
    }

    try {
      await rename(staged, target)
    } catch (err) {
      if (replaced) {
        await rename(backup, target).catch(() => {
          throw new HttpError(500, `替换失败且无法还原，原内容保留在 ${backup}`)
        })
      }
      throw err
    }

    if (replaced) await rm(backup, { recursive: true, force: true }).catch(() => {})
    return replaced ? 'replaced' : 'created'
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => {})
  }
}
