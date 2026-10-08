# Manual-descriptor browser LAN gate (no USB)

“Hosted” is the helper's existing name for a standalone browser controller with
manual descriptor entry, not a requirement to host on Irys. The current controller
is bundled in the Android APK and served on phone loopback. The Irys publisher and
deployment workflow have been removed. Historical Irys results remain in
[project status](../../docs/STATUS.md).

## Current validated path

```text
Android APK → phone-local HTTP → Chrome/Brave controller + PQ WASM
Browser → Wi-Fi WebRTC → pinned MASQUE allocation → computer helper
    → configured localhost target (only with HTTP mode and a visitor grant)
```

The APK-local phone HTTP run passed publisher authentication, visitor authorization
and expected HTTP 200 results (192-byte HTML, 48-byte CSS). Final relay → listener:
**35 packets / 11,305 bytes**; listener → relay: **35 packets / 10,059 bytes**;
rejected sources **0**, clean helper shutdown. This is a bounded LAN experiment,
not transparent app rendering, public relay deployment or cellular/NAT acceptance.

The computer helper's `browser-hosted` mode starts **no HTTP metadata server** and
makes no ADB call. It prints a fresh public descriptor for manual transfer; the
HTTP variant also prints a separate private visitor token once. The browser must
not fetch `/session.json`, `/stats.json` or a computer HTTP URL in this mode. It
does not store invitations, register a controller worker or connect automatically.
The Android delivery probe's worker is separate and does not control `/controller/`.

The descriptor pins the publisher identity; it is **not** visitor authorization.
Use trusted transfer methods. Page-delivery trust is now in the installed APK and
its build/update process, not a remote gateway. Loopback alone does not protect
against hostile apps impersonating the static server on an otherwise-free port.

## Build and prepare (repository root)

```sh
bash experiments/relay-spike/hosted.sh build
node apps/android-controller/prepare.ts
```

The first command checks/builds the helper and browser. The second stages the
existing privacy-safe WASM and freshly built frontend for the Android APK. Follow
[Android build/run instructions](../../apps/android-controller/README.md), then
manually open `http://127.0.0.1:18787/controller/` on the phone. The Open button's
403 remains an unresolved launch issue; do not weaken request guards.

The hosting-neutral static export is `apps/browser/dist/hosted-browser/`, with
exactly five files: `index.html`, `app.js`, `style.css`, `pkg/relay_crypto.js` and
`pkg/relay_crypto_bg.wasm`. URLs are document/module-relative. The exporter rejects
unexpected files, symlinks and embedded home paths. Checksums are outside the
asset folder at `dist/hosted-browser.SHA256SUMS`. They are build checks, not an
independent browser authentication mechanism. Nothing is uploaded or funded.

For frontend-only regeneration with existing WASM, `hosted.sh bundle` still works;
it does not rebuild the native helper. APK delivery additionally needs preparation
and a new APK install. No commit or merge is needed to test the working tree.

## HTTP acceptance

Use [HTTP inspector instructions](../../docs/HTTP-INSPECTOR.md) for the fixed-content
fixture and complete procedure. Both devices must use the same trusted Wi-Fi.

```sh
# Separate terminal: no repository/filesystem serving.
node apps/browser/fixtures/http-app.ts 3000

# Helper terminal: replace with the current private addresses.
bash experiments/relay-spike/hosted.sh http MAC_LAN_IP PHONE_LAN_IP 3000
```

On the phone, paste the fresh descriptor and private token separately. Press
**Authorize and fetch paths**, not echo. Confirm authentication/authorization,
both expected responses, then Ctrl-C the helper for final counters and clean
shutdown. Do not share the full terminal transcript containing the token. Close
the browser controller and stop the Android static server afterward. Stopping
that file server alone does not revoke an already-open WebRTC connection.

## Optional echo-only acceptance

```sh
bash experiments/relay-spike/hosted.sh run MAC_LAN_IP PHONE_LAN_IP
```

Use a fresh helper run and descriptor, then the **echo** button. Expect publisher
authentication and a matching 25-byte encrypted echo. Ctrl-C for nonzero traffic
in both directions and zero rejected sources. Default echo mode cannot fetch the
target application and does not need a visitor token.

The bridge admits exactly the configured phone IPv4, then pins one source port.
Private, different computer/phone addresses are required. Do not remove these
restrictions, forward router ports, substitute TURN, bypass device policies, or
infer public-Internet reachability from this LAN result. Direct-first fallback,
transparent application navigation and WebSockets remain future work.
