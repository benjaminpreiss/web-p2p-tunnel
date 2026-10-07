# How try.autonomi.com connects

Inspected live public assets on 2026-10-06. No browser file-download session,
storage request, relay allocation, or account operation was initiated. This is
live deployment/source inspection, not an independent runtime connectivity test.
Research was performed directly; no background-agent tool is available.

## Findings

The deployed site uses **WebRTC Direct to publicly addressed Autonomi storage
nodes**, with the shared Saorsa PQ session. It does not demonstrate a generic
relay path to an arbitrary home computer.

1. The [live HTML][site] loads `app.js` and preloads `pkg/ant_core.js`.
2. The [live application][app] loads `pkg/ant_core_bg.wasm`. It first checks
   `network.json` for an explicit override; absent that file, it can use the
   bundled client's mainnet defaults.
3. The [live network configuration][network] returned HTTP 200 and contains seven
   public IPv4 `/udp/10001/webrtc-direct/certhash/.../p2p/...` seed addresses:
   `207.148.94.42`, `45.77.50.10`, `66.135.23.83`, `149.248.9.2`,
   `167.235.239.18`, `87.99.148.210`, and `18.228.202.183`. These addresses are
   published storage bootstrap endpoints, not advertised third-party tunnel
   relay allocations. We did not connect to them.
4. The application constructs `BrowserNetworkClient(state.network.seeds)`, calls
   `openPublicFile(address, onProgress)`, and reads ranges through that client.
   The page's HTTP server supplies assets/configuration, not a generic localhost
   tunnel. File lookups discover additional network nodes.
5. The downloaded live WASM SHA-256 is
   `ab58bd3e331436d22acfe3d08b384992be9addec52145fa0325468c27b6da70a`.
   It exactly matches the local ant-browser-sdk packaged WASM and the artifact
   recorded in the SDK's [WebKit audit][audit]. That audit identifies ant-client
   revision `9858af5dbbb2caf090e20db67ac62aa4bd100c81` as its production source.
6. At that revision, [wasm_transport.rs][transport] constructs
   `RTCPeerConnection` with an empty `iceServers` array. It synthesizes an
   ICE-lite answer using the endpoint certificate pin and browser-generated
   credentials, then establishes the shared authenticated PQ session. This
   configured path does not use Google's public STUN service or a TURN server.

## Why this works without our proposed relay

The browser initiates traffic to a publicly reachable node listener. The browser
can be behind NAT; that is different from requiring the listener itself to be
reachable behind an unrelated home NAT. Public nodes already provide the exposed
UDP endpoint which our publisher computer generally lacks.

The site's public browser endpoints are also distinct from the old Saorsa
bootstrap DNS names found unresolved in the previous availability check. The
NXDOMAIN observation does **not** imply that try.autonomi.com or the Autonomi
network is unavailable; the site uses its own published literal-IP seeds.

Storage APIs let the browser retrieve data already stored in the network. They
do not, by themselves, provide a live reverse tunnel into arbitrary localhost
applications. Reusing the same WebRTC/PQ code is appropriate (our experiment does
this); obtaining a reachable endpoint for a private publisher remains a separate
problem. Whether these operators would provide compatible native MASQUE capacity
for that independent tunnel is still unverified.

## Evidence boundary

The hash match ties the live deployed binary to the documented source artifact.
It does not prove present reachability of every seed, successful phone downloads,
or public relay permission. The upstream audit reports actual mainnet browser
tests, but those are upstream's measurements rather than a new test by this agent.

[site]: https://try.autonomi.com/
[app]: https://try.autonomi.com/app.js
[network]: https://try.autonomi.com/network.json
[audit]: https://github.com/WithAutonomi/ant-browser-sdk/blob/a29a87cf8d8f696ae5e8b22d6ee4f91d4e7bfbb0/docs/audits/2026-10-05-webkit-connection-fixes.md
[transport]: https://github.com/WithAutonomi/ant-client/blob/9858af5dbbb2caf090e20db67ac62aa4bd100c81/ant-core/src/browser/wasm_transport.rs
