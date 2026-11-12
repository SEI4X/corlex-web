import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
export default tseslint.config(
  { ignores: ['dist/**', '.artifacts/**', 'coverage/**'] },
  js.configs.recommended, ...tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: {
    'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 3], 'max-depth': ['error', 3],
  } },
  { files: ['**/*.test.ts', '**/test/**', '**/*.test.mjs'], rules: { 'max-lines-per-function': 'off', 'max-lines': 'off' } },
)
