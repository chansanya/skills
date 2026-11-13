import fs from 'node:fs/promises'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { listTargets, syncToAgents, validateAgentSync } from './agents.js'
import { HOST, PORT, REPO_ROOT } from './config.js'
import { HttpError } from './errors.js'
import { importArchive, importFolder, uploadMiddleware } from './import.js'
import { inspectSkill, installInspected, installSkill, validateInstall } from './install.js'
import { analyzeRepository, installRepositorySkills } from './repository.js'
import { searchSkills } from './search.js'
import { getSkill, getSkillFile, listSkills } from './skills.js'

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost'])

const hostname = (value: string): string | null => {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname
  } catch {
    return null
  }
}

const app = express()
app.disable('x-powered-by')

app.use((req, res, next) => {
  const host = hostname(req.headers.host ?? '')
  const origin = req.headers.origin
  if (!host || !ALLOWED_HOSTS.has(host) || (origin && !ALLOWED_HOSTS.has(hostname(origin) ?? ''))) {
    res.status(403).json({ error: '仅允许本机访问' })
    return
  }
  next()
})

app.use(express.json({ limit: '32kb' }))

app.get('/api/skills', async (_req, res) => {
  res.json({ skills: await listSkills() })
})

app.get('/api/skills/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : ''
  res.json({ skills: await searchSkills(query) })
})

app.get('/api/skills/recommended', async (_req, res) => {
  const filePath = path.join(REPO_ROOT, 'recommended-skills.json')
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    res.json({ skills: JSON.parse(raw) })
  } catch {
    res.json({ skills: [] })
  }
})

app.post('/api/skills/repository/inspect', async (req, res) => {
  res.json(await analyzeRepository(req.body))
})

app.post('/api/skills/repository/install', async (req, res) => {
  res.json(await installRepositorySkills(req.body))
})

app.get('/api/skills/:name/file', async (req, res) => {
  const filePath = typeof req.query.path === 'string' ? req.query.path : ''
  if (!filePath) throw new HttpError(400, '缺少 path 参数')
  const file = await getSkillFile(req.params.name, filePath)
  if (!file) throw new HttpError(404, `未找到文件：${filePath}`)
  res.json(file)
})

app.get('/api/skills/:name', async (req, res) => {
  const skill = await getSkill(req.params.name)
  if (!skill) throw new HttpError(404, `未找到 Skill：${req.params.name}`)
  res.json(skill)
})

app.post('/api/skills/inspect', async (req, res) => {
  res.json(await inspectSkill(req.body))
})

app.post('/api/skills/install-inspected', async (req, res) => {
  res.json(await installInspected(req.body))
})

app.post('/api/skills/install', async (req, res) => {
  const request = await validateInstall(req.body)

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) ac.abort()
  })

  const send = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const result = await installSkill(request, (line) => send('log', { line }), ac.signal)
    send('done', result)
  } catch (err) {
    if (!ac.signal.aborted) {
      send('error', { message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    if (!res.writableEnded) res.end()
  }
})

app.post('/api/skills/import-folder', uploadMiddleware('folder'), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined
  res.json(await importFolder(files, req.body))
})

app.post('/api/skills/import-archive', uploadMiddleware('archive'), async (req, res) => {
  res.json(await importArchive(req.file, req.body))
})

app.get('/api/agents/targets', async (_req, res) => {
  res.json({ targets: await listTargets() })
})

app.post('/api/agents/sync', async (req, res) => {
  const request = await validateAgentSync(req.body)
  res.json({ results: await syncToAgents(request) })
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : (err as { status?: number })?.status ?? 500
  const message = err instanceof Error ? err.message : String(err)
  if (status >= 500) console.error(err)
  if (res.headersSent) {
    res.end()
    return
  }
  res.status(status).json({ error: message })
})

app.listen(PORT, HOST, () => {
  console.log(`skills server listening on http://${HOST}:${PORT} (repo: ${REPO_ROOT})`)
})
