import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve('.')
const IGNORED = new Set(['web', 'docs', 'node_modules', 'dist', '.git', 'src-tauri', 'scripts'])

function getSkillDirs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries
    .filter(e => e.isDirectory() && !IGNORED.has(e.name) && !e.name.startsWith('.'))
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(dir, name, 'SKILL.md')))
}

function collectFiles(baseDir, currentRel = '') {
  const currentPath = path.join(baseDir, currentRel)
  const entries = fs.readdirSync(currentPath, { withFileTypes: true })
  const files = {}
  for (const entry of entries) {
    const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        Object.assign(files, collectFiles(baseDir, rel))
      }
    } else if (entry.isFile()) {
      const fullPath = path.join(baseDir, rel)
      const buffer = fs.readFileSync(fullPath)
      files[rel] = buffer.toString('utf8')
    }
  }
  return files
}

const skills = getSkillDirs(REPO_ROOT)
const bundle = {}
for (const s of skills) {
  bundle[s] = collectFiles(path.join(REPO_ROOT, s))
}

const targetPath = path.join(REPO_ROOT, 'web', 'server', 'src', 'builtin-skills.generated.json')
fs.writeFileSync(targetPath, JSON.stringify(bundle, null, 2), 'utf8')
console.log(`Generated builtin-skills.generated.json with ${skills.length} skills.`)
