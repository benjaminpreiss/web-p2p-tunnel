# Browser tunnel controller

A **Vite + vanilla TypeScript + CSS** controller, with no UI framework, remote
fonts or wallet dependencies. Chrome/Brave owns the Saorsa PQ/WebRTC session;
`experiments/relay-spike/` contains the computer helper. `web/` is unrelated legacy
Go/signaling code.

The APK-delivered controller has passed the authorized bounded LAN HTTP test:
publisher authentication, visitor authorization, expected HTML/CSS, bidirectional
relay counters and clean shutdown. Responses are inert text/base64—not executable
target pages. See [HTTP inspector instructions](../../docs/HTTP-INSPECTOR.md).
The former Irys publisher and deployment workflow have been removed.

## Install and build (repository root)

Requires Node 24, Rust stable, `wasm32-unknown-unknown`, and `wasm-pack` on PATH.

```sh
npm ci --prefix apps/browser --ignore-scripts
npm --prefix apps/browser run build
```

1. `build.ts` builds release PQ WASM from the locked `crypto/` crate, remapping
   identifying home, toolchain, dependency and repository paths.
2. Vite bundles `src/app.ts` and CSS into `dist/frontend/`. Relative URLs and
   explicit crypto asset copying preserve nested-path delivery. No framework,
   arbitrary public directory, source maps or inlined WASM.
3. `export.ts` checks and prepares:
   - **`dist/hosted-browser/`**: manual descriptor/token entry, no metadata server.
   - **`dist/local-browser/`**: the desktop helper's guarded session/counter APIs.

“Hosted” means manually configured standalone controller, not a particular hosting
provider. Android stages that same mode in its APK at `/controller/`.

Each bundle contains exactly:

```text
index.html
app.js
style.css
pkg/relay_crypto.js
pkg/relay_crypto_bg.wasm
```

The exporter rejects symlinks, unexpected output, invalid WASM and embedded home
paths. Checksums stay outside the asset directory. Build/export never deploys
anything. Generated assets/dependencies are ignored. Unexpected old output must
be reviewed explicitly, never silently deleted by the exporter.

## Frontend iteration (existing WASM required)

```sh
npm --prefix apps/browser run dev
npm --prefix apps/browser run build:frontend
npm --prefix apps/browser run preview
```

Dev/preview serve the manual-descriptor UI on computer loopback; they do not start
a relay or supply metadata. `build:frontend` reuses generated `pkg/` files and does
not run Cargo. `npm --prefix apps/browser run export` only exports already-built
frontend files, so use the build command after source changes.

For phone testing, use the [Android static server](../android-controller/README.md).
Do not bind development servers publicly or weaken browser security.

## Checks

```sh
npm --prefix apps/browser run typecheck
npm --prefix apps/browser test
npm --prefix apps/browser run test:bundle
```

Type checking covers both the browser UI and Node build/export/test tools through
`tsconfig.json` and `tsconfig.tools.json`; generated WASM declarations are required.
There is no publisher project or SDK dependency.

`test:bundle` requires built output. It checks the five-file allowlist and runs
minified app code plus real PQ WASM at nested URLs using a browser-API harness.
Hosted startup loads only crypto assets; local startup also fetches session
metadata. Neither connects automatically. The harness does not prove visual
rendering, real CSP enforcement or WebRTC connectivity. The VM flag is test-only.

## APK delivery and acceptance

```sh
node apps/android-controller/prepare.ts
```

Then rebuild/run the Android project and manually open
`http://127.0.0.1:18787/controller/` on the phone. Preparation uses the current
working tree; no commit, merge or deployment is needed. See
[Android instructions](../android-controller/README.md) for build prerequisites,
the known launch-button 403, cleanup and the repeatable HTTP test.

Rebuild the computer helper with `bash experiments/relay-spike/hosted.sh build`.
Its `browser-hosted` mode needs no frontend files or HTTP metadata server. Use
fresh descriptors/private grants and verify actual results plus final bridge
counters. Stopping the Android file server does not revoke an existing browser
connection; stop the computer helper and close the controller tab.
