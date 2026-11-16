import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import * as esbuild from 'esbuild'

const repoRoot = path.resolve('.')
const binariesDir = path.join(repoRoot, 'src-tauri', 'binaries')
fs.mkdirSync(binariesDir, { recursive: true })

console.log('[build-server-bin] Step 1: Generating builtin-skills.generated.json...')
execSync(`node "${path.join(repoRoot, 'scripts', 'generate-builtin-skills.mjs')}"`, { stdio: 'inherit' })

console.log('[build-server-bin] Step 2: Bundling server with esbuild...')
const bundleFile = path.join(binariesDir, 'server.bundle.cjs')

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'web', 'server', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: bundleFile,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})

console.log('[build-server-bin] Step 3: Preparing Node SEA blob...')
const seaConfigPath = path.join(binariesDir, 'sea-config.json')
const blobPath = path.join(binariesDir, 'sea-prep.blob')

fs.writeFileSync(
  seaConfigPath,
  JSON.stringify(
    {
      main: 'server.bundle.cjs',
      output: 'sea-prep.blob',
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  ),
  'utf8'
)

execSync(`"${process.execPath}" --experimental-sea-config sea-config.json`, {
  cwd: binariesDir,
  stdio: 'inherit',
})

console.log('[build-server-bin] Step 4: Copying Node executable and injecting SEA blob...')
const targetExeName =
  process.platform === 'win32'
    ? 'skills-server-x86_64-pc-windows-msvc.exe'
    : process.platform === 'darwin'
    ? 'skills-server-x86_64-apple-darwin'
    : 'skills-server-x86_64-unknown-linux-gnu'

const targetExe = path.join(binariesDir, targetExeName)
fs.copyFileSync(process.execPath, targetExe)

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

const postjectCmd = isWin
  ? `npx.cmd --yes postject "${targetExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
  : isMac
  ? `npx --yes postject "${targetExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA`
  : `npx --yes postject "${targetExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`

execSync(postjectCmd, { stdio: 'inherit' })

console.log('[build-server-bin] Step 5: Cleaning up temporary build artifacts...')
try {
  if (fs.existsSync(seaConfigPath)) fs.unlinkSync(seaConfigPath)
  if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath)
  if (fs.existsSync(bundleFile)) fs.unlinkSync(bundleFile)
} catch (e) {
  console.warn('Cleanup warning:', e)
}

console.log(`[build-server-bin] Successfully created standalone server executable at: ${targetExe}`)
