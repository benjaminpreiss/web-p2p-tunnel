# Irys CI publication: payment and SDK findings

> Historical research. The publisher and deployment workflow have been removed;
> this is not current deployment guidance.

Implementation-time primary-source check for replacing GitHub Pages. No live
wallet funding, upload, or cross-chain fee comparison was performed. Research was
performed directly in this session; no background-agent tool was available.

## Payment token and destination

- Irys lists **USDC on Ethereum, Polygon, and Solana** as supported. Base is listed
  for ETH, not USDC. Do not infer that arbitrary USDC deployments work:
  <https://docs.irys.xyz/onchain-storage/supported-tokens>.
- The SDK setup page documents `USDCEth` and `USDCPolygon`. The currently published
  official `@irys/upload-solana@0.1.8` additionally exports **`USDCSolana`**, using
  native mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, token name
  `usdc-solana`, and Solana-mainnet RPC by default. Its SPL adapter resolves mint
  decimals from chain metadata:
  <https://docs.irys.xyz/onchain-storage/installing-importing-configuring>,
  <https://registry.npmjs.org/@irys/upload-solana/0.1.8>,
  <https://registry.npmjs.org/@irys/upload-solana/-/upload-solana-0.1.8.tgz>
  (`src/solana.ts`, `src/spl.ts`, `src/token.ts`).
- Mainnet bundler **`https://uploader.irys.xyz`** sends data to Irys L1, currently
  mainnet beta. Legacy bundlers can target Arweave; these are not interchangeable:
  <https://docs.irys.xyz/onchain-storage/mainnet-devnet>.
- USDC storage payment does not eliminate native-chain transaction fees. Solana
  charges SOL fees, with optional priority fees:
  <https://solana.com/docs/core/fees>. The adapter's SPL transfer preparation may
  create the sender's associated token account if missing. Have a funded native
  USDC account first. Its `disablePriorityFees` option is read through `config.opts`
  although the constructor assigns `opts` directly; do not rely on this flag for
  a fee cap. The publisher does not claim to cap native fees.

**Decision:** Solana is a low-fee default, not a verified live cheapest-chain
ranking. Polygon may be cheaper for a particular user once existing funds,
withdrawal/bridge fees, and current gas are considered. No automatic chain
switching is implemented; Solana and EVM private-key formats are different.

## Prepaid credit and quote safety

- `fund()` transfers tokens into a bundler balance. Upfront funding avoids a
  funding transaction for every upload:
  <https://docs.irys.xyz/onchain-storage/fund>.
- `getPrice()` returns the upload price in atomic units of the configured payment
  token, not dollars or native SOL:
  <https://docs.irys.xyz/onchain-storage/getprice>.
- Published `@irys/upload-core@0.0.10` transactions expose `size`, `getPrice()`,
  `sign()`, and `upload()`. Transaction price quotes include serialized item size
  and tags. Funding may fail after submission, so retrying blindly can transfer
  twice. Sources:
  <https://registry.npmjs.org/@irys/upload-core/-/upload-core-0.0.10.tgz>
  (`src/transaction.ts`, `src/fund.ts`, `src/utils.ts`).
- Quote guards do not establish a guaranteed price lock between a quote and the
  bundler accepting an upload. Native fees and cumulative spending across runs
  require their own operational budget.

**Implementation:** exact integer USDC arithmetic; all signed asset/manifest
quotes checked before a payment; manual-only bounded top-up without uploads;
prepaid-only publication after a PR merges into `main`; no script retry of funding;
public partial-progress receipts.

## Website manifests

- Folder publication supports `index.html` and gateway retrieval by manifest ID:
  <https://docs.irys.xyz/onchain-storage/uploadfolder>.
- Official SDK source generates `manifest: "irys/paths"`, `version: "0.1.0"`,
  `paths: { filename: { id } }`, and `index: { path }`. Manifest Content-Type is
  `application/x.irys-manifest+json`:
  <https://registry.npmjs.org/@irys/upload/-/upload-0.0.15.tgz>
  (`src/upload.ts`) and the core package (`src/upload.ts`, `src/types.ts`).
- Our publisher explicitly creates that manifest after signing the five asset
  transactions. It uploads the manifest last and sets every MIME type explicitly.
  This permits precise per-item quotes, instead of relying on the SDK's estimated
  aggregate folder price. Publication is still multiple non-atomic uploads.
- Each publication yields a new immutable manifest URL. A stable custom domain or
  mutable entrypoint is separate. CDN behavior and hosted browser acceptance remain
  unverified; see [earlier research](irys-browser-entrypoint.md).

## Dependency risk

Official release packages are pinned by version and npm lockfile integrity, but
that is not a security audit. The Solana adapter's dependency chain includes the
native `bigint-buffer` overflow advisory:
<https://github.com/advisories/GHSA-3gc7-fjrx-p6mg>.

The publisher installs without lifecycle scripts and runs Node with `--no-addons`,
forcing the SDK's available pure-JS fallback rather than loading that native addon.
Node flag reference: <https://nodejs.org/api/cli.html#--no-addons>.
This is a mitigation, not a claim that the dependency graph is clean. Other
transitive advisories remain; review `npm audit --omit=dev` before enabling funds.
A `ws` 8.x override selects 8.21.0 for current fixes:
<https://github.com/advisories/GHSA-58qx-3vcg-4xpx>,
<https://github.com/advisories/GHSA-96hv-2xvq-fx4p>.

The signing job is opt-in, main-branch-only, and environment-scoped. A small,
dedicated wallet limits exposure; it does not eliminate the need to trust the
approved repository code, GitHub Actions, RPC, bundler, and SDK supply chain.
