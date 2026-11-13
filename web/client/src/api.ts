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

export interface SkillFileContent {
  path: string
  size: number
  binary: boolean
  tooLarge: boolean
  content: string | null
}

export interface ImportResult {
  name: string
  dir: string
  replaced: boolean
}

export interface InspectResult {
  inspectId: string
  name: string
  description: string
  repo: string
  files: string[]
  existsLocally: boolean
}

export type SyncMode = 'copy' | 'symlink'

export interface AgentTarget {
  id: string
  label: string
  env: 'wsl' | 'host'
  envLabel: string
  path: string
  displayPath: string
  parentExists: boolean
  exists: boolean
  isCrossEnv: boolean
}

export interface SkillSyncResult {
  skill: string
  status: 'synced' | 'skipped' | 'error'
  message?: string
}

export interface TargetSyncResult {
  id: string
  label: string
  env: 'wsl' | 'host'
  path: string
  displayPath: string
  error?: string
  skills: SkillSyncResult[]
}

export interface InstallPayload {
  source: string
  skill?: string
  overwrite: boolean
}

export interface InstallHandlers {
  onLog: (line: string) => void
  onDone: (result: { name: string; dir: string }) => void
  onError: (message: string) => void
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const res = await fetch(url, {
    ...init,
    headers: isFormData ? init?.headers : { 'Content-Type': 'application/json', ...init?.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `请求失败：${res.status}`)
  return data as T
}

export const api = {
  listSkills: () => request<{ skills: SkillSummary[] }>('/api/skills').then((r) => r.skills),
  getSkill: (name: string) => request<SkillDetail>(`/api/skills/${encodeURIComponent(name)}`),
  getSkillFile: (name: string, filePath: string) =>
    request<SkillFileContent>(`/api/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(filePath)}`),

  listAgentTargets: () => request<{ targets: AgentTarget[] }>('/api/agents/targets').then((r) => r.targets),
  syncToAgents: (payload: { skills: string[]; targets: string[]; overwrite: boolean; mode: SyncMode }) =>
    request<{ results: TargetSyncResult[] }>('/api/agents/sync', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((r) => r.results),

  inspectSkill: (payload: { source: string; skill?: string }) =>
    request<InspectResult>('/api/skills/inspect', { method: 'POST', body: JSON.stringify(payload) }),
  installInspected: (payload: { inspectId: string; overwrite: boolean }) =>
    request<{ name: string; dir: string }>('/api/skills/install-inspected', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  importFolder: (files: File[], skillName: string | undefined, overwrite: boolean) => {
    const form = new FormData()
    const paths = files.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name)
    form.append('paths', JSON.stringify(paths))
    if (skillName) form.append('skillName', skillName)
    form.append('overwrite', String(overwrite))
    for (const f of files) form.append('files', f, f.name)
    return request<ImportResult>('/api/skills/import-folder', { method: 'POST', body: form })
  },

  importArchive: (file: File, skillName: string | undefined, overwrite: boolean) => {
    const form = new FormData()
    form.append('file', file, file.name)
    if (skillName) form.append('skillName', skillName)
    form.append('overwrite', String(overwrite))
    return request<ImportResult>('/api/skills/import-archive', { method: 'POST', body: form })
  },

  async install(payload: InstallPayload, handlers: InstallHandlers): Promise<void> {
    const res = await fetch('/api/skills/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      handlers.onError((data as { error?: string }).error ?? `请求失败：${res.status}`)
      return
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let completed = false

    const dispatch = (block: string) => {
      const event = /^event: (.+)$/m.exec(block)?.[1]
      const raw = /^data: (.+)$/m.exec(block)?.[1]
      if (!event || !raw) return
      const data = JSON.parse(raw)
      if (event === 'log') handlers.onLog(data.line)
      else if (event === 'done') {
        completed = true
        handlers.onDone(data)
      } else if (event === 'error') {
        completed = true
        handlers.onError(data.message)
      }
    }

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let idx: number
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        dispatch(block)
      }
    }

    if (buffer.trim()) dispatch(buffer.trim())
    if (!completed) {
      handlers.onError('安装连接意外中断，请检查服务端状态')
    }
  },
}
