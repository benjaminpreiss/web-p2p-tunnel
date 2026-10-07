# skaists.dev bview: what its relay does

Inspected 2026-10-06. Downloaded the public page, its WebRTC instrumentation
script, and relevant operator repository notes. Did not play or fetch the linked
video, call its gateway data endpoints, allocate relay capacity, or change any
account. Research was performed directly; no background-agent tool is available.

User-supplied page:
https://skaists.dev/surfaces/bview.html#autonomi://7c4f61ed1c7b950a3043b8a2d1aa9974a24ac6ca274c330e4da1b3a6a61bbb78

## Live page source

The [served HTML][page] contains its application JavaScript. It defines:

```js
const DOOR = 'https://relay.skaists.dev/ant/v1/data/public/';
const SDK_ROOT = '/vendor/ant-browser-sdk/0.1.1/';
```

It exposes three explicit routes:

- **Relay only:** the initial selection for a fresh visit.
- **Direct Autonomi only:** no relay fallback.
- **Direct Autonomi + relay fallback.**

A saved route preference can override the initial selection; a local cached
video can also avoid both network paths entirely.

### Relay path

`tryStream(address, ...)` fetches `DOOR + address + '/stream'` using ordinary
HTTPS `fetch()`, reading video bytes progressively from the response body. If
that path fails, `progressive(address, ...)` fetches `DOOR + address`, decodes a
base64 JSON data envelope, and feeds the same player.

The address parser accepts a 64-hex-character Autonomi storage address, optionally
prefixed with `autonomi://`. It does not accept a localhost URL, socket target,
reverse-tunnel registration, or a WebRTC relay allocation request.

The source identifies the path as `relay.skaists.dev/ant/v1 -> antd`. The operator's
[read-gateway restoration report][restore] describes Caddy proxying this prefix to
a server-side `antd` daemon and documents historical successful public reads.
This supports the **HTTPS-to-Autonomi storage gateway** interpretation. It is not
an independent measurement of present gateway uptime or that particular video's
availability.

### Direct path

The page imports its self-hosted Autonomi browser SDK, calls
`AutonomiClient.connect(...)`, opens the stored file with `client.openFile(...)`,
and reads chunks into the progressive player over WebRTC. In fallback mode, a
failed/stalled direct attempt switches to the HTTP gateway; in direct-only mode
it records failure without contacting the gateway.

`ant-transport.js` wraps `RTCPeerConnection` to count dials and observed channel
traffic; it is instrumentation, not a TURN or MASQUE relay implementation.

## Relevance to our tunnel

This is a genuine hosted gateway and a useful example of distinguishing direct
and gateway-assisted delivery. It should not be dismissed as "no relay."

But its observed API serves files already stored in Autonomi. It does not publish
our private helper's UDP listener or expose a general-purpose reverse tunnel.
The hostname containing `relay` does not imply TURN/MASQUE compatibility.

In relay mode the gateway returns reconstructed video bytes over HTTPS. That is
not the browser-to-publisher PQ session in our experiment. An analogous custom
opaque-message relay could preserve our PQ session, but would still require an
appropriate deployed service and authorization; bview does not provide evidence
that this operator offers that interface for third-party tunnels.

[page]: https://skaists.dev/surfaces/bview.html
[source]: https://github.com/beehive-nature/beehive-nature/blob/main/surfaces/bview.html
[restore]: https://github.com/beehive-nature/beehive-nature/blob/main/docs/dispatches/2026-09-21-zcode-antd-read-door-restore.md
