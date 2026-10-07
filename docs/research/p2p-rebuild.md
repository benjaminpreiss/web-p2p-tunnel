# P2P tunnel rebuild: initial source check

Preliminary design research, not a dependency audit or tested interoperability result. Sources below were fetched from the default branches; pin and validate versions before implementation.

Follow-up research:

- [Irys browser entry point](irys-browser-entrypoint.md): HTML hosting and isolated origins verified; controlled Service Worker/browser acceptance test remains pending.
- [Browser-to-publisher connectivity](browser-to-publisher-connectivity.md): current PQ channel implementation verified in source, but no turnkey WebRTC NAT/relay path. Native MASQUE reuse is a promising untested integration, not an existing browser feature.

## Correction: current WithAutonomi browser stack

The initial search below missed the newer WithAutonomi repositories. Its browser-support uncertainty is superseded by these findings:

- [ant-browser-sdk](https://github.com/WithAutonomi/ant-browser-sdk) documents direct certificate-pinned WebRTC connections to nodes, a Rust/WASM client, authenticated discovery, and seven bundled mainnet WebRTC seeds. It explicitly labels the SDK/protocol experimental and requires matching versions.
- Its [mainnet seed validation report](https://github.com/WithAutonomi/ant-browser-sdk/blob/main/docs/audits/2026-09-25-mainnet-webrtc-seeds.md) records Chromium authentication of 7/7 seeds and a partial live download. This is upstream test evidence, not an independently repeated connectivity test or evidence of mobile compatibility.
- [ant-node](https://github.com/WithAutonomi/ant-node/blob/main/src/web_rtc.rs) contains the browser listener and request dispatcher (`src/browser.rs` holds shared discovery types). Its [browser ADR](https://github.com/WithAutonomi/ant-node/blob/main/docs/adr/ADR-0015-direct-browser-clients-over-webrtc-direct.md) describes a default browser listener and mandatory authenticated application-layer PQ sessions. The ADR status still says Proposed; distinguish implementation from release guarantees.
- [saorsa-transport's browser ADR](https://github.com/WithAutonomi/saorsa-transport/blob/main/docs/adr/ADR-015-direct-browser-webrtc.md) identifies the reusable transport and portable PQ layer. It uses ML-KEM-768, ML-DSA-65 transcript authentication, and ChaCha20-Poly1305 records. Raw channels alone do not enforce this handshake.
- Direct connections to public listeners need no separate signaling server, DNS, public CA, or TURN. This does not establish equivalent reachability to arbitrary NATed publisher computers or arbitrary relay rights on storage nodes.
- Browser-direct storage access removes the need for a file-data gateway. The initial browser page/SDK still needs a loadable entry point; a normal no-install link can use a small HTTPS shell and retrieve further assets from Autonomi. Service Worker origin/scope and application delivery integrity remain design concerns.

## Existing design

- `README.md` describes a hosted browser frontend, hosted WebSocket signaling server, and local Go reverse proxy. The frontend uses a Service Worker and WebRTC data channels.
- `web/src/webrtc.ts` configures Google's public STUN server.
- `README.md` documents cookie, WebSocket, and Service Worker limitations.

## Saorsa findings

- [ant-quic](https://github.com/saorsa-labs/ant-quic/blob/master/README.md) documents native Rust QUIC, ML-KEM-768 key exchange and ML-DSA-65 authentication, peer-assisted NAT traversal, and MASQUE relay fallback. These are upstream claims, not independently verified security or reliability results.
- That README lists default known peers at IP literals and describes cached peers. A custom domain is not a protocol requirement. Reachable peers and relay capacity remain infrastructure dependencies; public availability and permission to depend on them need verification.
- [saorsa-webrtc](https://github.com/saorsa-labs/saorsa-webrtc/blob/main/README.md) describes a QUIC-native media/data transport, not simply the browser's standard WebRTC wire protocol.
- Its [migration guide](https://github.com/saorsa-labs/saorsa-webrtc/blob/main/docs/MIGRATION_GUIDE.md) explicitly replaces SDP/ICE with capability exchange and ant-quic connections.
- Its [core Cargo manifest](https://github.com/saorsa-labs/saorsa-webrtc/blob/main/saorsa-webrtc-core/Cargo.toml) defaults to `quic-native`, with an optional `legacy-webrtc` dependency on webrtc-rs. Comments and README feature tables are inconsistent; legacy browser interoperability must be tested, not assumed.
- ant-quic documents MIT/Apache-2.0 licensing; saorsa-webrtc documents AGPL-3.0 licensing.

## Design implications (inferences)

- Native ant-quic is not directly usable by ordinary browser JavaScript: browsers do not expose arbitrary UDP/custom QUIC. WASM does not remove that restriction, and browser WebTransport is not a generic custom-QUIC socket.
- Native helpers at both ends could forward local TCP streams over ant-quic, avoiding Service Worker emulation and a public website/domain. Bootstrap/coordination and relay dependencies still exist for broad Internet connectivity.
- A no-install browser client needs a browser-compatible transport. Legacy WebRTC requires separate validation and does not automatically inherit the PQ properties of ant-quic. Authenticated application-layer PQ encryption would be necessary if the carrier lacks those properties.
- A hosted gateway provides browser compatibility but terminates confidentiality unless encryption extends from browser to publisher. Hosted frontend delivery is also a code-integrity trust dependency.
- Reusing Saorsa libraries does not itself establish interoperability with the deployed Autonomi network or entitlement to use its nodes as discovery/relay infrastructure.

## Open decisions

1. Must visitors use an unmodified browser with no helper installation?
2. Is avoiding owned infrastructure enough, or must external infrastructure dependencies also be avoided?
3. Is the scope one HTTP application, or arbitrary TCP, WebSockets, and development servers?
4. Is the goal Saorsa's transport technology or participation in the deployed Autonomi network?

Next validation: pin dependency versions; test identity authentication, direct and relayed connections, blocked-UDP behavior, and (if required) a browser-to-native encrypted data channel. No implementation changes yet.
