# Authorized localhost HTTP inspector (experimental)

Implemented and locally tested; **the full Irys → phone → PQ/WebRTC → MASQUE →
HTTP path still needs a real-phone acceptance run**. The earlier hosted encrypted
echo is proven, not this new application protocol. This is not transparent app
browsing, a general proxy, or production authorization.

## What is exposed

Only an explicitly selected `http://127.0.0.1:PORT`, only GET, only one visitor
connection per helper run. A fresh OS-random 256-bit bearer token is required
**inside the publisher-authenticated PQ session before any target connection**.
The public descriptor alone is not an access grant. Echo mode remains the default
and cannot access HTTP; HTTP mode uses a separate DataChannel label.

A token grants access to **all GET paths on that port**, not just the paths selected
in the UI. The helper enforces a maximum of 16 sequential requests, 1,024 ASCII
characters per path, 4,096 response-body bytes, and a 5-second total fetch deadline.
The existing 10-minute fixture lifetime applies, with a 30-second record wait.
Stopping the helper revokes access. Failure consumes this run's attempt: restart
before retrying. The fixed target app can itself have side effects or make outbound
requests; the helper cannot make that application safe.

Use a dedicated test app first. GET is a method restriction, **not** a guarantee
that an app cannot mutate state or reveal private information.

## Safe first test

Requires Node 24 and the existing native build prerequisites. From repository root:

```sh
# Terminal 1: fixed public test content, no directory or filesystem serving.
node apps/browser/fixtures/http-app.ts 3000
```

```sh
# Terminal 2: rebuild the changed native helper and frontend.
bash experiments/relay-spike/hosted.sh build

# Substitute current private addresses; both devices must use the same LAN.
bash experiments/relay-spike/hosted.sh http MAC_LAN_IP PHONE_LAN_IP 3000
```

The helper displays a **private visitor token once**, separately from the public
connection descriptor. This intentional terminal display is sensitive: don't log,
record, screenshot, or share the full terminal transcript. Transfer both values
using a trusted private method. Never put the token in a URL, repository, issue,
chat transcript, build configuration, or Irys upload. The helper retains only its
hash for authorization; the displayed token and decrypted request buffers are
explicitly zeroized after use. This is not a promise that all process copies,
OS/terminal/browser memory or clipboard history are securely erased.

For a hosted phone test, publish this version through the normal reviewed PR merge
path and open its **new** Irys URL. Existing immutable deployments do not update.
No additional funding is implied. Local preview can check UI/WASM startup on the
computer; the full inspector test here requires the separate phone. The guarded
local HTTP fixture remains echo-only.

On the phone:

1. Verify that PQ WASM loads and keep both devices on the same Wi-Fi.
2. Paste the public descriptor into its existing field.
3. In **Read-only HTTP inspector**, paste the separate private token.
4. Leave the two default paths: `/` and `/style.css`.
5. Tap **Authorize and fetch paths**, not the echo button.
6. Expect publisher authentication, visitor authorization, and two HTTP 200 results.
   The page body should contain “Hello through the encrypted tunnel”; the CSS should
   contain `font-family: system-ui`. HTML is displayed as source, not rendered.
7. Capture only non-sensitive diagnostic status/byte counts, then Ctrl-C the helper
   and capture its final bidirectional bridge counters. Don't copy private results
   or the token. The fixture app can also be stopped with Ctrl-C.

The token field is cleared when an attempt starts, and controls are locked for
that attempt. The app does not save the token, paths, or results in browser storage.
Closing/reloading the page drops the in-memory view. Browser extensions, password
managers, clipboard history and screenshots are outside that guarantee.

Optional separate fresh runs:

- `/redirect`: HTTP 302 must be shown without fetching its destination.
- `/large`: must fail rather than return a body larger than 4 KiB.
- An incorrect token: must fail before any target access; automated integration
  tests also observe that no TCP connection reaches the target in this case.

Do not point this at a sensitive admin/debug port or a normal application with
large scripts and expect a complete browsing experience.

## Protocol and security limits

- DataChannel label: `web-p2p-tunnel.http-inspector.v1`. Crypto, SDP synthesis and
  publisher authentication remain the existing pinned Saorsa implementation.
- Application records are UTF-8 JSON, sealed/opened by that PQ session. Existing
  limits stay at 8 KiB plaintext / 16 KiB incoming encrypted records.
- First request: `{ "v": 1, "type": "authorize", "token": "<private grant>" }`.
  Success: `{ "v": 1, "type": "authorized", "maxRequests": 16, "maxBodyBytes": 4096 }`.
- Then `{ "v": 1, "type": "get", "id": 1, "path": "/" }`, sequential IDs 1–16.
  Response contains `v`, `type: "response"`, matching `id`, HTTP `status`, bounded
  `contentType`, and a standard-base64 `body`. Binary bodies are preserved.
- Request fields are strict: no methods other than GET, headers, bodies, userinfo,
  absolute URLs, network-path URLs, fragments, raw whitespace/control characters,
  or backslashes. URL joining is rechecked against the fixed numeric loopback origin.
  Non-ASCII path text must be percent-encoded.
- Environment proxies are disabled; redirects and automatic decompression are
  disabled; compressed responses and protocol upgrades are refused. There is no
  cookie jar and no forwarding of browser credentials, caller headers, cookies,
  `Set-Cookie`, or `Location`. Only content type, status, and body are returned.
- Limits apply to both declared-length and streamed/chunked bodies. Total body
  allowance is at most 64 KiB per run. HTTP headers are parsed by reqwest/hyper's
  bounded parser; the 4 KiB limit describes **body bytes**, not all protocol traffic.
- Any authorization, validation or target error closes application access. A generic
  encrypted error is sent when possible, without reflecting tokens, target paths or
  response contents into diagnostics. Old clients cannot mistake echo for authorization.
- UI writes only `textContent`; no `innerHTML`, executable blobs, iframe, scripts,
  automatic asset fetching, or clickable target-provided links. Results are separate
  from diagnostic logs. Responses such as 404 are valid transport results, not proof
  that the requested application resource exists.
- One connection/attempt also means an unauthorized visitor can consume the run.
  This pilot has no multi-visitor admission, durable identities, revocation list,
  production denial-of-service defense, or assurance against malicious initial page
  delivery. The descriptor and page must still be obtained through trusted channels.

## Checks and implementation

```sh
cargo +stable test --locked --manifest-path experiments/relay-spike/Cargo.toml
npm --prefix apps/browser test
npm --prefix apps/browser run build:frontend
npm --prefix apps/browser run test:bundle
npm --prefix deployment/irys run typecheck
```

- `experiments/relay-spike/src/http_inspector.rs`: authorization/state/limits and
  fixed-target HTTP implementation; tests use actual loopback TCP fixture servers.
- `experiments/relay-spike/src/browser.rs`: encrypted record delivery and mode dispatch.
- `apps/browser/src/http-inspector.ts`: bounded browser request interface and inert
  result rendering, tested through the encrypted-exchange seam (transport stub only).
- `apps/browser/fixtures/http-app.ts`: tiny safe manual acceptance target.

Native tests cover auth rejection without TCP access, page/CSS fetches, header and
URL injection, redirect refusal, Content-Length/chunked overflow, deadlines, and
request-budget enforcement. Browser tests cover authorization order, response
validation, unsafe paths, byte preservation, limits and the text-only rendering
sink. Existing startup smoke tests execute real WASM but do not exercise a full
live HTTP-over-WebRTC session. CI requires both native checks and the frontend
build before publication; wallet secrets remain confined to the release step.
