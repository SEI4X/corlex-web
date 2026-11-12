import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
const browser = { document: { currentScript: null }, window: {}, console }
try {
  runInNewContext(readFileSync(new URL('../dist/c.js', import.meta.url), 'utf8'), browser, { timeout: 1000 })
  assert.equal(typeof browser.window.corlex?.init, 'function')
  assert.equal(typeof browser.window.corlex?.config?.get, 'function')
} catch (error) {
  console.error('Standalone browser bundle failed:', error.message)
  process.exitCode = 1
}
