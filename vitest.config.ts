import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { projects: [
  { extends: true, test: { name: 'web', environment: 'jsdom', globals: true, include: ['src/**/*.test.ts'] } },
  { extends: true, test: { name: 'core', environment: 'node', globals: true, include: ['internal/**/*.test.ts'] } },
] } })
