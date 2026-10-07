# Browser-to-publisher connectivity with Autonomi / Saorsa

Research date: 2026-10-06.

## Decision summary

**The PQ-protected browser transport exists and can carry arbitrary tunnel messages. The current browser stack does not provide a turnkey route to an arbitrary publisher behind NAT.**

This is not just an omission in the examples. The current node ADR explicitly states:

> WebRTC Direct removes the signaling server only for publicly reachable listeners. It does not make a NATed server directly dialable from a static address, and this implementation has no WebRTC relay transport.

The source agrees: the browser dials a literal endpoint with an empty ICE-server list; the native listener binds a separate UDP socket and uses ICE-lite; unreachable browser endpoints fail rather than entering the native QUIC relay path. [1–4]

**Promising next experiment:** connect the publisher's WebRTC listener to a Saorsa MASQUE UDP allocation. The native relay exposes a public UDP address and forwards datagrams; its existing helper-facing connection can traverse the publisher's NAT. The pieces exist, but they are not wired together for WebRTC. This is an implementation hypothesis, not an existing supported feature or a proven mainnet deployment. [9–11]

## Scope and method

Question: Can a phone with an ordinary browser connect to a Rust helper on a home computer, using PQ-protected communication and no application-owned public server?

Inspected current primary sources in five `WithAutonomi` repositories: code, tests, manifests, and design documents. Repositories were cloned into `/tmp/web-p2p-connectivity-research/`, not vendored into this project. No background-agent tool was available, so research was performed directly.

No code was compiled, no test suite was executed, no phone was connected, and no public relay allocation or storage upload was requested. This establishes implementation shape and gaps, not real-world interoperability, security assurance, throughput, or public-infrastructure availability.

### Pinned revisions

| Repository | Inspected commit |
|---|---|
| `WithAutonomi/saorsa-transport` | `e2f08388088313c82cac393afa6ca27b9ce00516` |
| `WithAutonomi/saorsa-core` | `c7a95b38f697251e6aa9ee47b8b23cbaf13f8545` |
| `WithAutonomi/ant-node` | `dddb8b2b39fa3ad0f1f204aa8cf4b61c6082f147` |
| `WithAutonomi/ant-client` | `9858af5dbbb2caf090e20db67ac62aa4bd100c81` |
| `WithAutonomi/ant-browser-sdk` | `a29a87cf8d8f696ae5e8b22d6ee4f91d4e7bfbb0` |

The transport checkout declares version `0.37.0`, Rust `1.95.0`, and MIT/Apache-2.0 licensing. It exposes portable `webrtc` and native `webrtc-direct` features. This research did not establish that every needed revision is available in a compatible published crates.io release. Pin and build a coherent dependency set for the experiment. [12]

## Findings

### 1. Browser-to-native PQ sessions: implemented

The reusable implementation is **`saorsa_transport::webrtc`**, not the old media/calling-focused `saorsa-webrtc` repository. Its native listener is `webrtc::direct`; the shared PQ session code is portable to WASM. [2, 5, 12]

`PqClientHandshake::start()` generates ephemeral ML-KEM-768 key material. `finish()` checks the expected server peer ID, binds the supplied ML-DSA-65 public key to that identity using BLAKE3, verifies the signed handshake transcript, and decapsulates the session secret. The server uses `accept_pq_session()`. `PqSession::seal()` and `open()` encrypt arbitrary byte slices with ChaCha20-Poly1305, distinct directional keys, and enforced record sequences. [5]

Important distinctions:

- The raw WebRTC listener does **not** automatically enforce the PQ handshake. Our helper must do so before accepting tunnel operations.
- The handshake authenticates the **server** to the browser. It does not itself authorize that browser to access the local web application. We still need invitation/access-grant validation inside the authenticated encrypted session.
- The expected publisher identity must come from a trusted invitation or equivalent trust anchor. Discovering an address is not authorization.
- No claim is made here that this custom protocol has been independently audited. Existing unit tests cover round trips, tampering, replay, unexpected server identity, and signature tampering; those tests were inspected, not run. [5]

### 2. Arbitrary tunnel bytes: supported by the library, not by storage nodes

`WebRtcDirectListener::accept()` yields a connection; `accept_data_channel()` yields a reliable ordered binary channel with `send()` and `receive()`. That interface is not limited to storage data. Individual DataChannel messages are capped at 16 KiB, so a tunnel needs bounded framing/fragmentation and backpressure rather than assuming arbitrary-size writes. [2]

The PQ session also accepts arbitrary bytes rather than requiring storage records. A custom helper can reuse these building blocks with its own tunnel protocol and label. It does not need to run a full storage node merely to terminate a browser channel. Browser-side binding/glue is still required; the high-level storage SDK is not already a generic TCP tunnel. [2, 5]

In contrast, the deployed node browser request dispatcher accepts only a defined set of storage/discovery operations: `hello`, `find_node`, `get_chunk`, `quote_chunk`, `put_chunk`, and `chunk_protocol`. The latter is further limited to supported storage/pointer requests. There is no generic `connect arbitrary peer`, live topic forwarding, TCP proxy, or browser tunnel-relay operation in that dispatcher. [6]

**Consequence:** being able to read a file from an Autonomi node does not imply that node will forward a live connection to our publisher.

### 3. Direct connectivity: implemented, conditional on publisher reachability

The browser connection code:

1. Creates `RTCPeerConnection` with an empty ICE-server list.
2. Opens an ordered DataChannel.
3. Creates the local offer and extracts browser-generated ICE credentials.
4. Locally constructs the remote description from the endpoint's IP, UDP port, and certificate pin.
5. Waits for the channel, then establishes the PQ session. [3]

The native listener binds its own `tokio::net::UdpSocket` and sets ICE-lite. It receives the browser's first STUN packets on that socket. No per-session signaling exchange with a hosted server is needed for that direct public listener. STUN packets in the protocol are distinct from depending on a separate public STUN service. [2]

The **visitor** can be behind NAT: it initiates traffic toward the public listener. The critical requirement is a reachable publisher UDP endpoint. This does not guarantee success on every carrier or firewall.

| Publisher/network situation | Expected outcome from current design |
|---|---|
| Public IPv4 + allowed inbound UDP | Suitable for direct WebRTC; test browser compatibility |
| Globally routed IPv6 + compatible visitor path + firewall rule | Suitable in principle; test actual paths |
| Home router with deliberate UDP port forwarding | Suitable in principle; advertise external IP and mapped WebRTC port |
| Compatible router with successful UPnP mapping | Possible helper feature, not established as automatic for this listener |
| Both ends on the same reachable LAN | Useful baseline; not evidence of Internet NAT traversal |
| Publisher behind CGNAT without reachable mapping/IPv6 | No turnkey solution in the current browser path |
| Visitor network blocks required UDP | No verified fallback in the current browser path |

Node configuration permits an explicit advertised external address. Its docs instruct operators to permit inbound UDP and keep identity/certificate/address configuration stable. Native address discovery does not prove reachability of the separate browser UDP port. [7]

### 4. Native NAT traversal does not automatically apply to WebRTC

Saorsa has native QUIC hole punching and MASQUE relay paths. But the browser listener is separate from that endpoint. [2, 9–11]

`saorsa-core` deliberately normalizes WebRTC address reachability to `Unverified`, even if its native QUIC address is relayed or directly reachable. Its source explicitly says WebRTC has no relay transport today. [4]

The node ADR repeats that a failed WebRTC dial is suppressed by a negative-endpoint cache rather than relayed. Its operational testnet guide notes that nodes behind deliberate inbound-NAT rules remain unreachable over the current browser path. [1, 7]

Some earlier paragraphs in the ADR describe desired future NAT/relay behavior and acceptance criteria. They must not override the explicit current-implementation limitation or the code. The ADR's status is still `Proposed` despite substantial merged implementation.

### 5. Discovery exists, but not as a ready-made tunnel rendezvous system

The browser can obtain authenticated node endpoint records through `find_node` and perform iterative lookup. This is implemented for the storage network's node/address plane. [1, 6]

It does not establish that an arbitrary lightweight helper can register a live tunnel session or use existing nodes as signaling brokers. The ADR explicitly excludes arbitrary topic forwarding from browser sessions. [1]

For the first experiment, use an invitation containing the literal endpoint, certificate pin, and expected publisher identity. This removes DHT integration from the experiment without confusing identity with routing information. A dynamic address or relay allocation change needs a refreshed invitation or a separately designed authenticated discovery mechanism.

Autonomi's mutable pointers could potentially distribute versioned connection metadata, but storage-backed rendezvous would be a new design with update/payment/latency considerations—not an existing low-latency signaling mechanism verified here.

### 6. MASQUE reuse: plausible experimental route, not turnkey support

The native implementation provides a useful potential seam:

- `NatTraversalEndpoint::establish_relay_session()` returns an allocated public address and `RawRelayStreams` for a new allocation. [9]
- The relay forwarding loop reads datagrams from its allocated UDP socket and forwards their payload plus source address over the native QUIC stream. The examined receive loop does not require the payload to be a QUIC packet. [10]
- The existing `MasqueRelaySocket` is integrated as a Quinn `AsyncUdpSocket`. Its constructor is crate-private; the WebRTC listener instead internally binds a concrete Tokio UDP socket. There is no ready-made WebRTC adapter between them. [2, 11]

Hypothesized path:

```text
Phone browser
    | ordinary WebRTC packets addressed to a public UDP allocation
    v
Saorsa-compatible MASQUE relay
    | encapsulated UDP over the helper's outbound native QUIC connection
    v
Helper-side datagram adapter
    | WebRTC terminates here, with publisher-owned certificate and PQ session
    v
Local tunnel helper -> local web application
```

This would make the browser's target publicly reachable without installing anything on the phone or configuring inbound forwarding at the publisher. The browser would not need to speak native QUIC. It is a **relayed**, not direct, phone-to-publisher path.

What remains to build/verify:

- A datagram adapter for the listener that preserves source/destination addresses, association routing, and return-path admission checks.
- A bounded, cancellable implementation of relay framing, keepalive/control handling, shutdown, reconnection, and allocation lifetime.
- Correct advertised allocation address with the **publisher's** certificate/identity, not the relay's identity as the application endpoint.
- No incorrect reuse of the native QUIC relay address as if it already routes to the separate WebRTC socket.
- Correct handling of multiple visitors and source rebinding.
- Actual STUN/DTLS/SCTP success over this carrier and acceptable performance under loss/flow control.
- Relay operator acceptance, resource limits, availability, and supported usage. Native relay availability is not an entitlement to arbitrary public-network bandwidth.

Test with a controlled relay first. The source makes this worth exploring; it does **not** establish that no relay-side changes will be needed or that public Autonomi nodes permit this use.

### 7. Mobile compatibility: not yet demonstrated by the reviewed tests

The inspected real-browser test configuration uses headless **Chromium**, a local devnet, and a WebRTC field-trial launch argument. The node guide explicitly warns that its historical public smoke run is not cross-browser acceptance evidence. [7, 8]

Therefore iOS Safari and Android Chrome require actual device testing, including foreground/background transitions, Wi-Fi/cellular changes, and reconnect behavior. A working desktop Chromium storage demo is not sufficient evidence.

Separately, retaining the Service Worker HTTP-emulation design retains its web-application compatibility limits. Solving the transport does not enable transparent WebSockets or remove browser cookie/origin restrictions.

## Infrastructure choices

| Choice | Infrastructure implications | Current status |
|---|---|---|
| Direct-only helper with reachable UDP | Irys frontend; publisher IPv6/firewall configuration or port mapping; no separate relay/signaling host for the basic tunnel | Uses implemented library transport, still needs our helper/browser integration |
| Reuse MASQUE allocations for WebRTC | Irys frontend plus public relay capacity, potentially existing consenting network peers | Additional transport integration and validation required |
| Conventional full-ICE WebRTC + STUN/TURN | Managed or self-hosted signaling/STUN/TURN; PQ session can remain end-to-end | Established general approach, but not a config switch on this ICE-lite listener |
| Custom public rendezvous/byte-forwarding module | At least one publicly reachable deployment; helper connects outbound; preserve inner browser-to-publisher PQ session | New implementation; easier to control operationally but adds hosted infrastructure |

Irys addresses static frontend delivery only. It does not close the publisher connectivity gap.

## Recommended next step

Keep the proposed product direction: phone browser, Irys entry point, Rust publisher helper, Saorsa PQ transport. Do not begin the HTTP rewrite yet.

Build a **connectivity-only experiment** in two gates:

### Gate A — direct encrypted echo

- Native helper: persistent identity/certificate, `WebRtcDirectListener`, enforced `accept_pq_session`, a single bounded echo operation.
- Browser: ordinary `RTCPeerConnection`, shared WASM PQ primitives, pinned publisher identity, a tiny test page.
- Use a supplied endpoint/invitation; do not require the Autonomi storage SDK or DHT for the tunnel itself.
- Reject wrong identity, unencrypted requests, and replayed records before any local-resource access.
- Establish a reachable-endpoint baseline on real phone browsers.

### Gate B — WebRTC through a MASQUE allocation

- Use an explicitly controlled relay and publisher with outbound-only connectivity.
- Add the helper-side datagram adapter; keep the PQ endpoint at the helper.
- Test on different networks (phone cellular, computer home Wi-Fi) and verify relay use with actual counters, not a guessed “direct” status.
- Exercise loss, shutdown, allocation replacement, and multiple visitors.
- Record blocked-UDP failure explicitly; do not advertise a fallback that has not been implemented.

If Gate B succeeds, establish whether existing relay operators support this traffic before claiming production operation without our own server. If it fails or public relay use is unavailable, choose between a reachable-publisher requirement and managed relay infrastructure.

Only then add Irys Service Worker deployment, authorization, HTTP framing, streaming, and application compatibility work. A production invitation/authorization design is still required even if the echo experiment proves connectivity.

## Primary sources (pinned)

[1] ant-node browser ADR, current NAT limitation and lookup behavior: https://github.com/WithAutonomi/ant-node/blob/dddb8b2b39fa3ad0f1f204aa8cf4b61c6082f147/docs/adr/ADR-0015-direct-browser-clients-over-webrtc-direct.md#nat-and-relays

[2] Saorsa native WebRTC listener, binary channel interface, 16 KiB message limit, ICE-lite setup: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/webrtc/direct.rs#L224-L337 ; https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/webrtc/direct.rs#L620-L742

[3] Browser dialer: empty ICE-server configuration, synthesized answer, PQ establishment: https://github.com/WithAutonomi/ant-client/blob/9858af5dbbb2caf090e20db67ac62aa4bd100c81/ant-core/src/browser/wasm_transport.rs#L769-L929

[4] WebRTC reachability intentionally distinct from native QUIC reachability: https://github.com/WithAutonomi/saorsa-core/blob/c7a95b38f697251e6aa9ee47b8b23cbaf13f8545/src/transport_address.rs#L133-L159

[5] Shared PQ handshake, record layer, and security-property tests: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/webrtc/session.rs

[6] Node browser request dispatcher and discovery handler: https://github.com/WithAutonomi/ant-node/blob/dddb8b2b39fa3ad0f1f204aa8cf4b61c6082f147/src/web_rtc.rs#L1649-L1865

[7] Node deployment, inbound UDP requirements, NAT limitations, test/release caveats: https://github.com/WithAutonomi/ant-node/blob/dddb8b2b39fa3ad0f1f204aa8cf4b61c6082f147/docs/WEBRTC_DIRECT_TESTNET.md#public-internet-smoke-testing

[8] Real-browser test configuration: https://github.com/WithAutonomi/ant-client/blob/9858af5dbbb2caf090e20db67ac62aa4bd100c81/ant-core/browser-tests/playwright.config.js ; SDK experimental warning: https://github.com/WithAutonomi/ant-browser-sdk/blob/a29a87cf8d8f696ae5e8b22d6ee4f91d4e7bfbb0/README.md

[9] Native relay allocation and raw streams: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/nat_traversal_api.rs#L4732-L4920

[10] Relay UDP forwarding: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/masque/relay_server.rs#L1420-L1558

[11] Existing Quinn relay socket implementation: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/src/masque/relay_socket.rs

[12] Transport features, version, license, and Rust requirement: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/Cargo.toml ; browser transport architecture and future-relay limitation: https://github.com/WithAutonomi/saorsa-transport/blob/e2f08388088313c82cac393afa6ca27b9ce00516/docs/adr/ADR-015-direct-browser-webrtc.md
