# Publish the browser website to Irys

The Pages workflow is replaced by `.github/workflows/irys.yaml`. It builds the
**current PQ/MASQUE browser diagnostic**, not the historical signaling-based
`web/` application. No real upload, funding transaction, or GitHub environment
configuration has been performed by the agent. The user has completed the initial
funding, publication, and hosted-phone LAN echo. The Vite migration is checked
locally but still needs its own CI publication and real-phone acceptance run.

## Frontend choice

The active app is now **Vite + vanilla TypeScript + CSS**, with no UI framework.
Vite bundles/minifies the UI, while an explicit exporter preserves the bounded
upload allowlist. The generated crypto JS/WASM remain external, at stable relative
paths. The legacy `web/` app is unchanged. See
[`apps/browser/README.md`](../../apps/browser/README.md) for build and dev commands.

The new publisher and its tests **are TypeScript**, checked with `tsc`, and run
using Node 24's native type stripping. No `any`-based SDK wrapper or transpilation
runtime is needed. Publishing dependencies are separate from website assets.
Release WASM is built from the committed Cargo lockfile and pinned Saorsa revision.
The browser build and exporter are TypeScript too (`apps/browser/build.ts` and
`export.ts`); Python is no longer needed. Rust paths are anonymized before compilation,
and export/publication reject embedded user-home paths. Old local WASM assets
containing identifying paths were removed and must be rebuilt before use.
The WASM dominates transfer size; use the release artifact's actual size rather
than assuming a framework change saves much. WASM optimization/minification and
UI styling can be improved separately without changing the tunnel protocol.

## Payment choice

The configured token is **native USDC on Solana**, mint:

`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

This is a low-fee default, **not a claim of the live cheapest chain**. Irys also
supports USDC on Polygon and Ethereum. Native-chain fees, account setup, bridge/
exchange withdrawal costs, and existing balances affect the cheapest first
funding path. See [research](../../docs/research/irys-ci-publication.md).

The deployment wallet needs native USDC **and a small SOL balance**. USDC pays
for storage; SOL pays network fees. Do not send bridged USDC or USDC on a different
chain to this setup. Native SOL fees are not included in the USDC limits.

Publication runs **only after a PR is merged into `main`**, using prepaid Irys
credit. Direct pushes, unmerged/closed PRs, and manual runs cannot publish.
A manual dispatch can explicitly top up credit **without uploading the website**,
amortizing chain fees across deployments.

## Setup stages (human-owned; not performed yet)

1. Create a **dedicated, low-balance Solana deployment wallet**, not your personal
   wallet. Review the SDK advisory notes below before transferring money. Keep its
   key outside the repo and never paste it into chat. Secret format is the base58
   encoding of the 64-byte Solana secret key, **not** a seed phrase, EVM key, public
   address, or JSON key array. Fund only what you intentionally want CI to control.
2. In repository Settings → Environments, create **`irys-production`**, restrict
   deployments to `main`, and configure a required reviewer where your GitHub plan
   supports it. Protect `main`; anyone who can change approved workflow/publisher
   code can gain control of the deployment wallet.
3. Add environment secret **`IRYS_WALLET_KEY`**. Optionally add
   **`IRYS_SOLANA_RPC_URL`** for a reliable HTTPS Solana-mainnet RPC (including any
   API credential). Otherwise the public mainnet RPC is used and may rate-limit CI.
4. Optional environment variables: **`IRYS_MAX_UPLOAD_USDC`** (default `0.10`) and
   **`IRYS_MAX_FUND_USDC`** (default `1.00`). These are a publication **quote** ceiling
   and manual funding-target ceiling, respectively. Use plain decimal strings,
   maximum six fractional digits. Set repository Actions variable
   **`IRYS_PUBLISH_ENABLED=true`** only after reviewing this setup. It must be a
   **repository variable**, since the job condition runs before environment vars
   are available. Without it, CI builds the artifact but skips publishing.
5. After this workflow is on `main`, run **Build and publish website to Irys** from
   Actions. For initial funding, explicitly set `fund_to_usdc` to your chosen target
   (e.g. `1.00` within the configured ceiling). This transfers only the shortfall
   between current Irys credit and that target. **It does not publish.** Leave it at
   `0` for build checks only. Only manual workflow dispatch on `main` can initiate
   funding. Once credit is ready, merge a PR into `main` to publish.

These stages can be turned into a guided local setup wizard after you confirm
wallet/RPC choices. Nothing in the repository creates, funds, or stores a wallet.
Only the mutually exclusive funding/publishing steps receive the key—not checkout,
dependency installation, website compilation, tests, or artifact upload. The workflow
uses `pull_request_target: closed`, gated on `merged == true` and base `main`, so a
reviewed, merged fork PR can deploy using the base repository's environment secrets.
Both jobs check out the **merge commit SHA**, never an unmerged PR head. Do not
broaden this to opened/synchronize events or check out untrusted PR-head code.
Manual branch builds cannot fund or publish; manual main builds can only fund when
explicitly requested. Actions are pinned to SHAs and npm packages are locked.
There are no Pages permissions or OIDC grants.

## What gets published

Only the five HTML/JS/WASM assets in
`apps/browser/dist/irys-browser/`: `index.html`, `app.js`, `style.css`,
`pkg/relay_crypto.js`, and `pkg/relay_crypto_bg.wasm`. The parser formerly shipped
as `hosted-config.mjs` is bundled into `app.js`. The publisher independently rejects
extra files, symlinks, local-mode HTML, missing assets and malformed WASM.
Explicit Content-Type tags include JavaScript, `text/css`, and `application/wasm`.
All files are signed locally first, so a complete `irys/paths` folder manifest can
reference their IDs. Files upload first; the index manifest uploads last. No
session descriptor, wallet key, SDK package, source map, or helper log belongs in
this folder. The public wallet address and upload metadata are not anonymous.

The bundler is explicitly **`https://uploader.irys.xyz`**, targeting Irys L1 mainnet
beta—not a legacy Arweave bundler. Every successful deployment produces a **new
immutable manifest URL**, printed in the job summary/environment link:

`https://gateway.irys.xyz/<manifest-id>/`

This does not automatically provide a stable domain or update an old URL. Keeping
a stable entrypoint requires a separate mutable pointer/domain decision. CDN
routing, asset loading, and the phone echo must still be verified on the actual
published page; successful upload receipts alone are not browser acceptance.

## Payment guards and failures

- Quote every fully serialized, signed file and the manifest before any transfer.
- Reject an initial total quote above the upload ceiling; recheck each item's
  quote against the cumulative ceiling before uploading.
- These checks are **not a binding price lock**. Bundler prices may change between
  quote and acceptance. They also do not cap SOL fees or cumulative spending across
  different workflow runs. Use a small dedicated wallet and prepaid balance.
- Funding happens at most once per script invocation, only on an explicit manual
  dispatch. SDK-selected SOL fees are separate and not capped here. The SDK may
  also need account setup/rent; have the native USDC token account funded beforehand.
- An error after sending a funding transaction can leave funds already transferred
  but not yet credited. **Do not blindly rerun with funding enabled.** Inspect the
  wallet's public transaction history and Irys credit, and reconcile first.
- Each run preserves a public `publication.json` artifact, including progress and
  any successful funding/upload IDs. Partial uploads can already incur charges;
  publication is not atomic. Retrying creates new signed items and may cost again.
- Raw SDK exceptions are deliberately not logged: they can contain request config
  or RPC credentials. The failed stage is recorded instead. Configuration errors
  require checking secret format/limits; quote/balance errors require checking
  credit; RPC/SDK errors require checking provider and bundler availability.

### Signing-stage failure fixed: Irys L1 transaction IDs

The initial uploader incorrectly required 43-character base64url-style IDs. The
pinned Irys SDK instead returns base58-encoded 32-byte hashes, commonly 44
characters. That rejected valid signed items before price quotes or funding;
`startingBalanceAtomicUsdc: "0"` was not the cause. Validation now checks the base58
alphabet and decoded byte length, and an offline test prepares/verifies real SDK
items with a fixed public test seed and anchor. Tests run with `--no-addons`, like
publication. The test never funds, uploads, or reads a user wallet.

Reports now distinguish preparing signed items from fetching price quotes. The
funding warning is emitted only if the script reached a funding attempt. A zero
Irys credit balance is normal before the initial manual top-up.

## SDK dependency caveat

An npm audit found transitive advisories in the current official SDK. A patched
`ws` 8.x version is explicitly overridden. The remaining `bigint-buffer` native
buffer-overflow advisory has no npm-reported fix in this dependency chain. Installs
use `--ignore-scripts`, and publishing runs with Node **`--no-addons`**, preventing
that vulnerable native addon from loading; the SDK has a pure-JS fallback. This
mitigation does **not** make all transitive audit findings disappear or substitute
for a security review. Inspect `npm audit --omit=dev` before enabling real funds.
The SDK must remain confined to the publisher; never put it in the browser bundle.

## Local checks (no wallet, no payment)

```sh
npm ci --prefix apps/browser --ignore-scripts
cd deployment/irys
npm ci --ignore-scripts
npm run typecheck
npm test
```

Do not run `publish:site` as a test: it is the real financial/publication entrypoint.
It validates the merged-main event before publishing; `--fund-only` instead requires
a manual main-branch workflow and exits without any asset or manifest uploads. The unit tests use an in-memory publisher and never contact a
wallet, RPC, or bundler. See `experiments/relay-spike/HOSTED.md` for phone acceptance.
