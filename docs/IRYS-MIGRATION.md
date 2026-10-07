# Irys publisher: status and migration handoff

## Summary

**The upload implementation works and is reusable, but is not yet a generic static-site uploader.** Copy the publisher package and CI workflow, then replace the browser-specific asset validation, build steps, and paths. You do not need the tunnel, relay, Rust, or WASM code to publish a different website.

This report describes the inspected working tree at base commit `186421f`, including existing uncommitted documentation updates. Those updates record successful user-run publication and hosted-phone acceptance; older “not deployed yet” passages in the repository are historical.

## Current status

- Publishes to Irys L1 mainnet beta through `https://uploader.irys.xyz`, paid with **native USDC on Solana**. The wallet also needs SOL for network fees.
- Signs each asset locally, builds an `irys/paths` manifest with `index.html` as its index, quotes the signed items, uploads assets, then uploads the manifest last.
- Produces a new immutable `https://gateway.irys.xyz/<manifest-id>/` URL per deployment. There is no stable domain, mutable latest pointer, or automatic update of previous URLs.
- CI publishes only after a PR is merged into `main`, from prepaid credit. Direct pushes do not deploy. Manual dispatch can explicitly fund credit but cannot publish.
- Funding tops up only the shortfall to a requested balance; publication does not implicitly fund the wallet. Manual funding currently still builds, validates, signs, and quotes a website before funding—it is not an independent wallet utility.
- Progress and public receipts are written to `deployment/irys/reports/publication.json` and retained as CI artifacts, including partial failures. Raw SDK errors are suppressed to avoid exposing credentials.
- Repository status records successful real funding, all five assets plus manifest uploaded, and successful hosted-phone browser loading before and after the Vite migration. The baseline recorded quote was **0.001880 USDC**, not a current price estimate or independently verified debit.
- Checked for this report: **TypeScript check passed; all 12 publisher tests passed** on Node 24.20.0. Includes offline signing with the actual pinned SDK. No upload, funding, live balance query, or fresh audit was performed for this report.

This establishes the existing static-site publication path, not universal browser compatibility, Service Worker routing, or production readiness of the unrelated tunnel.

## Files to copy

Keep the same paths initially to minimize edits.

| File | Purpose | Migration action |
| --- | --- | --- |
| `deployment/irys/publication.ts` | Asset validation, amounts, transaction IDs, signing, manifest, quotes, funding and uploads | Keep core logic; adapt `FILES` and `loadSite()` to the new website |
| `deployment/irys/publish.ts` | CLI, GitHub event guards, SDK/RPC setup, reports | Adapt input/output paths, event policy if needed, and project-specific summary text |
| `deployment/irys/publication.test.ts` | Offline behavior and safety regression tests | Keep; update website fixtures and validator tests |
| `deployment/irys/sdk-signing.test.ts` | Real SDK offline signing regression | Keep, particularly the base58 transaction-ID regression |
| `deployment/irys/package.json` | Scripts, Node requirement, pinned SDK and security override | Keep; optionally rename the package |
| `deployment/irys/package-lock.json` | Reproducible dependency tree | Copy with package.json; do not substitute a fresh unreviewed resolution |
| `deployment/irys/tsconfig.json` | Strict TypeScript checks | Change `include` to `["*.ts"]` for a standalone publisher |
| `deployment/irys/.gitignore` | Excludes installed dependencies and reports | Keep |
| `deployment/irys/README.md` | Operations, secret setup, failure recovery | Copy and adapt; fix links and remove old application-specific/history passages |
| `.github/workflows/irys.yaml` | Build artifact, protected funding/publication, receipts | Use as a template; replace this project's frontend/Rust build steps |

Optional supporting documentation:

- `docs/research/irys-ci-publication.md`: payment, SDK, manifest, and dependency findings.
- `docs/research/irys-browser-entrypoint.md`: gateway/CDN behavior, origin changes, Service Worker caveats.
- This report: `docs/IRYS-MIGRATION.md`.

### Copy command

Run from this repository with `DEST` pointing to an existing destination repository. Review existing destination files first: `cp` overwrites matching files. Explicit filenames avoid copying installed dependencies or local reports.

```sh
DEST=/absolute/path/to/destination-repo
mkdir -p "$DEST/deployment/irys" "$DEST/.github/workflows"
for file in .gitignore README.md package.json package-lock.json tsconfig.json \
  publication.ts publish.ts publication.test.ts sdk-signing.test.ts; do
  cp "deployment/irys/$file" "$DEST/deployment/irys/$file"
done
cp .github/workflows/irys.yaml "$DEST/.github/workflows/irys.yaml"
```

This copies current working-tree files, including the locally updated README, rather than only the last committed versions.

## Required adaptations

### 1. Replace the website contract

`publication.ts` currently accepts exactly:

```text
index.html
app.js
style.css
pkg/relay_crypto.js
pkg/relay_crypto_bg.wasm
```

`loadSite()` also allows only the `pkg` subdirectory, requires `data-fixture="hosted"` in HTML, rejects local-mode HTML, checks the WASM header, limits each file to 16 MiB, rejects symlinks and embedded user-home paths, and rejects missing/extra assets.

For a different app, replace the exact allowlist, directory rules, HTML marker and mandatory WASM check. Merely changing the input directory is insufficient. Typical Vite output uses hashed names under `assets/`, which this implementation rejects. Preserve explicit rules excluding secrets, source maps, logs, and non-public files; do not replace this with an unrestricted repository upload.

Keep explicit MIME types, relative asset URLs and a valid index path. `preparePublication()` hardcodes `index.html`; change that if your entry point differs. It expects already validated assets and is not a replacement for `loadSite()`.

### 2. Remove path and typecheck coupling

- `publish.ts` resolves the repo root as `../../` relative to itself. This remains correct if you retain `deployment/irys/`.
- Change its input from `apps/browser/dist/irys-browser` to your public build folder.
- Keep or change its report path, then match the workflow's receipt-artifact path.
- Remove the diagnostic-specific sentence from its GitHub summary.
- Set `tsconfig.json` `include` to `["*.ts"]`. The current config also checks `apps/browser` build scripts, tests, and smoke tests; those require the separate browser project and its dependencies.
- Use Node **24+**: TypeScript executes through native type stripping, not ts-node/tsx.

### 3. Replace build orchestration, retain deployment safeguards

In `.github/workflows/irys.yaml`:

- Replace browser dependency installation, tests, Rust/wasm-pack installation, WASM compilation, frontend export and bundle smoke tests with the destination app's build/check commands.
- Update npm cache paths and both website artifact upload/download paths. The downloaded folder must match `publish.ts`.
- Keep publisher installation with `--ignore-scripts`, typecheck and tests. Keep runtime `--no-addons` in package scripts.
- Preserve protected environment approval, step-scoped secrets, minimum permissions, SHA-pinned actions, merge-commit checkout and `cancel-in-progress: false`.
- Do not broaden `pull_request_target` to run unmerged PR code with secrets. Both jobs currently check out the merge commit, never an untrusted PR head.
- If the destination uses a branch other than `main`, update workflow triggers/conditions, `isMergedMainEvent()`, the CLI funding guard, tests, and environment restrictions together.

This is a GitHub Actions-oriented CLI, not a generic local deploy command. If you want another CI provider or manual local publication, explicitly redesign the event guards rather than spoofing GitHub environment variables.

### 4. Recreate repository configuration

Copying files does **not** transfer GitHub secrets, variables, environment approvals, branch protection, or wallet custody.

- Create environment `irys-production`, restricted to `main`; require approval where supported.
- Configure environment secret `IRYS_WALLET_KEY`: base58-encoded 64-byte Solana secret key, not a seed phrase or JSON array. Never commit or copy it into project files.
- Optionally configure secret `IRYS_SOLANA_RPC_URL` for an HTTPS Solana-mainnet RPC.
- Optional environment variables: `IRYS_MAX_UPLOAD_USDC` (default `0.10`) and `IRYS_MAX_FUND_USDC` (default `1.00`).
- Leave repository variable `IRYS_PUBLISH_ENABLED` unset until review and build checks are complete; set to `true` to enable the guarded release job.
- Choose whether to reuse the dedicated wallet or create a new one. Copying code does not migrate prepaid credit to a different wallet. If reusing the wallet, coordinate/disable the old publisher: workflow concurrency does not serialize spending across repositories.

## What not to copy

For uploader-only migration, omit `apps/browser/`, `experiments/relay-spike/`, `web/`, Go services, Rust crates and generated WASM. Their presence in the current workflow is a website-build dependency, not an Irys SDK requirement.

Do not copy `node_modules/`, generated `dist/`, local `reports/`, `.env` files, wallet keys, session descriptors or helper logs. Carry over appropriate secret/build ignore rules from the root `.gitignore` without blindly overwriting the destination's existing rules.

If you also want this exact website, that is a separate frontend migration; the publisher files alone do not build it.

## Verification and remaining risks

After adaptation, from the destination repository:

```sh
npm ci --prefix deployment/irys --ignore-scripts
npm --prefix deployment/irys run typecheck
npm --prefix deployment/irys test
npm --prefix deployment/irys audit --omit=dev
```

Then build the destination website and test its new asset-validation contract without invoking the financial CLI. Run CI with publishing disabled first. Once reviewed and configured, explicitly fund if needed, merge a PR to publish, and verify the resulting gateway page and nested assets in a browser.

**Do not use `publish:site` as a test.** It is the real funding/publication entry point.

Known caveats to retain in the new repository:

- SDK dependency advisories were previously reported. The locked `ws` override and `--ignore-scripts`/`--no-addons` mitigate specific risks, not all dependency risk. The pure-JS bigint fallback warning during tests is expected; do not enable native addons just to silence it.
- Quote ceilings are not binding price locks, do not include SOL fees, and do not cap spending across multiple runs.
- Uploads are not atomic or resumable by this code. Partial success can cost money; rerunning signs new items and may charge again.
- Ambiguous funding failures must be reconciled against wallet history and Irys credit before retrying.
- Published assets and wallet metadata are public. Gateway URLs are shareable; CDN origins may change. No custom-domain, cache-invalidation, deduplication, automatic rollback, or Service Worker compatibility guarantee is implemented here.
