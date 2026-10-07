# Hosted relay availability

Checked 2026-10-06 using official documentation, current upstream source, and DNS
lookups. No public relay allocation, QUIC session, TURN credential creation,
account change, or tunnel traffic was attempted. There is no background-agent
tool in this session; research was performed directly.

## Conclusion

No **verified, operator-approved drop-in public Saorsa MASQUE relay** was found.
This is not evidence that none exist. Published bootstrap nodes and implemented
relay capability are not equivalent to an offered general-purpose relay service.

Cloudflare **does** publish a managed TURN service with a substantial free usage
allowance. It is a credible hosted alternative, but requires transport integration
changes; it cannot replace the Saorsa relay just by changing an address. The
current ICE-lite helper does not become reachable behind NAT merely by adding a
TURN server to the browser's `iceServers` list.

## Saorsa / Autonomi findings

### Documented Saorsa bootstrap hostnames currently do not resolve

The current [transport README][readme] lists:

- `saorsa-1.saorsalabs.com:9000`
- `saorsa-2.saorsalabs.com:9000`

Both local hostname resolution and Google Public DNS over HTTPS failed to resolve
these names. The DoH responses had `Status: 3` (NXDOMAIN), with the domain's SOA in
the authority section. These are observations at the check time, not permanent
claims about operator availability. DNS-only queries made no contact with a relay.

Recheck queries:

- https://dns.google/resolve?name=saorsa-1.saorsalabs.com&type=A
- https://dns.google/resolve?name=saorsa-2.saorsalabs.com&type=A

The README calls them bootstrap nodes, not a contracted/open MASQUE relay service.

### Autonomi publishes other bootstrap nodes, but relay access is unverified

The current [ant-node bootstrap configuration][bootstrap] publishes seven literal
IP endpoints on port 10000. The [transport implementation][native] defaults
`enable_relay_service` to true and limits relay clients per public peer to four
(`MAX_RELAY_CLIENTS_PER_PUBLIC_PEER`). Thus relay capability genuinely exists; it
would be inaccurate to say Autonomi has no relays.

However, source defaults do not verify the deployed configuration or version,
current free capacity, reachability of allocated UDP ports, or operator permission
for this independent WebRTC tunnel. No documented general-purpose third-party
relay offering or compatibility commitment was found in the inspected README,
bootstrap configuration, browser testnet guide, or transport issue search.

The current [browser testnet guide][browser] still distinguishes historical public
browser-to-node connectivity from relayed WebRTC, and notes that testnet nodes
behind deliberate inbound-NAT rules remain unreachable without the latter.

A maintainer/operator would need to confirm an endpoint, compatible revision,
permission for this traffic, and limits before we could recommend depending on it.
We did not probe the seven nodes or consume their allocations.

## Cloudflare Realtime TURN: documented hosted alternative

[TURN documentation][turn] publishes `turn.cloudflare.com`, with UDP, TCP and TLS
access (including alternate ports). This is a real relay service, unlike public
STUN address-discovery services.

The dedicated [pricing page][pricing] states:

- First **1,000 GB/month** free, shared between Realtime SFU and TURN.
- **$0.05/GB egress** beyond that allowance.
- Related Workers and other products have separate pricing.

The overview states the egress rate without spelling out the allowance; use the
more specific pricing page for that detail and check account terms before use.
We have not enabled service/billing or established that this user's account is
eligible without additional setup.

[Credentials documentation][credentials] requires a TURN key and expiring client
credentials. The long-term TURN key must not be embedded in the hosted page. A
controlled test could generate short-lived credentials out of band; a production
application needs an appropriately protected credential-issuance mechanism.

### Compatibility work (engineering assessment, not a hosted-service promise)

Our experiment uses Saorsa-specific MASQUE forwarding and a synthesized ICE-lite
answer. Cloudflare TURN is not that protocol. Adoption needs a helper-side TURN/
ICE integration and the appropriate signaling/permission handling, or another
reviewed adapter. Browser-only TURN configuration cannot publish the current
private helper listener. Keep Saorsa's application-level PQ session across any
replacement carrier and repeat browser/NAT tests; do not infer PQ guarantees from
Cloudflare's service name or from ordinary WebRTC TLS/DTLS alone.

Cloudflare Pages can host the static frontend with either relay choice.

## Decision boundary

- **Least change to the proven transport:** temporary Saorsa relay on the user's
  VPS, with inventory, bounded access and explicit cleanup.
- **Avoid operating a relay:** investigate Cloudflare TURN integration next;
  expect new implementation and validation work, not a configuration-only swap.
- **Use existing Autonomi infrastructure:** obtain operator confirmation before
  allocating capacity or treating bootstrap nodes as public tunnel relays.

[readme]: https://github.com/WithAutonomi/saorsa-transport#default-bootstrap-nodes
[bootstrap]: https://github.com/WithAutonomi/ant-node/blob/main/config/bootstrap_peers.toml
[native]: https://github.com/WithAutonomi/saorsa-transport/blob/main/src/nat_traversal_api.rs
[browser]: https://github.com/WithAutonomi/ant-node/blob/main/docs/WEBRTC_DIRECT_TESTNET.md
[turn]: https://developers.cloudflare.com/realtime/turn/
[pricing]: https://developers.cloudflare.com/realtime/sfu/platform/pricing/
[credentials]: https://developers.cloudflare.com/realtime/turn/generate-credentials/
