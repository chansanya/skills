import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import builtinSkills from './builtin-skills.generated.json' with { type: 'json' }

const here = path.dirname(fileURLToPath(import.meta.url))

function resolveRepoRoot(): string {
  if (process.env.SKILLS_REPO_ROOT) {
    return path.resolve(process.env.SKILLS_REPO_ROOT)
  }
  // If running inside repo directory (e.g. dev or cloned source)
  const repoCandidate = path.resolve(here, '../../..')
  if (fs.existsSync(path.join(repoCandidate, 'multi-agent-cli', 'SKILL.md'))) {
    return repoCandidate
  }
  // In packaged desktop application: persist skills in user profile
  return path.join(os.homedir(), '.skills-manager', 'skills')
}

export const REPO_ROOT = resolveRepoRoot()
export const HOST = '127.0.0.1'
export const PORT = 3001

export const IGNORED_DIRS = new Set([
  'web',
  'docs',
  'node_modules',
  'dist',
  '.git',
  'src-tauri',
  'scripts',
])

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export async function initRepoRoot(): Promise<void> {
  await fsPromises.mkdir(REPO_ROOT, { recursive: true })

  try {
    const entries = await fsPromises.readdir(REPO_ROOT, { withFileTypes: true })
    const hasSkills = entries.some((e) => e.isDirectory() && !e.name.startsWith('.'))
    if (!hasSkills && builtinSkills && typeof builtinSkills === 'object') {
      console.log(`[skills server] Seeding ${Object.keys(builtinSkills).length} builtin skills into ${REPO_ROOT}...`)
      for (const [skillName, files] of Object.entries(builtinSkills as Record<string, Record<string, string>>)) {
        const skillDir = path.join(REPO_ROOT, skillName)
        await fsPromises.mkdir(skillDir, { recursive: true })
        for (const [relPath, content] of Object.entries(files)) {
          const filePath = path.join(skillDir, relPath)
          await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
          await fsPromises.writeFile(filePath, content, 'utf8')
        }
      }
      console.log('[skills server] Builtin skills seeded successfully.')
    }
  } catch (err) {
    console.warn('[skills server] Failed to seed builtin skills:', err)
  }
}

