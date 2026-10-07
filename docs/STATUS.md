# Project status and resume guide

Last updated: 2026-10-07.

## Current direction: Irys-hosted browser client, terminal helper, Saorsa MASQUE

The user returned to **a website on Irys (`irys.xyz`) as the mobile client** and
**a computer helper run from a terminal**. Keep the pinned Saorsa MASQUE relay
approach rather than switching to TURN. The user now requested replacing GitHub
Pages with an Irys publishing workflow paid in USDC. The user has now completed
funding, publication, and the hosted phone-browser LAN echo gate. No VPS deployment
is authorized.

- Browser-side networking remains WebRTC plus the shared application-level PQ
  session. A browser does not become a native MASQUE/QUIC client just because
  the helper and relay use MASQUE.
- Reuse the successful local browser relay diagnostic as the starting point,
  not as production relay admission or a proven phone/Internet tunnel.
- Direct-first selection with relay fallback is a bandwidth-saving goal, not
  implemented/proven behavior. On a relayed path, all tunneled application data
  traverses the relay. Serve public frontend assets directly from Irys.
- Irys asset delivery and one phone-browser LAN/PQ echo are validated. Broader
  browser compatibility, real NAT traversal, authorization, bounded HTTP/WebSocket
  forwarding and production relay operation remain unvalidated.
- Browser networking still depends on that browser's device-policy permissions;
  the website is not a bypass for Restricted networking mode.

The **Android app**, privileged-system integration, and **SSH tunneling** remain
cancelled. At the user's request, `experiments/android-app`,
`experiments/android-native`, and `experiments/android-smoke` have been removed,
including their build artifacts and pending staged additions. Android paths and
commands further below are historical records, not runnable checkout instructions.
Do not resume those experiments. See `VISION.md` for the current scope.

### Current work: authorized localhost HTTP inspector — local checks pass, live gate pending

Implemented an opt-in `hosted.sh http MAC_LAN_IP PHONE_LAN_IP PORT` mode and a
separate browser inspector. It uses the existing PQ/WebRTC/MASQUE path but requires
a fresh private visitor grant before any target access. Default echo behavior is
retained. Only GET to one fixed numeric loopback port is allowed: at most 16
sequential requests, 4 KiB response bodies, and 5 seconds per fetch. No proxy-env
routing, redirects, caller headers, cookies or automatic decompression. Invalid
requests consume the attempt. The phone displays inert text/base64, not a running
web app, and keeps private results out of diagnostic logs.

Native integration tests use actual loopback HTTP fixtures and confirm that failed
authorization and invalid requests make zero target connections. They also cover
page/CSS retrieval, redirects, body overflow, deadlines and request limits. Browser
request-interface tests cover authorization order, response validation, byte
preservation and text-only rendering. A native-test job now gates Irys release
alongside the existing frontend build; merge-only publication and wallet isolation
are unchanged. Validation passed locally: **10 native tests, 15 browser/export
unit tests, 3 built-bundle checks, and 12 publisher tests (40 total)**, both
TypeScript checks, the native build/CLI help, and shell/YAML checks. Existing
privacy-safe WASM was reused unchanged for the local frontend build. These checks
are not a real phone HTTP-over-WebRTC acceptance run.

Instructions, protocol and limitations: [`HTTP-INSPECTOR.md`](HTTP-INSPECTOR.md).
The included demo serves only fixed public test content, never repository files.
No upload/funding/public relay deployment was performed. The prior migrated echo
pass below remains valid; this new HTTP mode needs its own published-phone test.

### Previous gate: Vite + vanilla TypeScript migration — hosted LAN recheck PASSED

The user supplied the migrated Irys page's mobile-browser PASS and final helper
counters. HTTPS asset delivery, PQ WASM loading, publisher authentication, and the
**25-byte encrypted echo** succeeded. Final MASQUE bridge accounting:

- Relay → listener: **35 packets / 12,397 bytes**.
- Listener → relay: **33 packets / 9,290 bytes**.
- Rejected source packets: **0**.

This completes the post-migration hosted-phone LAN gate. Counts need not be equal
between directions; they include protocol traffic, not only application payload.
Private addresses, session descriptors and browser fingerprints are not retained.
The relay/helper still run on one computer. Public-relay/NAT traversal, visitor
authorization, direct-first fallback and actual HTTP/WebSocket forwarding remain
unproven. Local HTTP fixture asset serving was not separately revalidated by this
hosted-mode run.

- UI source moved to `apps/browser/src/app.ts`, `hosted-config.ts`, and `style.css`.
  Vite 8.3.3 is pinned with a frontend npm lockfile. No UI framework, web fonts,
  wallet SDK, telemetry, or persistence was added to the browser.
- The SDP/PQ/WebRTC flow, limits and one-attempt behavior are retained. Runtime
  checks now validate local JSON shapes; the generated WASM declarations type-check
  the crypto calls. The UI uses responsive CSS and accessible native controls.
- Vite emits an intermediate folder with relative paths, minified JS/CSS, no source
  maps or inlined WASM. The configuration parser is bundled. The strict upload
  allowlist now contains `index.html`, `app.js`, `style.css`, and the two `pkg/`
  crypto assets; `hosted-config.mjs` is no longer an output file.
- Exporter prepares separate `dist/irys-browser/` and `dist/local-browser/` bundles.
  The Rust local HTTP fixture now reads the built local bundle; its Host/Origin/
  fetch-site guard is unchanged. Hosted helper mode still starts no HTTP server.
- CI installs both locked Node projects, rebuilds release WASM, builds/types-checks
  the Vite frontend and runs its boot smoke checks before publication. Merge-only
  publication, explicit manual funding and wallet isolation are unchanged.
- Validation: both TypeScript checks, 12 publisher tests, 8 frontend/export tests,
  and 3 built-bundle checks passed (two startup tests plus the publisher allowlist
  check). Startup tests execute minified app code and real WASM at a synthetic
  nested HTTPS manifest URL using minimal browser stubs;
  they verify expected requests and no automatic connection. They do not replace
  rendering, browser-security, or real WebRTC testing.
- Frontend build reused existing local WASM: HTML 2,097 bytes; app JS 10,322 bytes;
  CSS 1,773 bytes; crypto glue 17,484 bytes; WASM 1,271,649 bytes. This is not a claim
  about the next CI release-WASM size or gateway compression. Frontend npm audit
  reported zero advisories; publisher SDK advisories remain separate.
- Rust formatting and shell syntax passed; the agent did not run Cargo. The user
  subsequently published and completed the hosted-phone acceptance above. No
  upload, funding or deployment was performed by the agent.

Build/check commands: `apps/browser/README.md`. If an older generated output folder
still has `hosted-config.mjs`, review and remove that obsolete output before export;
unknown output files are deliberately not deleted by the exporter.

### Baseline gate: Irys-hosted phone-browser LAN echo — PASSED

The user supplied successful publication, browser and final helper logs:

- All five website assets plus the index manifest uploaded to Irys. The reported
  per-item price quotes total 1,880 atomic USDC (0.001880 USDC); this is not an
  independent measurement of actual debits or SOL funding fees.
- Desktop and phone browsers loaded the real HTTPS gateway/CDN page and shared
  PQ WASM. Hosted mode used no localhost metadata fetches or ADB delivery.
- Phone Chrome opened the WebRTC DataChannel, authenticated the publisher through
  the Saorsa PQ session, and matched a **25-byte encrypted echo**.
- The selected ICE pair used UDP, local `prflx`, remote `host`, and the advertised
  private-LAN MASQUE allocation. Forwarding is external to browser ICE.
- Final relay → listener counters: **27 packets / 7,809 bytes**.
- Final listener → relay counters: **27 packets / 8,944 bytes**.
- Rejected source packets: **0**. Helper shutdown completed normally after the
  browser reported PASS. Both application verification and relay accounting passed.
- An initially stale helper binary lacked `browser-hosted`; the user rebuilt it
  before this successful run. The source/build path is now exercised locally.

Private addresses, session descriptor and browser fingerprint are intentionally
not retained here. This proves the bounded hosted-page LAN path, **not** cellular/
home NAT traversal, a public VPS relay, direct-first fallback, visitor authorization,
HTTP/WebSocket forwarding, or Service Worker routing. The relay/helper still run
on the same computer. This pass predates the Vite migration described above.

The preparation notes below record earlier stages and should not be read as the
current validation status.

### Browser relocation, privacy cleanup, and TypeScript export

- Browser sources, PQ WASM crate and tests now live in `apps/browser/`.
  The native helper remains in `experiments/relay-spike/`; CI and the publisher
  use `apps/browser/dist/irys-browser/`. Vite migration has not happened yet.
- `apps/browser/export.ts` replaces the Python exporter. Its Node tests check the
  five-file allowlist, hosted marker, checksums, missing/invalid WASM, symlinks,
  unexpected output preservation and embedded user-home-path rejection.
- `apps/browser/build.ts` remaps Rust build paths. Previously generated local WASM
  contained identifying home paths and was deleted, together with the static
  bundle. A fresh build is required; do not publish old local WASM artifacts.
- Personal names/home paths and recorded LAN IPs were removed from publishable
  docs/examples; source fixtures use synthetic addresses. Protocol-required
  loopback/wildcard addresses remain. Git author identity/history are intentionally
  unchanged, as permitted by the user.
- The tracked local `web/.env` was removed from the index (local file retained,
  ignored); `web/.env.example` is a public placeholder. Root ignore rules cover
  environment secrets, common wallet/key files, logs, caches and build outputs.
- The one-time keypair encoder and its tests were removed at the user's request.
- Latest checks: TypeScript typecheck, 10 publisher tests, 8 browser/export tests,
  shell syntax, workflow YAML/merge-trigger assertions and diff whitespace passed.
  Gitleaks v8.30.1 found no secrets in a snapshot of publishable worktree files or
  reachable Git history. One algorithm-description false positive was reworded.
  Recorded personal-name/LAN markers are absent from publishable files. These
  checks do not prove that every possible secret or visual media detail is absent;
  ignored local files/build caches and Git metadata were not scrubbed.
- Prior Python test/build-size results below are historical, not evidence that a
  new privacy-safe WASM bundle has been built. Run `npm --prefix apps/browser run
  build` in the normal terminal, or use the CI build with publishing disabled.

### First manual funding run: signing failure reproduced and fixed locally

The user's run connected to the USDC bundler and read zero prepaid Irys credit,
then failed before any prepared items, quote events or funding attempt. An offline
real-SDK test reproduced the error: the uploader required 43-character IDs, but
Irys L1 returns base58-encoded 32-byte hashes (the fixture produces 44 characters).
The signature was valid and the ID was stable; this was our validator, not the
wallet balance or the native-addon fallback. Validation now enforces base58 and
32 decoded bytes. The new fixed-seed/anchor SDK test verifies file and manifest
signatures without RPC, wallet access, upload, or funding. It passes with
`--no-addons`; CI tests now use that flag too. Reports separate signing from
quoting and warn about transfers only after a funding attempt.

The corrected code still needs to reach `main` and pass a fresh manual funding
run. No funding/upload was performed by the agent. Earlier notes about no CI
setup below describe the pre-setup state; the user has now configured GitHub and
run the workflow.

### Irys CI publisher: implementation and earlier setup notes

- Removed `.github/workflows/pages.yaml`; added `.github/workflows/irys.yaml`.
  Builds release PQ WASM and the current five-file diagnostic website, not the
  legacy `web/` signaling app. Publishing is opt-in via repository variable
  `IRYS_PUBLISH_ENABLED=true`, restricted to `main` and environment `irys-production`.
- **TypeScript** publisher and tests live in `deployment/irys/`; strict typecheck
  and ten offline publisher tests passed. Node 24 runs TypeScript directly. Existing
  frontend JavaScript has not been migrated. No UI framework is needed; Vite with
  vanilla TypeScript is the recommended future frontend build-tool option.
- Payment default: native USDC on Solana, with SOL needed for native fees. This is
  a low-fee choice, not a verified cheapest-live-chain ranking. Only a PR merged
  into `main` can publish, using prepaid credit. Direct pushes never publish.
  Manual runs with target 0 are build-only; an explicit positive target tops up
  credit without uploading. Only manual runs on `main` may fund.
- Wallet key is scoped to the mutually exclusive publish/fund steps, never website
  build/install/tests. `pull_request_target: closed` admits only merged-main PRs;
  both jobs check out the reviewed merge SHA, never an unmerged PR head.
  Initial default quote ceiling is 0.10 USDC; funding-target ceiling is 1.00 USDC.
  These do not cap native fees or cumulative spending, nor lock bundler prices.
- The official SDK has transitive advisories. A patched ws override is locked;
  native bigint-buffer risk is mitigated with ignored install scripts and Node
  `--no-addons`. This is not a clean audit or substitute for dependency review.
  Publishing remains disabled by default pending human setup/review.
- Every publish creates a new immutable manifest URL; a stable domain/entrypoint
  is not configured. Partial uploads may cost money. Public progress receipts are
  retained; never blindly retry ambiguous funding failures.
- No GitHub secrets/environment were configured, no real signing/funding/upload
  occurred, and CI release-WASM build/live deployment remain unverified.
  Setup: `deployment/irys/README.md`; primary sources:
  `docs/research/irys-ci-publication.md`. Never ask for wallet secrets in chat.

### Current next gate: static Irys frontend without USB (prepared, not deployed)

Added `experiments/relay-spike/hosted.sh` and `HOSTED.md` for the next gate:

- A static five-file bundle uses the same browser/PQ WASM implementation, with
  relative asset paths suitable for an Irys folder manifest.
- Hosted mode asks the user to paste a fresh **public connection descriptor**
  from their own helper. It makes no `/session.json`, `/stats.json` or localhost
  fetches, and stores no invitation in URLs or persistent browser state.
- New `browser-hosted` helper mode starts no HTTP server and uses no ADB. It retains
  private-LAN address validation, exact-phone source admission, ten-minute lifetime,
  one encrypted echo and the same pinned MASQUE/PQ path. Relay/helper roles still
  run on the same Mac; no separate VPS relay or cellular/NAT test is implied.
- Browser echo verification and terminal-side relay accounting are separate in
  hosted mode. Require both before claiming the complete path passed.
- Exporter allowlists only HTML/JS/WASM files; no session descriptors, secrets,
  logs or wallet material. Output is ignored `apps/browser/dist/irys-browser/`;
  local checksums live beside it, not in the upload folder.
- Agent ran two JS descriptor-validation tests and three Python export tests:
  **all passed**. A temporary-directory test needed canonicalization of macOS's
  symlinked temp root; the exporter did not weaken its output-path guard.
  Rust formatting, JS/shell syntax and export succeeded. Bundle size at export:
  **1,301,027 bytes**. Updated Rust compilation and browser execution are pending.
- Nothing has been uploaded, paid for or signed. The GitHub Actions uploader now
  targets Irys L1 using USDC on Solana; complete human-owned wallet/environment
  setup, review price/retention/dependency risks, and enable publication deliberately. Do not request wallet secrets in chat. Upload a folder
  manifest with `index.html` as index and correct HTML/JS/WASM MIME types; do not
  confuse the local SHA256SUMS file with an Irys manifest.

Next user command, repository root, normal terminal:

```sh
bash experiments/relay-spike/hosted.sh build
```

After a successful build and separately approved publication, open the gateway
URL on the phone without USB, confirm secure context/WASM loading, start the
helper with `bash experiments/relay-spike/hosted.sh run MAC_LAN_IP PHONE_LAN_IP`
(replace the placeholders with your current private addresses),
then paste its descriptor through a trusted transfer method and run one echo.
See `experiments/relay-spike/HOSTED.md` for the full acceptance and cleanup scope.
Public-site-to-LAN browser restrictions and Irys asset routing remain unverified;
no Service Worker or real HTTP application forwarding has been added.

### Phone browser on trusted LAN: passed

The user approved the bounded mobile-browser test. Android Studio has been
uninstalled, but `~/Library/Android/sdk/platform-tools/adb` still works and the
user confirmed USB debugging is enabled. No IDE or APK is needed for this path.

Added `browser-phone` to `experiments/relay-spike/` and a short-command driver,
`experiments/relay-spike/phone.sh`:

- Localhost HTTP page, WASM, public identity metadata and counters reach the phone
  via a development-only ADB reverse on TCP 18880. Keep USB attached during this
  test; the final Irys site will not require ADB or Developer options.
- Browser WebRTC packets use Wi-Fi UDP to the existing MASQUE allocation,
  advertised at the verified Mac private IPv4 address. Relay/helper QUIC control
  and the actual WebRTC listener remain on loopback, in one Mac process.
- A separate source policy admits only the explicitly supplied phone private
  IPv4, then pins one source port. No arbitrary LAN source allowance, public
  relay deployment, router forwarding, or HTTP application exposure is added.
- Original local/desktop source policies are retained. Added tests for source
  admission and invalid phone-mode addresses. Rust formatting, shell syntax and
  JS syntax checks passed. The user built the fixture, passed all three Rust
  guard tests, and subsequently passed the phone-browser echo (details below).
- This does not bypass Restricted networking mode: the selected browser must be
  allowed to create sockets. Do not change device policy or browser security
  flags automatically.

The user reported a successful phone-browser run in Chrome (UA reports mobile
Chrome 152; its reduced Android 10 UA is not evidence of the phone's OS version):

- Secure context and shared Saorsa PQ WASM loaded.
- Connected only to the advertised MASQUE allocation on the helper's private LAN address.
- Publisher identity authenticated; **25-byte encrypted echo matched**.
- Relay → listener: 23 packets / 6,240 bytes.
- Listener → relay: 23 packets / 8,771 bytes.
- Rejected source packets: 0.
- Selected ICE pair: local `prflx`, remote `host`, UDP. MASQUE forwarding occurs
  outside browser ICE, so this does not indicate relay bypass.

The page's PASS proves the bounded phone-browser Wi-Fi/MASQUE/PQ path. USB still
carried frontend assets, public identity metadata and counters. No deployed Irys
site, cellular/home NAT path, authorization, HTTP forwarding or direct-first
selection was tested. Final Mac bridge-pin/shutdown logs have not yet been supplied.

Opening via the ADB intent initially returned the fixture's Host/Origin guard
error. Typing `http://127.0.0.1:18880/` directly in the browser worked; the precise
rejected header was not diagnosed and no guard was weakened.

Repeatable build command from the repository root, in the user's normal terminal:

```sh
bash experiments/relay-spike/phone.sh build
```

After successful build, use the current Wi-Fi IPs (last observed Mac
`MAC_LAN_IP`, phone `PHONE_LAN_IP`; replace these placeholders before running):

```sh
bash experiments/relay-spike/phone.sh run MAC_LAN_IP PHONE_LAN_IP
```

Wait for "Open on the PHONE", then in another terminal:

```sh
bash experiments/relay-spike/phone.sh open
```

If the intent-opened page is rejected, type the exact loopback URL manually.
Click the page's Connect button once and capture its Diagnostics and terminal
output. Require pinned PQ authentication, matching encrypted echo, bidirectional
relay counters and the intended phone IP in the bridge log. One attempt per run;
Ctrl-C removes only this fixture's ADB reverse mapping. See the experiment README
for limits and cleanup. Nothing has been deployed to Irys or the VPS.

### Historical cancellation context

The cancellation was a product decision, not evidence that mobile networking is generally
impossible. The native Android CLI echo passed. The APK's Android and Rust socket
probes both failed at socket creation on the user's LineageOS phone, where
Restricted networking mode was enabled. Disabling that policy and retesting was
not reported; privileged integration was discussed but not implemented. APK
lifecycle acceptance remains unproven. SSH tunneling was not implemented.

Existing code, research, and experiments are retained as historical work; no
experiment deletion, device uninstall, or system-policy change has been performed
as part of this cancellation. The original Go implementation remains unchanged.
**Plans, next-step commands, and resume guidance below are historical.** Only
reuse the browser/MASQUE findings that fit the current direction above; do not
resume cancelled mobile-app/SSH work. The bounded browser test above is approved;
public deployment and broader implementation still need explicit scope.

## Historical direction (superseded)

Build an **authenticated, end-to-end PQ-protected service tunnel** with both
Android/browser and computer-to-computer terminal clients. The connecting end
is not restricted to a phone. The expanded product vision includes **SSH**:
a tunnel client runs in one terminal and exposes a loopback port that ordinary
SSH clients in other terminals can use to reach an explicitly configured target.
Multiple independent SSH sessions are intended; authorization, limits, and the
CLI interface still need design. See [VISION.md](VISION.md) for scope and security
requirements. SSH tunneling has not been implemented or tested.

The immediate development path remains an **Android app plus a computer helper**
for one configured localhost HTTP application, beginning with bounded diagnostics:

```text
Any Android browser → http://127.0.0.1:<port>
                    → Android app's local HTTP proxy
                    → end-to-end PQ-protected connection
                    → computer helper → configured localhost application
```

Attempt direct native P2P connectivity where possible; use a controlled relay as
fallback when NAT prevents it. The user has a **Debian VPS**, but its architecture,
existing services, firewall, and deployment suitability have not been inventoried.
VPS changes must be isolated and reversible, with explicit setup/cleanup steps.

Important product choices:

- The user uses **Android**.
- Support any suitable Android browser, not just Chrome. No browser extension or
  browser-specific P2P capability is required: the app handles networking.
- Installing a phone app is now acceptable. This supersedes the earlier
  browser-only/no-install constraint.
- Start with `127.0.0.1:<port>`, not a custom hostname such as `sample8.local`.
  `.local` is mDNS, not arbitrary app-controlled DNS.
- Provisional UI choice: **Tauri 2**, shared Rust networking core, and a small
  Kotlin foreground-service integration. This is a proposal, not an implemented
  or validated mobile architecture.
- The connection must survive switching from the app to an external browser.
  On Android, plan for a foreground service with a persistent notification.
  Do not assume the Tauri/WebView lifecycle alone keeps the Rust core alive.
- A local proxy should offer a copyable URL and Android browser-opening intent.
  Test multiple browsers; don't claim universal compatibility without testing.
- Cloudflare Pages / Irys hosting is **not needed for this app-based path**.
  Earlier browser-frontend hosting research is retained as an alternative.
- No requirement to run an Autonomi storage node, buy storage, or configure a
  wallet merely to use the transport.

## Android development setup: native Rust and Saorsa compatibility diagnostics passed

Android Studio is installed and running. The user's **Fairphone 4 (FP4)**,
running **Android 16**, is connected by USB and authorized in ADB.

Verified setup:

- SDK location: `~/Library/Android/sdk`.
- Installed platform: `android-37.0`.
- NDK: `30.0.16248370`; CMake: `4.1.2`.
- Android Studio bundled Java: OpenJDK `25.0.3`.
- Rust stable target `aarch64-linux-android` installed.
- NDK `aarch64-linux-android35-clang` runs successfully (Clang 21.0.0).

The user compiled `experiments/android-smoke/main.rs` using Rust stable and the
NDK API-35 linker, pushed it to `/data/local/tmp/web-p2p-android-smoke`, and ran
it successfully:

```text
Rust Android smoke test passed
OS: android, architecture: aarch64
```

This proves a standalone native Rust executable runs under ADB on the phone.
It does **not** prove Saorsa/PQ compatibility, networking, APK packaging, or
Android app/service lifecycle. A minimal Android app has since been created
and launched successfully (see below).
The separate `experiments/android-native/` diagnostic subsequently compiled and
ran successfully on the phone using only the transport's `native` feature (no
WebRTC). User-reported results:

- ML-DSA-65 signing, verification, and modified-message rejection passed.
- ML-KEM-768 encapsulation/decapsulation passed.
- Native QUIC endpoint initialized at `127.0.0.1:45573` and shut down successfully.

This proves these PQ primitives and native endpoint initialization work under
ADB on Android ARM64. This initial diagnostic did not test peer handshakes;
the subsequent LAN diagnostic below did. App/service lifecycle remains untested.
The pushed **debug** executable was 153,770,128 bytes; this is not release APK size.

The first offline build lacked `android_system_properties v0.1.6`. The user
fetched dependencies with Rust stable `cargo fetch --locked --target
aarch64-linux-android --manifest-path experiments/android-native/Cargo.toml`,
then completed the build. Keep the generated experiment lockfile. See its README
for build/run/cleanup commands; builds remain in the user's normal terminal.

### LAN diagnostic: build, host tests, and phone-to-Mac Wi-Fi echo passed

The phone and Mac are on the same Wi-Fi. The user reported Mac IPv4
its private LAN address and approved a temporary UDP listener on port `45454`, with a
five-minute lifetime, correct-pin echo, wrong-pin rejection before data, and no
localhost application exposure or VPS changes.

Added `experiments/android-native/src/bin/lan-echo.rs` and CLI integration tests
in `tests/lan_echo.rs`. The agreed test seam is the real diagnostic CLI over QUIC.
The negative test must fail specifically on the client's TLS `UnknownIssuer`,
not on a generic connection failure, then a correct-pin echo must succeed against
the same listener. The user reports `lan-echo.sh build` passed: the two host
CLI acceptance tests and Android build completed. The agent ran only Rust
formatting and shell syntax checks, not Cargo. The user subsequently ran both
LAN scripts successfully:

- Mac listener and observed phone peer used private LAN addresses (redacted).
- Wrong pin: client rejected the handshake before application data; server
  observed TLS alert 48 / `UnknownIssuer` (expected negative-test result).
- Correct pin: ML-DSA-65 server identity verification passed.
- Matching 30-byte native QUIC echo: `web-p2p Android native echo v1`.
- Both endpoints reported their sole configured PQ group as `X25519MLKEM768`
  (hybrid X25519 + ML-KEM-768, not pure ML-KEM-only).
- Pushed Android debug executable: 141,199,784 bytes; public-key pin: 1,952 bytes.

This proves the bounded native phone-to-Mac LAN path under ADB execution,
including pin rejection and authenticated encrypted echo. It does not prove
APK/service lifecycle, visitor authorization, NAT traversal, or relay fallback.

This diagnostic uses Saorsa's lower-level native `Endpoint` and shared raw-key
TLS builders, pinning the Mac's exact ML-DSA-65 public key inside the client TLS
verifier. It checks that all configured key-exchange groups pass the upstream
PQ validator, with no classical-only fallback. Printed groups are configured,
not negotiated telemetry. It does not use WebRTC, NatTraversalEndpoint's default
allow-any identity policy, relay services, discovery, UPnP, or 0-RTT.

Public-key transfer uses authorized USB ADB; echo packets use Wi-Fi UDP. The
server accepts any valid client identity: this is **not visitor authorization**.
It accepts only a fixed bounded echo message, exits after one successful echo,
and limits connection attempts and runtime. Use only on a trusted LAN.

Completed user command: `bash experiments/android-native/lan-echo.sh build`
(two host CLI acceptance tests, then the Android build).

Repeat with Terminal 1: `bash experiments/android-native/lan-echo.sh server
MAC_LAN_IP`; after READY, Terminal 2:
`bash experiments/android-native/lan-echo.sh phone`. The phone script checks
wrong-pin rejection first, then the correct-pin echo. See the experiment README
for cleanup and retry instructions. No listener has been started by the agent.
### Minimal Android APK: launch passed

The user created `experiments/android-app/` in Android Studio. It is a Kotlin
Compose app with package `dev.webp2p.lifecycle`, min SDK 35, compile/target SDK 37,
AGP 9.4.1, Gradle 9.6.0, and Gradle daemon Java 25. The user confirmed it launches
on the Fairphone 4 and displays **Hello Android!**

Android Studio initially showed only Add Configuration. Opening the Android
project directory (`experiments/android-app`), rather than the repository root,
was the advised resolution; app launch subsequently succeeded.

The user approved the next lifecycle acceptance test: Start with a persistent
notification, periodic echoes over one pinned connection, unplug USB and use a
browser for two minutes, return with continuous echo progress and no reconnect,
then Stop closes the connection and removes the notification.

### Foreground-service/JNI diagnostic: implemented, validation pending

Prepared in `experiments/android-app/`:

- `TunnelService.kt` owns native start/status/stop, a visible notification, and
  a 165-second deadline. Uses Android `shortService` only for this bounded test;
  this does not establish an indefinite production foreground-service policy.
- Compose UI displays native progress, handshake count, maximum echo gap, and a
  conservative background-return check. USB removal remains manually verified.
- JNI library and shared Rust session in `experiments/android-native/src/`:
  `lan.rs` holds the existing pinning/configuration, `lifecycle.rs` owns one
  connection and periodic echoes, and `android.rs` is the small JNI adapter.
- `lifecycle-echo` is the bounded Mac listener. No reconnect, real localhost
  target, visitor authorization, or relay service is added.
- `lifecycle.sh` builds, installs, runs the Mac listener, and provisions the fresh
  public pin into the debug app's private files via authorized ADB `run-as`.
  Provisioning force-stops a previous diagnostic app session before replacing
  configuration. It never uses ADB port forwarding.
- Existing real-socket CLI pinning tests retained; added host tests for repeated
  echoes/Stop and terminal connection loss without reconnect. The user reported
  the build script succeeded after fixing Gradle configuration-cache capture in
  `verifyNativeDiagnostic` (resolve the File during configuration, not in doLast).
  Device lifecycle acceptance remains blocked by the connection failure below.
  The agent ran formatting/static checks, not Cargo or Gradle.

#### Current blocker: APK reports connection refused (os error 111)

- Phone is LineageOS, Android 16 / API 36; installed APK targets SDK 37.
- INTERNET permission is granted. RESTRICT_LOCAL_NETWORK compat change reports
  disabled. No always-on VPN is configured; ordinary VPN/firewall status has not
  been confirmed. Do not infer a missing permission or blame LineageOS without
  further evidence.
- Mac listener is bound at its private LAN address; app-private server.addr matches.
- `lifecycle.sh probe` uses the previously built ADB-shell CLI. Its expected
  wrong-pin TLS rejection succeeds against this same listener.
- Simultaneous Mac capture saw 11 UDP packets in one flow from phone
  the phone's private LAN endpoint, consistent with the successful probe. No separate APK
  flow was shown in the user's capture. This narrows the investigation but does
  not prove a specific restriction or code defect.
- Helper commands now include `probe`, read-only `diagnose`, and Mac `capture`.
  Capture requires user-terminal administrator permission for tcpdump only;
  no firewall changes, payload dump, or capture file. Agent permissions unchanged.
- Added permanent error context labels around native runtime creation, worker
  spawn, client socket/endpoint setup, QUIC initiation/handshake, and echo I/O.
  These latest diagnostic changes are formatted but **not yet built or tested**.
  The user rebuilt and reported: `prepare native client: bind client UDP socket:
  Connection refused (os error 111)`. This fails in `std::net::UdpSocket::bind`
  **before** QUIC endpoint creation or any Mac handshake. That call includes
  socket creation as well as binding; it does not yet identify the failing syscall.
- Split native socket creation and bind using already-resolved
  `socket2 = 0.6.5`, with separate error labels. The user ran the resulting local
  probe: Android Os, Rust std, and Rust split all failed; Android Os and Rust
  split both identify **socket creation**, before bind, with ECONNREFUSED (111).
  This is not a Rust/JNI-specific failure. Added temporary **Check local UDP** UI and JNI probe comparing Android
  `Os.socket/bind`, the original Rust std bind call, and split Rust socket calls
  inside the APK. No Mac listener, pin, traffic, or permission change is needed
  for this test. `UdpDiagnostic.kt` output is tagged `[DEBUG-udp-local]`; remove
  this temporary probe after diagnosis. No policy bypass, extra Android permission,
  or firewall disablement has been applied.
- Primary-source clue: LineageOS `android_system_netd`, branch `lineage-23.0`,
  `client/NetdClient.cpp::netdClientSocket` explicitly converts EPERM on blocked
  AF_INET/AF_INET6 socket creation into ECONNREFUSED. This explains why the error
  can indicate an OS network policy denial, not a refused remote connection.
  It does not identify the exact active policy on this phone.
- Added a read-only `restricted_networking_mode` global-setting check to
  `lifecycle.sh diagnose`; awaiting its result. The LineageOS Settings source
  defines 1 as restricting access to apps with CONNECTIVITY_USE_RESTRICTED_NETWORKS.
  Do not request that privileged permission or bypass device policy.

Current next step: rerun `bash experiments/android-app/lifecycle.sh diagnose`.
No further APK rebuild is needed just to query this setting. For reference,
the diagnostic build/install commands remain:

```sh
bash experiments/android-app/lifecycle.sh build
bash experiments/android-app/lifecycle.sh install
```

After successful build: `.../lifecycle.sh install`, then Mac Terminal 1:
`.../lifecycle.sh server MAC_LAN_IP`; after READY, Terminal 2:
`.../lifecycle.sh provision`. Follow `experiments/android-app/README.md` for the
full two-minute browser-switch/USB-disconnect acceptance and cleanup sequence.
Keep the screen on; screen-off/Doze behavior is outside this first test.

The user also requested unnecessary-file cleanup. Removed only unused Android
template tests, Greeting/preview UI, generated Compose theme/color files,
sample backup XML, and unused catalog/dependency entries. Kept required Android
resources and Gradle wrapper, native acceptance tests, research, and prior working
experiments. Git staging was not changed; staged template files now deleted in
the worktree must be staged deliberately if desired. Generated JNI libraries and
public provisioning state are ignored. Tauri remains unvalidated and unnecessary
for this diagnostic.

## What has actually passed

The existing Go tunnel was left unchanged. New code is isolated under
`experiments/relay-spike/`, `experiments/android-smoke/`, and
`experiments/android-native/`.

### Native local relay diagnostic

User successfully compiled and ran a real local path:

```text
Native WebRTC visitor → real MASQUE relay allocation
                     → helper's outbound QUIC connection
                     → local UDP bridge → WebRTC listener → Saorsa PQ echo
```

A matching 23-byte authenticated encrypted echo was reported, with:

- Relay → listener: 19 packets / 3,626 bytes.
- Listener → relay: 21 packets / 8,777 bytes.

### Real desktop browser local relay diagnostic

User built the WASM fixture and ran it in **Chrome 154 on macOS**:

- Secure localhost context; shared Saorsa PQ WASM loaded.
- WebRTC connected to the relay allocation, not the helper listener.
- Publisher identity authenticated; **25-byte encrypted echo matched**.
- Relay → listener: 25 packets / 7,701 bytes.
- Listener → relay: 25 packets / 8,865 bytes.
- Rejected source packets: 0.
- Selected ICE pair: local `prflx`, remote `host`, UDP. MASQUE forwarding happens
  outside browser ICE, so the candidate type need not say `relay`.

These results prove the respective **local transport paths**, not mobile support,
real NAT traversal, public relay availability, visitor authorization, HTTP
forwarding, or production security.

### Not yet implemented or tested

- Android app/service runtime integration for the pinned Saorsa stack
  (native peer handshake and pinned encrypted LAN echo passed via ADB).
- iOS compilation or runtime support.
- Tauri app; validation of the newly implemented Kotlin foreground service and
  Rust JNI/lifecycle integration.
- Native phone-to-computer connectivity across NAT / different networks
  (direct native QUIC on the same Wi-Fi passed, without WebRTC).
- Direct-first selection and relay fallback under real network conditions.
- A separately deployed relay and helper, or a phone-on-cellular test.
- Local HTTP/WebSocket forwarding, pairing, visitor authorization, target policy.
- SSH/TCP forwarding and computer-side terminal client access (new product
  direction documented in `VISION.md`; no SSH service has been exposed).
- Release mobile download size, memory consumption, or idle battery use.
- Safari browser acceptance or Irys Service Worker deployment.

## Recommended next milestones

1. **Completed: verify Android toolchain and attached phone.** A standalone
   ARM64 Rust executable compiled and ran on the physical Fairphone 4 via ADB.
2. **Completed: minimal Rust Android compatibility diagnostic** for native
   Saorsa/PQ, isolated in `experiments/android-native/`, without WebRTC.
   This covers PQ self-tests and endpoint startup/shutdown, not a peer handshake.
3. **Completed: PQ-protected phone-to-Mac echo on local Wi-Fi**, including
   correct-pin acceptance and wrong-pin rejection before application data.
4. Establish foreground-service ownership of the tunnel; switch to a browser and
   verify the connection survives. Measure release size and memory.
5. Expose a bounded diagnostic loopback HTTP endpoint and check several browsers.
   Loopback binding alone is not authorization; design protection against other
   apps and cross-origin requests before exposing real localhost data.
6. Inventory the Debian VPS, agree on reversible deployment and access limits,
   then test **phone cellular → relay → computer on home Wi-Fi**. Separately test
   direct connectivity with relay disabled so results are not ambiguous.
7. Add pairing/access grants, one configured localhost target, and carefully
   bounded HTTP/WebSocket forwarding. Handle redirects, cookies, hostnames,
   origin/security assumptions, and streaming explicitly.

TDD was discussed previously, but no specific mobile test seams have been agreed.
Confirm the first acceptance test and architecture before a broad implementation.

## Existing experiment and repeatable commands

Read `../experiments/relay-spike/README.md` for complete details and limitations.
Run builds in the user's normal terminal, from the repository root.

Native echo:

```sh
set -o pipefail
env PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  "$HOME/.cargo/bin/cargo" run --locked --offline \
  --manifest-path experiments/relay-spike/Cargo.toml \
  -- local 2>&1 | tee /tmp/web-p2p-relay-run.log
```

Rebuild browser bindings with anonymized source paths (old generated assets were removed):

```sh
set -o pipefail
env PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  node apps/browser/build.ts --dev \
  2>&1 | tee /tmp/web-p2p-relay-wasm.log
```

Run the local browser fixture:

```sh
set -o pipefail
env PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  "$HOME/.cargo/bin/cargo" run --locked --offline \
  --manifest-path experiments/relay-spike/Cargo.toml \
  -- browser 2>&1 | tee /tmp/web-p2p-relay-browser.log
```

Open the printed URL on the same computer. One browser attempt per CLI run;
restart before reloading/retrying/switching browsers. Ctrl-C stops it; otherwise
it expires after ten minutes. Generated WASM assets are ignored by Git, so a fresh
checkout will need that build. Retain both native and WASM Cargo lockfiles.

### Toolchain facts and resolved build obstacle

- Host: Apple Silicon Mac (`aarch64-apple-darwin`).
- Separate Rustup stable installation: `rustc 1.99.0 (b940084d7 2026-09-28)`.
- Installed Rustup targets: `aarch64-apple-darwin`, `aarch64-linux-android`,
  `wasm32-unknown-unknown`.
- `wasm-pack 0.15.0` installed; Homebrew Rust also remains installed.
- An unqualified native build triggered concurrent Rustup `rust-src` downloads
  and failed renaming the shared `.partial` download file. The explicit
  `PATH`/`RUSTUP_TOOLCHAIN=stable` command above succeeded. The underlying trigger
  for those component installations was not established; do not claim a proven
  Rustup root-cause fix or delete caches unnecessarily.
- Agent used Homebrew rustfmt for formatting because the minimal Rustup profile
  did not include rustfmt. JS syntax checks passed; actual builds/runs were done
  by the user.
- Observed artifacts: ~1.2 MiB browser PQ WASM and ~75 MiB desktop debug binary.
  Neither establishes release mobile app size or runtime resource usage.

## Code pointers and important limitations

- `experiments/relay-spike/src/main.rs`: native diagnostic, CLI and endpoint setup.
- `experiments/relay-spike/src/bridge.rs`: bounded, throwaway UDP/MASQUE adapter.
- `experiments/relay-spike/src/browser.rs`: local browser fixture and fixed HTTP routes.
- `apps/browser/src/app.ts`, `src/style.css`, `index.html`: Vite/TypeScript diagnostic UI.
- `apps/browser/crypto/`: separate WASM crate, sharing upstream
  SDP synthesis and `PqClientHandshake`/`PqSession` rather than JS cryptography.

Pinned transport: `WithAutonomi/saorsa-transport` at
`e2f08388088313c82cac393afa6ca27b9ce00516`; PQ crate: `saorsa-pqc = 0.5.2`.
The native fixture enables `webrtc-direct`; the WASM crate enables portable
`webrtc` only. PQ session algorithms: ML-KEM-768, ML-DSA-65,
ChaCha20-Poly1305. Reuse the shared implementation, not homemade cryptography.

The bridge forwards through a connected local socket, losing the actual visitor
source as seen by the WebRTC listener. It pins one visitor and is unsuitable for
production source admission, multiple visitors, mobility or rebinding. Native
mode accepts loopback sources; browser mode also accepts addresses the OS can
bind locally. Do not simply remove this restriction for an Internet deployment.

Upstream relay allocations use wildcard ephemeral UDP sockets even in this
local test. Endpoint discovery and UPnP are disabled; no public peers are used.
The PQ session authenticates the publisher, **not authorization of the visitor**.
The fixture only echoes, caps messages at 8 KiB, and does not expose an HTTP app.

## Hosting and relay investigation already done

See the research files rather than restarting these investigations:

- `research/p2p-rebuild.md`: initial options and current-code correction.
- `research/browser-to-publisher-connectivity.md`: WebRTC Direct/PQ source audit;
  early conclusions predate the successful local experiments above.
- `research/irys-browser-entrypoint.md`: HTML/JS hosting works; actual worker
  registration and deployed tunnel are not proven.
- `research/cloudflare-browser-fixture.md`: Pages can serve the static browser
  fixture with free `pages.dev` HTTPS; no deployment was made.
- `research/hosted-relay-availability.md`: no verified operator-approved drop-in
  public Saorsa relay found. Old documented Saorsa bootstrap names returned
  NXDOMAIN; this does not mean the Autonomi network is offline. Autonomi publishes
  other literal-IP bootstrap endpoints and implements native relay capability,
  but compatibility/capacity/third-party tunnel permission remain unverified.
- `research/try-autonomi-connection-path.md`: the live site uses direct WebRTC to
  public storage nodes, not a demonstrated reverse tunnel to a private publisher.
  Its WASM hash matches the audited SDK; no new file download was tested here.
- `research/skaists-bview-relay.md`: the example offers both direct SDK access and
  an HTTPS-to-Autonomi file gateway. That gateway's public file API is not a
  TURN/MASQUE tunnel allocation interface.

Google's public STUN service (used in the original web client) discovers
addresses; it is not an application-data relay. Cloudflare Realtime TURN is a
real hosted alternative with documented 1,000 GB/month shared SFU/TURN allowance
and $0.05/GB additional egress at research time, but is **not a drop-in Saorsa
MASQUE replacement**. No TURN account/credentials/allocation were created.

## Permissions and deployment boundaries

- The user explicitly declined expanding agent sandbox permissions. Do not ask
  for additional grants merely to build: give commands for the normal terminal
  and request results.
- Earlier `nono why` confirmed Cargo cache writes under `~/.cargo` are denied.
  Do not retry around that boundary or use privileged commands to bypass it.
- Do not request SSH credentials. The user can execute VPS commands themselves.
- No VPS installation/firewall change, Cloudflare/Irys publication, public relay
  allocation, wallet operation, or localhost application exposure has occurred.
  Confirm scope before taking any such action.
- Keep existing Go implementation unchanged while experiments proceed.
- Do not conflate local success with mobile, Internet/NAT, security, or production
  acceptance. Preserve rollback and explicit limits throughout.

At the latest Git inspection, `experiments/android-app/` had staged additions
plus newer unstaged edits; its Gradle daemon config was untracked. `docs/` and the
other experiments remained untracked. No commits were made by the assistant.
Preserve the user's staging choices; save/commit deliberately before cleanup or
moving machines. Generated build outputs should remain excluded.

## Suggested first message when resuming

> Read docs/STATUS.md. Native LAN echo and the initial Android APK launch passed.
> The bounded foreground-service/JNI lifecycle diagnostic is now implemented but
> unvalidated. Next run its build and two-minute browser/USB-disconnect test using
> experiments/android-app/lifecycle.sh. Don't deploy to the VPS yet.
