import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  truncated?: boolean
}

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  input?: string
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
  onData?: (chunk: string) => void
}

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-_]/g
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024 // 1 MiB
const KILL_GRACE_MS = 2000

export const stripAnsi = (s: string): string => s.replace(ANSI_RE, '')

function killTree(pid: number | undefined, sig: NodeJS.Signals): void {
  if (!pid) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, sig)
      return
    } catch {
      // fall back to direct child kill
    }
  }
  try {
    process.kill(pid, sig)
  } catch {
    // already exited
  }
}

export function run(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new Error('操作已取消'))
      return
    }

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    let stdout = ''
    let stderr = ''
    let totalBytes = 0
    let truncated = false
    let settled = false
    let forceTimer: NodeJS.Timeout | undefined

    const terminate = () => {
      killTree(child.pid, 'SIGTERM')
      forceTimer = setTimeout(() => killTree(child.pid, 'SIGKILL'), KILL_GRACE_MS)
    }

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (forceTimer) clearTimeout(forceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => terminate()
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const timer = opts.timeoutMs ? setTimeout(terminate, opts.timeoutMs) : undefined

    const append = (target: 'stdout' | 'stderr', chunk: string) => {
      opts.onData?.(chunk)
      const bytes = Buffer.byteLength(chunk, 'utf8')
      if (totalBytes + bytes > maxBytes) {
        truncated = true
        return
      }
      totalBytes += bytes
      if (target === 'stdout') stdout += chunk
      else stderr += chunk
    }

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => append('stdout', chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => append('stderr', chunk))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ code: code ?? -1, stdout, stderr, truncated })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(opts.input ?? '')
  })
}
