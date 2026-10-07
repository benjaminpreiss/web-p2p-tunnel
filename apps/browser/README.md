# Irys browser client

A **Vite + vanilla TypeScript + CSS** client, with no UI framework, remote fonts,
or browser-side wallet dependencies. The existing Saorsa PQ/WebRTC flow is retained.
The native terminal helper remains in `experiments/relay-spike/`; `web/` is unrelated
legacy code. The pre-migration hosted phone echo passed; this migrated version
still needs a repeat of that real-phone acceptance test.

## Install and build (repository root, normal terminal)

Requires Node 24, Rust stable, `wasm32-unknown-unknown`, and `wasm-pack` on PATH.

```sh
npm ci --prefix apps/browser --ignore-scripts
npm --prefix apps/browser run build
```

The build has three steps:

1. `build.ts` builds release PQ WASM from the locked `crypto/` crate. It remaps
   identifying home, toolchain, dependency and repository paths in Rust output.
2. Vite type-checks/bundles `src/app.ts`, minifies JS/CSS, and emits an intermediate
   `dist/frontend/` folder. `base: "./"` keeps URLs manifest-relative. An explicit
   plugin copies only the generated crypto JS/WASM, after privacy/size/path checks.
   `publicDir` is disabled: arbitrary static files are never automatically copied.
3. `export.ts` validates and prepares both bundles:
   - **`dist/irys-browser/`**: hosted mode, descriptor paste, no local metadata fetch.
   - **`dist/local-browser/`**: local helper mode, retaining guarded session/counter APIs.

Each bundle contains exactly:

```text
index.html
app.js
style.css
pkg/relay_crypto.js
pkg/relay_crypto_bg.wasm
```

The configuration parser is bundled into `app.js`; it is no longer a separate
`hosted-config.mjs` asset. There are no source maps or inlined WASM. The generated
crypto module remains external so its sibling WASM resolution stays unchanged.
The app locates that module relative to the document's manifest URL.

On the first migration build, an old output folder may still contain the obsolete
`hosted-config.mjs`. The exporter deliberately refuses unexpected files instead
of silently deleting them. Review and remove only the obsolete generated output
(or the generated `apps/browser/dist/` directory), then rebuild.

The exporter rejects symlinks, unexpected output, invalid WASM and embedded user
home paths, and writes SHA-256 checksums outside the upload folder. Raw wasm-pack
invocations without path remapping should not be used for publishable assets.
Builds never upload or fund anything. Generated assets and dependencies are ignored.

## Frontend iteration (existing WASM required)

```sh
npm --prefix apps/browser run dev
npm --prefix apps/browser run build:frontend
npm --prefix apps/browser run preview
```

`dev` provides the descriptor-paste UI on loopback. `preview` serves the hosted
production bundle on loopback. Neither starts a relay, supplies session metadata,
or makes an insecure LAN URL safe for phone WebRTC. Use the deployed HTTPS page
for phone acceptance; do not weaken browser security or bind dev servers publicly.
`build:frontend` reuses generated `pkg/` assets and does not invoke Cargo.
`npm --prefix apps/browser run export` only re-exports a previously built Vite
intermediate folder; it does not rebuild stale source code.

## Checks

```sh
npm --prefix apps/browser run typecheck
npm --prefix apps/browser test
npm --prefix apps/browser run test:bundle
```

Browser type checking requires the generated WASM declarations. `test:bundle`
requires built output and executes minified app code plus real PQ WASM with a
minimal browser-API harness at a nested HTTPS manifest path. It verifies hosted
startup makes only crypto-asset requests, local startup additionally fetches
session metadata, and neither connects automatically. It does **not** test visual
rendering, real browser security policy, or actual WebRTC/PQ echo connectivity.
The VM-module flag is for Node tests only.

Node build/export tools and tests are also checked by the publisher's TypeScript
configuration. Install both projects before running that aggregate check:

```sh
npm ci --prefix deployment/irys --ignore-scripts
npm --prefix deployment/irys run typecheck
```

Frontend and publisher dependency trees are separate. The frontend dependency
scan was clean at migration time; that does not resolve the publisher SDK's
previously documented advisories.

## Acceptance and deployment

Rebuild local helpers with `bash experiments/relay-spike/hosted.sh build`; local
HTTP modes now read their generated bundle rather than embedding raw source JS.
The exact Host/Origin/fetch-site checks are unchanged. Hosted helper mode still
starts no HTTP server and needs no frontend files to run.

Publication setup: [Irys publisher](../../deployment/irys/README.md).
After a reviewed PR merges and CI publishes, repeat the
[phone/helper acceptance test](../../experiments/relay-spike/HOSTED.md): fresh
trusted descriptor, authenticated 25-byte echo, and bidirectional terminal bridge
counters. Do not infer mobile success from the offline boot harness alone.
