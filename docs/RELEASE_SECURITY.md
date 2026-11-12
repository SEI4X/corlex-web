# Source candidate validation — 2026-11-12

Runtime source matches reviewed Web/Core checkpoint333793bc0; build-only source-map tooling includes f8bef985. This repository has only public bootstrap ancestry, with no private server source/history. Exporterb8755b24 uses a strict source allowlist and regular-file checks.

Independent validation: frozen install, lint, types,339 Web/Core/pure-helper tests and8 real uploader tests. Both bundles build, the standalone browser snippet executes without external package globals and stays below18KiB gzip. The npm archive is also checked in a separate consumer. Default/SDK credential secret checks and all-severity dependency audit are release gates.

Runtime @noble/hashes2.4.0 is MIT; its complete license is retained in THIRD_PARTY_NOTICES and bundle banners. The frozen pnpm lockfile pins build dependencies; dependency-licenses.json records reported licenses without local machine paths. No consumer install/prepare hooks exist. Source maps/upload credentials stay build-only.

Limits: client SDK keys are observable write-only credentials; opted-in error details and caller event properties require a host data review. Checksums, an empty dated advisory scan and source tests do not establish absence of all vulnerabilities or legal compliance. This is a source candidate, not a registry publication.
