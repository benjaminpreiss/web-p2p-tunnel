# Irys-hosted page gate: static bundle, no USB

## Status

The USB-delivered mobile-browser LAN/MASQUE echo passed. This next gate removes
USB and local HTTP metadata delivery. Static input/export tests pass; hosted-mode
Rust compilation and a real Irys upload/browser run remain **unverified**.
No upload, wallet operation, payment, VPS deployment or public relay allocation
has been performed for this gate.

## Shape

```text
Browser -> Irys HTTPS gateway/CDN -> static HTML, JS and PQ WASM
User pastes fresh public descriptor from their trusted terminal helper
Browser -> Wi-Fi UDP -> Mac MASQUE allocation -> helper -> PQ echo
```

The frontend must not fetch `/session.json`, `/stats.json`, or any Mac HTTP URL
in hosted mode. It has no Service Worker, telemetry, local storage, query-string
invitation or automatic connection. The descriptor stays in the page's memory;
it is not included in the upload or placed in a share URL. Browser extensions or
untrusted page delivery remain outside the protection of the PQ session.

The helper's `browser-hosted` mode starts **no HTTP server** and makes no ADB call.
It prints the public descriptor for manual transfer. Use a trusted transfer method;
a substituted descriptor would pin a different helper. The descriptor is public
address/identity metadata, **not visitor authorization or a bearer access grant**.

The pinned shared Rust/WASM implementation still performs SDP generation and PQ
crypto. Frontend validation only checks the expected bounded descriptor shape and
private IPv4/port scope; it does not replace cryptographic pin validation.

## Build and export (repository root, user's normal terminal)

```sh
bash experiments/relay-spike/hosted.sh build
```

Runs JS input tests and TypeScript export tests, the Rust tests/build, and exports:

```text
apps/browser/dist/irys-browser/
  index.html
  app.js
  hosted-config.mjs
  pkg/relay_crypto.js
  pkg/relay_crypto_bg.wasm
```

All asset references are relative to their containing document/module, rather
than hard-coded gateway/CDN hosts. The export changes only the HTML fixture-mode
marker; local desktop/USB modes use the same frontend with their local config.
The exporter uses an explicit five-file allowlist, refuses unexpected files in
an existing output folder, and never copies session JSON, logs or keys. It writes
local SHA-256 checksums **outside** the upload folder to `dist/irys-browser.SHA256SUMS`.
That file is not an Irys manifest and does not establish independent browser code
integrity. Generated output is Git-ignored.

For static-only regeneration with existing WASM assets:

```sh
bash experiments/relay-spike/hosted.sh bundle
```

This does **not** compile the updated Rust helper.

## Publication handoff: deliberate separate step

The replacement GitHub Actions workflow is now prepared: see
[`deployment/irys/README.md`](../../deployment/irys/README.md). It builds release
WASM and publishes this website to Irys L1 using native USDC on Solana. The publisher
is TypeScript; environment/wallet setup and the first live run remain pending.
Before enabling it, review current pricing/retention and SDK dependency risks,
configure a dedicated wallet, and confirm publication. Use local
signing; do not paste a seed/private key into chat or put one into the bundle.
A disposable development signing key is preferable for the first fixture.

Upload **the folder** using an Irys folder manifest with `index.html` as its index,
not five unrelated transaction URLs. Required content types:

| File | Content-Type |
| --- | --- |
| `index.html` | `text/html` |
| `.js` and `.mjs` | `text/javascript` or `application/javascript` |
| `.wasm` | `application/wasm` |

Share the resulting `https://gateway.irys.xyz/<manifest-id>/` URL, not a hard-coded
CDN hostname. Verify redirects and same-origin relative asset resolution on the
actual deployment. Do not infer successful loading solely from an upload receipt.
The gateway/CDN is part of the initial code-delivery trust path and may rotate
origins; persistent browser state or Service Worker scope is not promised here.
See `../../docs/research/irys-browser-entrypoint.md` for prior primary-source
research and its limits. No uploader credentials or publication have been set up
by these scripts.

## Acceptance after publication

1. On the phone, open the gateway URL over normal HTTPS with USB disconnected.
   Confirm the Diagnostics show secure context, final origin/path, hosted mode,
   and loaded shared PQ WASM. Stop on MIME/CSP/asset errors; do not disable browser
   security to force a result.
2. Keep the phone and Mac on the same trusted Wi-Fi. Confirm their current IPs.
   Start a fresh helper only once the page is ready. Replace the address placeholders:

   ```sh
   bash experiments/relay-spike/hosted.sh run MAC_LAN_IP PHONE_LAN_IP
   ```

3. Paste its complete **PUBLIC CONNECTION DESCRIPTOR** into the page via a trusted
   transfer method. Only this configured phone IPv4 is admitted by the bridge,
   then one source port is pinned. Public and loopback target descriptors are
   deliberately rejected by this LAN-only frontend gate.
4. Click Connect once. Expected: WebRTC open, authenticated publisher identity,
   matching encrypted echo, and selected remote ICE address/port matching the
   printed relay allocation. Normal local-network permission prompts may occur;
   record them and use only permissions you intentionally grant.
5. Save the page diagnostics, then Ctrl-C the helper and capture its final bridge
   counters. Require nonzero packet/byte counts in both directions and the intended
   phone source in the bridge log. Unlike the USB fixture, the static page cannot
   independently fetch those counters. It reports echo verification separately
   from relay-accounting evidence.

The helper expires after ten minutes and accepts one browser echo per run. Start
fresh and replace the pasted descriptor before reloading, retrying, or switching
browsers. No USB mapping, app installation, HTTP listener, router change or saved
helper secret needs cleanup. Retain the publication receipt/URL for reproducible
results; stopping the helper does not delete published Irys assets.

## What a pass does NOT prove

- Cellular/home NAT traversal or a separately deployed VPS relay: all native
  relay/helper roles still run on the same Mac.
- Automatic direct-first path selection or relay bandwidth savings.
- Visitor authorization, production relay admission, or spoof-resistant source
  control. The wildcard relay UDP allocation remains LAN-visible; do not port
  forward it or remove the exact-phone source restriction for an Internet test.
- HTTP/WebSocket forwarding or transparent web-app compatibility. No actual
  localhost application is exposed. Service Worker registration/routing is a
  separate future gate, not part of this static echo.
- A bypass for device policy. The selected browser still needs network access;
  HTTPS-hosted page to private-LAN WebRTC may be governed differently from our
  earlier localhost-origin test.
