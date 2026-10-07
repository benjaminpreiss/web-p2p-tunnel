# Irys browser client

The current browser/PQ echo diagnostic lives here, outside `experiments/`.
The native terminal helper and MASQUE fixture remain in `experiments/relay-spike/`.
The older `web/` directory is unrelated legacy code.

This is still native JavaScript/HTML/CSS, **not yet a Vite app**. Build/export tools
are TypeScript, executed by Node 24 without an extra runtime or Python. Vite and
frontend TypeScript migration are separate follow-up work.

## Build (repository root, normal terminal)

Requires Node 24, Rust stable, the `wasm32-unknown-unknown` target, and `wasm-pack`
on PATH. CI installs these tools separately.

```sh
npm --prefix apps/browser run build
```

`build.ts` builds release PQ WASM from `crypto/` with the committed Cargo lockfile.
It remaps local home, toolchain, dependency and repository paths so compiler
panic/debug strings do not disclose personal paths. Raw `wasm-pack` invocations
without these mappings should not be used for publishable assets.

`export.ts` prepares `dist/irys-browser/` using an explicit five-file allowlist,
changes the HTML marker to hosted mode, checks WASM, rejects embedded user-home
paths and symlinks, and refuses unexpected existing output files. Checksum output
is beside the folder, not inside it. Nothing is uploaded or funded by this build.
Generated `pkg/`, `crypto/target/` and `dist/` are Git-ignored.

Regenerate only the static folder, using existing safe WASM:

```sh
npm --prefix apps/browser run export
```

Previously generated local WASM contained identifying build paths and was removed.
A fresh build is required before exporting or serving local browser fixtures.

## Checks

```sh
npm --prefix apps/browser test
npm --prefix deployment/irys run typecheck
```

The second command requires `npm ci --prefix deployment/irys --ignore-scripts`;
its TypeScript configuration also checks the browser build/export tools and tests.
No wallet is needed for checks, builds, or exports. Do not add session descriptors,
wallet files, logs or local environment files to the upload bundle.

Publication setup: [Irys publisher](../../deployment/irys/README.md).
Phone/helper acceptance: [hosted gate](../../experiments/relay-spike/HOSTED.md).
