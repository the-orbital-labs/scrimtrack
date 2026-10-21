import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export default function buildExtension() {
  execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-b'], { stdio: 'inherit' })
  execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], { stdio: 'inherit' })
}
