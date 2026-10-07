# Vision: Irys-hosted browser access to a private web application

## Current product direction

- A mobile browser opens a website hosted on Irys (`irys.xyz`); no installed
  mobile app or browser extension is required by this direction.
- A helper runs from a terminal on the computer and exposes one explicitly
  configured local web application to authorized browser clients.
- Keep the **pinned Saorsa MASQUE relay approach**, not a TURN migration.
  Browser transport remains WebRTC with the shared application-level PQ session;
  the existing diagnostic bridges that traffic through the MASQUE relay path.
- Aim for direct connections when feasible, with a controlled relay as fallback.
  Direct-first path selection is not yet implemented or proven. All tunneled
  data uses relay bandwidth when the relayed path is selected; public frontend
  assets should load directly from Irys, outside the tunnel.
- Production authorization, HTTP/WebSocket behavior, Irys deployment, mobile
  browser compatibility and real-network traversal remain unvalidated. Preserve
  pinned identities and end-to-end PQ protection; do not expose arbitrary targets.
- Device restrictions still apply to the browser. A website cannot bypass a
  policy that prevents the browser itself from networking.

The Android app, privileged-system integration and SSH tunneling are cancelled.
The Android app/native/smoke experiment directories were removed at the user's
request; references to their source and commands below are historical only.
The remaining sections below are historical context, **not an active backlog**.
See [STATUS.md](STATUS.md) for verified results and deployment boundaries.

The observed mobile blocker was this test phone's enabled Restricted networking
mode, not proof that mobile networking is generally unsupported.

## Historical product direction

Make selected services on one computer accessible from another authorized device
through an end-to-end PQ-protected tunnel. Attempt direct P2P connectivity first;
use a controlled relay when direct connectivity is unavailable.

**The connecting device does not have to be a phone.** Android/browser access is
the first development path, not a limitation of the product. Computer-to-computer
and terminal-only access are also intended use cases.

This is a product vision, not a claim of implemented or validated support. See
[STATUS.md](STATUS.md) for actual results and the next experiment.

## Intended use cases

### Local web applications

Expose one explicitly configured HTTP application through the computer helper.
An Android app can provide a loopback URL that an ordinary browser opens. A
computer-side client should also be able to provide local access without needing
a phone. HTTP/WebSocket behavior and browser security assumptions need explicit
handling; a working byte stream alone does not establish browser compatibility.

### SSH from another computer or terminal

Allow an authorized client on another computer to reach a configured SSH server
through the tunnel, using its normal SSH client. No mobile app is required on
that end.

A desired initial interaction is:

1. The helper makes an explicitly configured SSH target available to authorized
   tunnel clients.
2. A terminal client establishes the authenticated tunnel and exposes a local,
   loopback-only TCP port.
3. Another terminal connects its ordinary SSH client to that local port.
4. The SSH session travels through the tunnel to the configured SSH server.

```text
Terminal A: tunnel client owns the connection and local listener
Terminal B: ordinary SSH client → 127.0.0.1:<local-port>
                               → PQ-protected P2P tunnel (direct or relayed)
                               → computer helper → configured SSH server
```

For example, if a future tunnel client exposes SSH on local port 2222, the
separate terminal could use:

```sh
ssh -p 2222 user@127.0.0.1
```

That is an illustrative SSH invocation, not an existing tunnel command or a
currently available listener. The tunnel CLI syntax remains to be designed.

The tunnel client must not consume the terminal as an interactive SSH client
itself: users can keep it running in one terminal and use SSH from another.
Support multiple independent SSH connections/terminal sessions to an authorized
target, with explicit limits and predictable lifetimes. Whether the connection
owner is a foreground CLI process or an optional background process remains an
interface decision.

A future SSH `ProxyCommand` integration could avoid the local TCP listener and
connect standard input/output directly to a tunnel stream. This is an option to
evaluate, not the required first interface.

## Transport and security implications

- Share the native networking core across Android and terminal clients rather
  than tying tunnel ownership to an Android Activity, WebView, or browser.
- Support bounded, bidirectional TCP byte streams for SSH, alongside the web
  access use case. Preserve streaming, backpressure, half-close/EOF, cancellation,
  and isolation between simultaneous connections. SSH is the first additional
  protocol requirement, not permission to expose arbitrary services.
- Bind access grants to an authenticated client and an explicit configured
  target. Authenticate the service side too. Do not become an unrestricted
  forwarding proxy or let remote clients select arbitrary destinations.
- Loopback-only client listeners reduce exposure but are **not** local client
  authorization: other local processes may reach them. Design that threat model
  explicitly, including browser-origin protections for HTTP access.
- Carry SSH transparently; do not terminate SSH at the relay. The tunnel's PQ
  protection is additional to SSH's own security, not a replacement for it.
- Preserve SSH user authentication and host-key verification. Define stable host
  identity handling for local forwarded ports (for example, SSH host aliases)
  without recommending that users disable host-key checks.
- Tunnel credentials must not require giving SSH passwords or private keys to
  the relay. Relay operators must not need access to application plaintext.
- Report connection loss honestly. A failed SSH transport does not automatically
  resume an interactive session just because the tunnel can reconnect. Any
  recovery or resumption guarantees need separate design and tests.
- Direct/relay selection, resource limits, pairing, revocation, key storage,
  deployment hardening, and supported desktop platforms remain to be validated.

## Sequencing

Keep the current Android foreground-service/JNI lifecycle diagnostic as the
immediate milestone. Record this expanded vision now; do not treat it as an
instruction to expose SSH, change an SSH daemon, deploy the VPS, or broaden the
current diagnostic's access.

A later SSH milestone should demonstrate two computers, a pinned/authenticated
and authorized tunnel, one configured SSH target, and a successful ordinary SSH
session launched from a separate terminal. Test wrong/unauthorized identities,
multiple sessions, connection loss, and cleanup before claiming SSH support.
