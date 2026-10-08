# Irys devnet for local browser previews

> Historical research and acceptance evidence. The devnet publisher has been
> removed; use the APK-bundled controller for current working-tree tests.

## Primary-source findings

- Irys documents a devnet bundler paid with free faucet tokens, with data retained
  for approximately **60 days**. It requires both `.devnet()` and `.withRpc(...)`:
  <https://docs.irys.xyz/onchain-storage/mainnet-devnet>.
- The official endpoint list names **`https://devnet.irys.xyz`** for devnet and
  `https://uploader.irys.xyz` for production. Endpoint selection determines the
  destination; do not assume testnet duplicates every production storage property:
  <https://docs.irys.xyz/onchain-storage/bundlers>.
- The retrieval guide documents **`https://gateway.irys.xyz/<transaction-id>`**,
  and explicitly notes temporary devnet retention and network-dependent retrieval:
  <https://docs.irys.xyz/onchain-storage/downloading>. Actual devnet manifest/asset
  delivery and phone WASM boot were subsequently verified in the user-run test
  recorded below.
- Installed, locked `@irys/upload@0.0.15` implements `.devnet()` by selecting
  `devnet`, which `@irys/upload-core` resolves to the devnet endpoint. Its default
  is mainnet, so the test command must select devnet explicitly and check it:
  <https://unpkg.com/@irys/upload@0.0.15/dist/esm/builder.js>.
- `@irys/upload-solana@0.1.8` exports native `Solana` separately from `USDCSolana`.
  The latter defaults to the production USDC mint; native faucet SOL avoids
  depending on a test USDC mint. SOL amounts use **nine** fractional digits,
  unlike the production publisher's six-decimal USDC:
  <https://unpkg.com/@irys/upload-solana@0.1.8/dist/esm/solana.js> and
  <https://unpkg.com/@irys/upload-solana@0.1.8/dist/esm/token.js>.
- Solana documents its public devnet RPC and faucet/testing role:
  <https://solana.com/docs/references/clusters> and <https://faucet.solana.com/>.
  A read-only `getGenesisHash` call to `https://api.devnet.solana.com` returned
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. The command must match this full
  value before loading a wallet, not merely trust a URL substring.

## Subsequent user-run acceptance

The user obtained a devnet upload URL and supplied phone diagnostics from the
HTTPS devnet CDN: PQ WASM loaded, publisher authentication and visitor authorization
succeeded, and the expected HTML/CSS returned HTTP 200 with 192 and 48 bytes.
Bridge counters recorded relay → listener **27 packets / 6,720 bytes** and
listener → relay **28 packets / 9,646 bytes**, with zero rejected sources and no
shutdown error. This proves the bounded devnet-hosted LAN path, not retention,
production equivalence or general browser/NAT compatibility. No private addresses,
session descriptors or wallet details are retained here.

## Read-only probes

`GET https://devnet.irys.xyz/info` listed `solana` as supported. An illustrative
`GET /price/solana/1400000` returned 681225 lamports. This is not a signed-site
quote, a fixed price, or a promise about fees/availability.

No wallet was created or accessed, no faucet requested, and no funding or upload
was performed during research. Published files are public even on devnet. The
local preview command must retain the production artifact allowlist/privacy checks,
use a separate throwaway wallet, never fall back to production settings, and keep
production merge-only publication unchanged.
