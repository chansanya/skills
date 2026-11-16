import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const iconsDir = path.join(repoRoot, 'src-tauri', 'icons')

const inputPng = path.join(iconsDir, 'icon.png')
const outputIco = path.join(iconsDir, 'icon.ico')

console.log('Generating high-res multi-layer icon.ico from:', inputPng)

const cmd = process.platform === 'win32'
  ? `npx.cmd --yes png-to-ico "${inputPng}"`
  : `npx --yes png-to-ico "${inputPng}"`

const buf = execSync(cmd, { maxBuffer: 10 * 1024 * 1024 })
fs.writeFileSync(outputIco, buf)

console.log('Generated icon.ico byteLength:', buf.length)
const count = buf.readUInt16LE(4)
console.log('Layer count:', count)
for (let i = 0; i < count; i++) {
  const offset = 6 + i * 16
  const w = buf[offset] || 256
  const h = buf[offset + 1] || 256
  const size = buf.readUInt32LE(offset + 8)
  console.log(`Layer ${i}: ${w}x${h} (${size} bytes)`)
}
