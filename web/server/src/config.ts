import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = path.resolve(process.env.SKILLS_REPO_ROOT ?? path.join(here, '../../..'))
export const HOST = '127.0.0.1'
export const PORT = 3001

export const IGNORED_DIRS = new Set(['web', 'docs', 'node_modules', 'dist'])

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
