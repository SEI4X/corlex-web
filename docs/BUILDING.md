# Build and test

Use Node 24.15.0 and pnpm 10.33.4. Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --audit-level low`, then `pnpm pack:check`. No installation lifecycle hooks run. The npm archive contains built SDK files, build-only symbol tooling and notices; tests/internal source remain in Git.

The no-code c.js is self-contained and subject to its exact gzip size gate. Verify actual generated checksums/SRI before deployment. Source maps and privileged upload credentials stay outside the browser bundle.
