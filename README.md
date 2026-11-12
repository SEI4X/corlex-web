# Corlex Web SDK

Pre-release browser analytics, consent, Remote Config and optional automatic capture. This is an independently buildable source candidate; a registry release has not been published yet. Install only a reviewed Corlex SDK artifact supplied by your project’s setup instructions.

```ts
import * as corlex from '@corlex/sdk-web'

corlex.init({
  key: '<project SDK write key>',
  endpoint: 'https://your-ingest.example',
  configEndpoint: 'https://your-config.example',
  consent: 'pending',
  autocapture: false,
})
// After the person chooses to allow collection:
corlex.optIn()
corlex.track('expense_created') // Supply only data your application is permitted to collect.
```

Use a project `ck_test_…` or `ck_live_…` SDK write key. MCP, symbol-upload and AI-provider credentials are rejected before storage or network access. Test keys are for testing event delivery; this SDK does not promise separate analytics storage for test events.

SDK state is scoped to the credential and canonical full ingest/config base URLs, including proxy paths, plus a global consent generation. Another project’s pending events, identity, configuration, campaign/session and exposure state cannot be replayed under a different credential. Returning to the same scope can resume its own offline history until consent is withdrawn. `optOut()` fences and removes all SDK scopes, retaining the privacy choice and leaving host application data alone.

Migration discards legacy unbound telemetry/identity/session rows while preserving denied/pending privacy choices. Pending stores only privacy bookkeeping; events stay in memory and no requests are sent. Unreadable privacy storage fails closed. A fresh explicit `optIn()` may enable a new memory-only session when persistence is unavailable, without replaying old state or falling back to an unbound identity cookie. Failed IO cannot guarantee durable deletion across immediate process loss.

Automatic capture omits DOM text, page titles and raw paths by default. Fixed labels can be supplied through `data-corlex-page` and `data-corlex-action`. Error messages are generic unless `captureErrorMessages` is explicitly enabled. Explicit `track`/`identify` properties, campaign tags, developer labels and opted-in error details remain the application developer’s responsibility; this SDK does not guarantee that caller-provided data contains no personal data.

HTTPS is the default. HTTP loopback/emulator endpoints are supported; other HTTP endpoints require the explicit development `allowInsecureHttp` option. Never enable it unconditionally in a production build. Requests refuse redirects and have a total 10-second deadline.

The standalone c.js build is limited to 18 KiB gzip (18,432 bytes), including the bundled SHA-256 implementation and its full MIT notice. Build output and release checksums record its exact size and hash. See THIRD_PARTY_NOTICES for the bundled @noble/hashes license.

Credential and base-URL values are captured at initialization. Changing the caller’s options object does not reconfigure an existing instance; start a new instance for another credential or cell. A stale instance requires explicit activation into a fresh scope.

## Install the reviewed source candidate

Use Node 24.15.0 and pnpm 10.33.4. In this checkout run `pnpm install --frozen-lockfile`, then `pnpm build` and `pnpm pack:check`. Install the resulting .artifacts/corlex-sdk-web-0.1.0.tgz in your host project with your package manager. No registry release or stable Git tag is assumed.

See [build and test](docs/BUILDING.md), [source maps](docs/CRASHES.md), [release process](docs/PUBLISHING.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md) and [MIT license](LICENSE).
