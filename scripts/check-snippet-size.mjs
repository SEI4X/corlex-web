// Fails when dist/c.js is over the 18 KiB gzip security-path budget (ADR007).
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

export const BUDGET_BYTES = 18 * 1024
const file = new URL('../dist/c.js', import.meta.url)

let source
try {
  source = readFileSync(file)
} catch {
  console.error('dist/c.js not found: run `pnpm --filter @corlex/sdk-web build` first')
  process.exit(1)
}
const size = gzipSync(source, { level: 9 }).length
console.log(`c.js: ${source.length} B raw, ${size} B gzip (budget ${BUDGET_BYTES} B)`)
if (size > BUDGET_BYTES) {
  console.error(`c.js is over the gzip budget by ${size - BUDGET_BYTES} B`)
  process.exit(1)
}
