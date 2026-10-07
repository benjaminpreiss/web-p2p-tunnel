# Local WebRTC-over-MASQUE experiment

**Resume here:** [project status](../../docs/STATUS.md).
Current direction: an Irys-hosted browser client, terminal computer helper, and
pinned Saorsa MASQUE relay path. Android app and SSH development are cancelled.
The local desktop experiments and phone-browser LAN mode passed. The phone
result uses USB for frontend delivery, not an Irys-hosted deployment.

**Next gate:** [static Irys-hosted page, no USB](HOSTED.md). The static bundle and
no-HTTP/ADB helper mode are prepared. JS/export tests passed; updated Rust
compilation and a real Irys upload/browser run remain pending. Nothing has been
published or paid for. Build with `bash experiments/relay-spike/hosted.sh build`
from the repository root.

**Throwaway diagnostic, not the production tunnel.** This does not forward HTTP,
expose a localhost application, publish a website, or contact public relay peers.
The existing Go tunnel is unchanged.

## Question

Can Saorsa's existing native MASQUE relay carry WebRTC packets to a terminal
helper, with the PQ session terminating at the visitor and helper?

**Local native relay-path diagnostic passed in the user's terminal on 2026-10-06.**
The supplied run log reports successful compilation and a matching 23-byte,
PQ-authenticated encrypted echo. Measured bridge traffic:

- Relay → listener: 19 packets, 3,626 bytes.
- Listener → relay: 21 packets, 8,777 bytes.

The visitor dialed the relay allocation, not the helper's listener. This confirms
that this local adapter can carry the native WebRTC wire profile through the real
MASQUE forwarding path. It does **not** establish browser compatibility, real NAT
traversal, mobile support, public-relay permission, or production security.

The run also logged an initial ICE candidate warning and connection-closed
warnings around teardown. They did not prevent the authenticated echo or the PASS
result; clean shutdown and lifecycle behavior remain work for later validation.

## Run

Run these commands in your normal terminal, outside the agent's nono sandbox:

```sh
cd /path/to/web-p2p-tunnel
set -o pipefail
cargo run --locked --offline --manifest-path experiments/relay-spike/Cargo.toml \
  -- local 2>&1 | tee /tmp/web-p2p-relay-run.log
```

The first `cargo run` also builds executable code and links dependencies; the
previous `cargo check` only checked compilation. Offline mode uses the dependencies
already fetched by that check. The generated `Cargo.lock` records that resolved
dependency set; retain it for reproducibility.

Paste back the last 120 lines:

```sh
tail -n 120 /tmp/web-p2p-relay-run.log
```

A different short message can be selected with `-- local --message 'relay probe'`.
Messages are limited to 8 KiB. Do not use secrets in command-line arguments.

## Actual path

All roles run in one process, with separate real network endpoints:

```text
Native WebRTC diagnostic visitor
  -> relay-allocated UDP socket
  -> Saorsa MASQUE forwarding over the helper's outbound QUIC connection
  -> helper's local UDP bridge
  -> WebRTC listener
  -> shared Saorsa PQ session
  -> bounded echo reply through the reverse path
```

The visitor is given only the relay allocation and publisher certificate pin,
not the helper's listener address. It authenticates an independently supplied
publisher identity using Saorsa's PQ handshake and compares the decrypted echo.
Packet/byte counters report both directions through the bridge.

A successful run ends with:

```text
PASS: native WebRTC + PQ echo traversed the real local MASQUE relay.
NOT YET PROVEN: browser compatibility, phone/NAT connectivity, public relay availability.
```

If it fails, the phase marker, error chain, and any printed packet counts help
separate relay allocation, datagram delivery, WebRTC negotiation, and PQ session
problems. Ctrl-C cancels the diagnostic; the exchange has a 60-second deadline.
Endpoint shutdowns each have a separate 10-second deadline.

## Browser gate (passed locally in Chrome 154)

The user's browser log confirms a successful run on 2026-10-06:

- Saorsa PQ WASM loaded in a secure localhost context.
- Standard browser WebRTC connected to the relay allocation at `127.0.0.1`.
- The publisher identity was authenticated and a 25-byte encrypted echo matched.
- Relay → listener: 25 packets, 7,701 bytes.
- Listener → relay: 25 packets, 8,865 bytes.
- Rejected source packets: 0.
- Selected ICE pair: local `prflx`, remote `host`, UDP.

This establishes the local **Chrome browser → MASQUE relay → helper → PQ echo**
path. It does not establish Safari/mobile compatibility, Internet NAT traversal,
public relay availability, visitor authorization, or HTTP forwarding.

The `browser` command replaces the native visitor with a real browser. It serves
only a fixed diagnostic page, its JS/WASM, public session metadata, and counters
on an ephemeral **loopback HTTP address**. No static hosting or wallet is needed.
Loopback HTTP is treated as a secure context by supported browsers; this is not
an HTTP deployment scheme for a remote phone.

The separate `apps/browser/crypto` crate wraps the same pinned Saorsa implementation.
It generates the pinned SDP answer and performs PQ authentication/encryption; the
JavaScript page uses ordinary `RTCPeerConnection` and never implements crypto.
The WASM crate has its own lockfile and no native transport features.

### 1. Build the browser bindings

Run in the normal terminal, outside nono, from the repository root:

```sh
set -o pipefail
env PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  node apps/browser/build.ts --dev \
  2>&1 | tee /tmp/web-p2p-relay-wasm.log
```

The `env` settings apply only to this command. They ensure wasm-pack uses the
Rustup toolchain with the installed WASM target, not Homebrew Rust. The TypeScript
wrapper remaps identifying build paths and emits browser-native modules into
`apps/browser/pkg`, using the committed Cargo lockfile. Nothing is published.
This first build downloads dependencies and may install wasm-bindgen tooling.

Stop on failure and inspect the log locally. Redact personal paths before sharing.

### 2. Run the browser fixture

```sh
set -o pipefail
env PATH="$HOME/.cargo/bin:$PATH" RUSTUP_TOOLCHAIN=stable \
  "$HOME/.cargo/bin/cargo" run --locked --offline \
  --manifest-path experiments/relay-spike/Cargo.toml \
  -- browser 2>&1 | tee /tmp/web-p2p-relay-browser.log
```

Use this explicit toolchain selection for the native build too. The initial
unqualified build triggered multiple Rustup `rust-src` downloads and failed to
rename a shared temporary file. The explicit-toolchain retry succeeded; the
underlying trigger for those component installations has not been established.

Open the printed `http://127.0.0.1:<port>/` URL **on this computer**, in ordinary
Chrome or Safari with no special flags. Click **Connect and verify encrypted
echo**. Keep the terminal command running while doing this.

Paste back all text under **Diagnostics**, plus the last 100 lines of the
terminal log. If compilation fails, paste that error instead. Browser success is
reported by the page, not merely by an open DataChannel or the CLI's queued reply.

One attempt per run: restart the CLI before reloading, retrying, or switching
browsers. The fixture expires after ten minutes; Ctrl-C stops it sooner.
A browser may present its own local-network permission prompt; do not disable
browser security or use experimental flags to force a result.

The page reports selected ICE candidates and actual helper bridge counters.
The browser's candidate type may say `host`, not `relay`: our MASQUE allocation
forwards UDP outside the browser ICE implementation, unlike a TURN allocation.

## Phone-browser LAN gate (passed in mobile Chrome 152)

The user's page diagnostics reported a secure context, loaded PQ WASM,
authenticated publisher identity, and a matching 25-byte encrypted echo to
the helper's private LAN endpoint. Bridge counters: relay → listener 23 packets / 6,240 bytes;
listener → relay 23 packets / 8,771 bytes; rejected sources 0. Selected ICE pair:
local `prflx`, remote `host`, UDP. The user also passed all three Rust guard tests.
Final Mac bridge-pin/shutdown logs have not yet been supplied.

The ADB browser-opening intent initially produced a Host/Origin guard rejection.
Typing the exact loopback URL manually worked. The rejecting header was not
identified; no security check was relaxed.

This is a bounded **development test**, not an Irys publication or public relay.
It needs only Rust/build tools on the Mac, Android Platform Tools (`adb`), an
authorized USB phone, and a suitable phone browser. Android Studio and our APK
are not used. Final website users will not need USB debugging or ADB.

```text
Page, WASM, identity metadata, counters:
  phone browser -> phone localhost:18880 -> USB ADB reverse -> Mac loopback HTTP

Actual encrypted echo:
  phone browser -> Wi-Fi UDP to Mac's MASQUE allocation
                -> real local MASQUE forwarding / outbound helper QUIC
                -> loopback UDP bridge -> helper WebRTC/PQ echo
```

The relay and helper still run on the same Mac. Their control connection and the
WebRTC listener remain loopback-only. Upstream already allocates a wildcard UDP
socket; phone mode advertises its port at the explicitly supplied Mac LAN IP,
which must be private and locally bindable. The bridge permits **only the supplied
phone IPv4 address**, then pins its first source port. Other private addresses
and loopback are rejected in phone mode. The original local modes retain their
source restrictions. Source-policy/address tests, build and this phone-browser
run passed; other browsers and deployed configurations remain unverified.

Source-IP gating is **not visitor authorization** and cannot resist spoofing by
other LAN users. Upstream's wildcard allocation itself remains a LAN-visible
UDP socket. Use only on a trusted LAN; do not forward router ports or publish this
fixture. It echoes at most one 8-KiB message and expires after ten minutes. No
localhost HTTP application is exposed. Metadata/pin delivery trusts your authorized
USB connection; production pairing and public-hosted origin behavior are unproven.

**Device policy still matters.** The browser must be allowed to create sockets.
If Restricted networking mode also blocks it, the website is not a workaround.
Do not disable browser security, use experimental flags, or assume a permissions
fix. A normal website loading is a useful baseline, not proof that WebRTC works.

From the repository root in your normal terminal:

```sh
bash experiments/relay-spike/phone.sh build
```

This runs Rust tests/build offline with the existing lockfile. Existing WASM
assets are reused; if missing, wasm-pack builds them using the previously working
command (which may fetch its tooling/dependencies). Agent sandbox permissions
remain unchanged. Compilation and the phone LAN test have passed.

Confirm both devices' current Wi-Fi IPv4 addresses. With the addresses most
recently observed in this session, Terminal 1:

```sh
# Replace MAC_LAN_IP and PHONE_LAN_IP with your current private addresses.
bash experiments/relay-spike/phone.sh run MAC_LAN_IP PHONE_LAN_IP
```

The script refuses to replace an existing reverse mapping. Wait for **Open on
the PHONE**, then Terminal 2:

```sh
bash experiments/relay-spike/phone.sh open
```

Or manually open `http://127.0.0.1:18880/` in the phone browser. **Keep USB attached**
for page/metadata/counters throughout this test. Allow only normal permission
prompts you intend to grant. Click **Connect and verify encrypted echo** once.
Capture the page's complete Diagnostics and Terminal 1 output. Acceptance requires
PQ identity authentication, a matching echo, relay traffic in both directions,
and the bridge logging the intended phone's IP. Opening the page alone is not a
transport pass. Counters measure bridge UDP payload, not complete VPS billable
traffic or direct-first savings.

Restart Terminal 1 before a retry, reload or browser switch; then reopen the URL.
Ctrl-C stops the fixture and removes its ADB reverse mapping. If USB was removed
or the script was hard-killed, reconnect USB, stop any old fixture, then run:

```sh
bash experiments/relay-spike/phone.sh cleanup
```

This removes only `tcp:18880`, never all reverse mappings. No app installation,
SSH service, firewall change, Irys publication or VPS deployment occurs. A pass
would establish this one browser/device on LAN, not deployed Irys behavior,
cellular/home NAT connectivity, direct-first selection or production safety.

### Local browser adapter caveat

A browser can originate its packets from a local LAN-interface address even when
the destination is loopback. Browser mode accepts such a source only if the OS can
bind that IP locally, then pins one visitor socket address. It rejects other
sources; it does not accept arbitrary private-network IP ranges. Native `local`
mode retains its original loopback-only source policy. This is an experiment
restriction, not authentication or a substitute for production admission rules.
The WebRTC listener still sees the local proxy's source address.

## Deliberate restrictions

- `local` uses Saorsa's **native WebRTC diagnostic client**. `browser` has passed
  in desktop Chrome 154. `browser-phone` passed in mobile Chrome 152 on the
  user's phone. Safari and other phones remain unverified; this is not public deployment.
- Does not simulate a real home NAT or prove cellular compatibility.
- Generates ephemeral identity/certificate keys in memory; no wallet or saved
  credentials are required.
- Native control endpoints and the helper's listener bind loopback. **Upstream's
  relay allocation binds a wildcard ephemeral UDP port**, and the diagnostic
  native visitor also binds an ephemeral wildcard socket. The helper-side bridge
  accepts one local visitor, with the mode-specific source restrictions above.
  No firewall changes or router forwarding are performed. This is not a hardened
  public relay.
- UPnP and network-discovery default features are not enabled in the dependency;
  native endpoint UPnP is explicitly disabled. No bootstrap peers are configured.
- The bridge forwards through a connected loopback UDP socket rather than changing
  upstream's socket interface. The WebRTC listener therefore observes the proxy's
  address, **not the original visitor IP/port**. This is not a production solution
  for source admission, multiple visitors, mobility, or address rebinding.
- Relay frames and queues are bounded. Relay keepalives are handled. PMTU/control
  frames cause an explicit failure; they are not silently treated as data.
- PQ handshake and record encryption come from the pinned Saorsa implementation;
  we do not implement our own cryptographic algorithms.
- The PQ session authenticates the helper, not visitor authorization. Echo is the
  only operation. Authorization must be designed before adding localhost access.
- No automatic reconnection or relay discovery. No claim that existing public
  Autonomi relays permit this use.

## Next gates

1. **Passed:** compile and run the local native relay-path diagnostic.
2. **Passed in desktop Chrome 154:** real browser fixture with shared PQ code
   compiled to WASM. Repeat locally in Safari to check that browser separately.
3. **Passed:** `browser-phone` on the trusted LAN without publishing anything.
   Next design a reviewed datagram adapter and a separately controlled relay test
   with phone cellular / publisher home Wi-Fi. Do not remove source restrictions
   wholesale for an Internet deployment.
4. Establish relay operator support and failure behavior before calling the design
   “no infrastructure we operate.”
5. Only then add localhost HTTP forwarding and Irys Service Worker deployment.

The user has installed a separate Rustup stable toolchain (`rustc 1.99.0`) with
`wasm32-unknown-unknown`, plus `wasm-pack 0.15.0`. Homebrew Rust remains separate.
All Cargo/wasm-pack builds are run in the user's normal terminal; no additional
agent sandbox permissions are required.

See `../../docs/research/browser-to-publisher-connectivity.md` for the source audit
and the distinction between implemented native relay forwarding and missing
turnkey browser-relay support.
