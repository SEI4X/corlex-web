# Browser errors and source maps

JavaScript errors are captured when the corresponding optional autocapture is enabled. Messages are generic by default; captureErrorMessages explicitly permits bounded details. Caller properties/details still require a data review. Delivery verification does not prove source-map lookup.

Use `node scripts/upload-sourcemaps.mjs <final.map> <deployed bundle filename> _` for an unversioned Web release from the host build. The build-only uploader accepts the project symbol token through CI environment or `scripts/with-symbols.sh`; it removes embedded source content, bounds input, rejects redirects and requires HTTPS outside loopback development. Keep the deployed hashed bundle basename and matching map. Never expose MCP, symbol-upload or provider credentials in browser resources.
