import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const banner =
  '/*!\n' + readFileSync(new URL('./THIRD_PARTY_NOTICES', import.meta.url), 'utf8') + '\n*/'

export default defineConfig([
  // The npm package: ESM plus types.
  {
    entry: ['src/index.ts'],
    banner,
    format: 'esm',
    platform: 'browser', deps: { alwaysBundle: [/^@noble\/hashes(?:\/|$)/] },
    target: 'es2022',
    dts: { eager: true },
  },
  // The no-code snippet: one minified IIFE, served as c.js.
  {
    entry: { c: 'src/snippet.ts' },
    banner,
    format: 'iife',
    platform: 'browser', deps: { alwaysBundle: [/^@noble\/hashes(?:\/|$)/] },
    target: 'es2020',
    minify: true,
    dts: false,
    clean: false,
    outputOptions: { entryFileNames: '[name].js' },
  },
])
