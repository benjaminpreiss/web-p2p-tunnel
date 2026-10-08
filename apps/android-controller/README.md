# Android phone-local controller delivery

An installed Android app serves the trusted, bundled browser controller to
Chrome/Brave on the **same phone**. This is not the cancelled native Android
UDP/QUIC tunnel. Those deleted experiments are not restored.

```text
Installed APK with HTML/JS/PQ WASM → phone HTTP 127.0.0.1:18787/controller/
    → Chrome / Brave WebRTC + PQ → pinned MASQUE relay
    → computer helper → configured target application
```

The Android app only serves fixed files. It has no native UDP tunnel, WebView,
wallet, visitor token storage, proxy or remote download/update mechanism. The
browser owns the tunnel. The controller uses the existing **hosted/manual-
descriptor mode**, even though its files now come from phone loopback. There is
no automatic `/session.json` discovery or connection.

## Prepare the controller, then build the APK

From the repository root, with Node 24 and existing browser dependencies:

```sh
node apps/android-controller/prepare.ts
```

If dependencies are missing, first run `npm ci --prefix apps/browser --ignore-scripts`.
Preparation rebuilds the frontend and uses the existing privacy-safe WASM in
`apps/browser/pkg/`. If WASM is missing or Rust crypto changed, first run
`npm --prefix apps/browser run build` (requires Rust and wasm-pack).

Only the existing five-file artifact is staged under ignored
`generated/assets/controller/`: HTML, app JS, CSS, crypto JS and WASM. The exporter
rejects symlinks, unexpected files, invalid WASM and embedded home paths.
Checksums and frontend-source fingerprints stay outside the APK assets. Each
Gradle build checks staged bytes and source fingerprints and rejects a stale or
missing preparation. **Rerun preparation after frontend changes.** Nothing is
uploaded, committed or funded.

1. Open `apps/android-controller` as a standalone project in Android Studio.
2. Set **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle
   JDK** to **JDK 21** (Download JDK if needed). The installed Studio JBR may be
   Java 25, unsupported by the pinned Gradle version. Studio itself can keep it.
3. Sync. The project pins **AGP 8.9.2 / Gradle 8.11.1**, compiles/targets API 35
   and runs on API 26+. Install SDK Platform 35 / requested build tools if needed.
   Do not accept unrelated migration/plugin-upgrade suggestions for this test.
4. Select the phone and Run **app**. Use a full rebuild/install, not merely Apply
   Changes, when updating bundled assets. Package: `dev.webp2p.controllerprobe`;
   displayed name: **Local Controller Probe**.
5. Tap **Start server**, wait for **LISTENING**, then manually type in Chrome/Brave:

   ```text
   http://127.0.0.1:18787/controller/
   ```

   Keep the trailing slash. The app's Open button previously produced HTTP 403;
   manual address-bar entry worked. The rejected header remains undiagnosed;
   guards remain unchanged. Don't substitute `localhost`, HTTPS or another port.
   Do not use an ADB reverse mapping for this phone-local test.

## Passed gate: bounded HTTP tunnel from the bundled controller

1. Confirm **Secure context: true**, **Saorsa PQ WASM loaded**, and the loopback
   `/controller/` page location. No descriptor/token should be prefilled.
2. Keep phone and computer on the same Wi-Fi. In separate computer terminals:

   ```sh
   node apps/browser/fixtures/http-app.ts 3000
   ```

   ```sh
   bash experiments/relay-spike/hosted.sh build
   bash experiments/relay-spike/hosted.sh http MAC_LAN_IP PHONE_LAN_IP 3000
   ```

   Replace placeholders with current addresses. No change to relay restrictions
   or publisher authentication is needed. See [HTTP inspector](../../docs/HTTP-INSPECTOR.md).
3. Paste the fresh public descriptor and separate private visitor token into the
   **browser controller**, never into URLs. Keep paths `/` and `/style.css`.
4. Tap **Authorize and fetch paths**, not the echo button. Expect publisher
   authentication, visitor authorization, HTTP 200 with **192-byte HTML** and
   **48-byte CSS**, displayed as inert text.
5. Ctrl-C the computer helper. Record final bidirectional bridge counters and
   whether it stopped cleanly. Close the controller tab, then Stop the Android
   server. Stop the fixture when finished. Share only sanitized diagnostics and
   counters, never the token or full terminal transcript.

**Stopping the Android static server does not revoke an already-open browser
WebRTC session.** The server also has a ten-minute timer; loaded controller code
can continue running afterward. Stop the computer helper to end its grant and
close the browser controller when finished. Android/browser background WebRTC
survival is not established by the earlier static-server lifecycle check.

## Retained delivery probe

`http://127.0.0.1:18787/` still serves the original diagnostic page. Its worker
controls **only `/probe-scope/`**, not `/` or `/controller/`; it synthesizes one
proof response without caching files. The page offers registration, a scoped test
page and targeted unregister cleanup. Close existing worker-controlled tabs after
unregistering. Controller startup does not register a worker.

The user already passed the original gate: bundled page delivery by manual URL
entry, worker registration/interception, root-page reload after one minute with
the browser foregrounded, worker cleanup, and failure to connect after Stop.
The old native UDP failure did not predict this TCP-loopback result. No device
policy change was requested. Automatic expiry and long-term lifecycle remain
unproven.

## Security and limits

- User-started foreground service, Stop action and ten-minute timer. Notification
  visibility depends on Android settings; the Activity also has Stop. No boot
  receiver, automatic restart, wake lock, battery exemption or privileged network
  permission. Never disable Restricted networking mode or browser security.
- Numeric IPv4 loopback only, fixed port, no fallback. An occupied port is an
  error; do not interact with whatever server already owns it.
- Ten fixed routes: five diagnostic routes plus five controller routes. GET only,
  exact Host and Origin/fetch-site checks, no directory listing/path decoding,
  filesystem serving, cookies, CORS grants, request bodies or target proxying.
- Request headers: 8 KiB / two seconds; sequential connections. Diagnostic files
  are bounded to 64 KiB each; each controller asset to 16 MiB. Not a production
  HTTP server or hostile-local-client DoS defense.
- Controller CSP admits only same-origin scripts/styles/fetches plus the narrow
  **`wasm-unsafe-eval`** permission needed for WASM compilation. No `unsafe-eval`,
  inline script, external HTTP fetch, embedding or controller worker registration.
  The existing browser WebRTC path remains subject to actual phone acceptance.
- Trust moves from a remote gateway to the installed APK/build/update mechanism.
  Debug APKs are not a production release/signing process. No download verifier
  or APK auto-updater has been implemented.
- Loopback is not authentication against other phone apps. HTTP does not identify
  the serving process; another local app could occupy the port when this server
  is absent. Assume a trusted phone/installed-app environment. This does not solve
  hostile-local-app impersonation or target-script isolation. Target responses
  remain inert, not executable applications.

## Validation

Prepare the bundle first, then run (JDK 17+ and Node):

```sh
JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' \
  bash apps/android-controller/test-server.sh
```

The standalone tests work on Studio's Java 25; Gradle still needs JDK 21.
**76 real-TCP/asset-loader assertions, 3 staging/worker tests and 4 bundle checks
pass**, including real WASM boot at the phone-local URL in the browser-API harness.
The Android service delegates to the same `BundledSite` loader exercised by the
TCP tests: fixed routes, MIME types, missing/oversized input rejection and exact
binary response bytes. The command also typechecks preparation code and tests.
Browser's 15 unit/export tests, frontend typecheck/build and JS syntax checks also
pass. The harness is not a browser CSP or WebRTC test.

**The user-run updated APK build and phone-local controller tunnel gate passed.**
The loopback controller reported a secure context, loaded PQ WASM, authenticated
the publisher, authorized the visitor, and returned the expected HTTP 200 results
(192-byte HTML and 48-byte CSS). Final relay → listener: **35 packets / 11,305
bytes**; listener → relay: **35 packets / 10,059 bytes**; rejected sources: **0**.
The computer helper stopped without an error. This validates the served CSP and
browser WebRTC on this phone, not broader devices or transparent app rendering.
Manual URL entry remains required for the tested flow; the launch-button 403 is
still open. No private session details are retained.

The agent cannot read the installed Android SDK under its sandbox; Android
Studio/user runs supplied APK and phone validation. After that accepted run, the
checkpoint cleanup extracted the existing asset loader into `BundledSite` without
changing routes or limits. Desktop checks cover the extraction; a rebuilt APK
smoke check on the phone is still needed for this exact cleanup revision.

Wrapper files come from Gradle `v8.11.1`. Its JAR matches the official checksum
`2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`;
the distribution checksum is pinned in `gradle/wrapper/gradle-wrapper.properties`.
