# Irys as the HTTPS entry point for the Autonomi tunnel

## Verdict

**Yes for hosting the browser entry page: supported by current official documentation and observed live HTTP behavior.** Irys supports executable HTML delivery, folder manifests, and isolated per-transaction CDN origins. No application-owned domain or continuously running frontend server is necessary.

**Not yet an end-to-end verification of the Service Worker tunnel.** The documented layout can meet browser requirements, and the HTTP probes found no blanket JavaScript-serving prohibition, but we did not publish a controlled HTML/worker fixture or register a worker in a browser. Mobile Safari, Android Chrome, Autonomi SDK loading, and the connection to a NATed publisher remain untested.

A significant operational caveat: the stable **gateway URL is not a guaranteed stable browser origin**. Irys explicitly reserves the right to rotate CDN domains. Browser storage, Service Worker registrations, permissions, and cookies cannot be assumed to survive such a change.

## Method and limits

Verified on 2026-10-06 using:

- Current official Irys documentation at `docs.irys.xyz`.
- Read-only queries against the documented GraphQL endpoint to find existing public content.
- HTTPS GET requests, recording redirects and response headers.
- The W3C Service Workers specification for browser restrictions.

No background-agent tool was available, so research was performed directly. No uploads, wallet operations, payments, permanent publications, or browser execution of third-party JavaScript were performed. HTML samples are arbitrary public uploads, not endorsed applications. Their contents were not executed. Some broad GraphQL queries timed out; timestamp-bounded queries located usable samples.

The public Irys documentation repositories inspected were older than the deployed documentation, so current official web pages were used rather than treating old repositories as authoritative for current gateway behavior.

## Findings

### 1. HTTPS HTML hosting: confirmed

Irys documents content retrieval through `https://gateway.irys.xyz/<transaction-id>` [1]. Tags determine content types, with automatic file-extension inference and explicit overrides [2]. Its CDN documentation explicitly supports static-site deployment [3].

A live GET of:

```text
https://gateway.irys.xyz/AbPF7GiYE3ZD3feph8YF6Hrb4bRsVMAyKNw6X67eGYsD
```

returned:

```text
302 Location: https://r2ebjeuoold5llpiu5fyrhwoxvoquewpvwzsugtq2li3dye4r5sa.mainnet-1.datasprite-cdn.com/AbPF7GiYE3ZD3feph8YF6Hrb4bRsVMAyKNw6X67eGYsD/
200 Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
Cache-Control: max-age=2592000
```

The response body was HTML with inline and external JavaScript. The observed response did not include `Content-Disposition: attachment` or a `Content-Security-Policy` header disabling script execution. This establishes HTML delivery, not a browser execution test.

A second HTML transaction, `BCwNn42GdcaM8s8xEZ9qQ5X84iM1tUswkP45DS6wjgx6`, also returned HTML but under a different CDN hostname.

### 2. Origin isolation: documented and observed

Official docs specify **per-transaction subdomains**, replacing a shared path-based origin [3]. The two live HTML responses above were routed to distinct HTTPS hostnames, consistent with that design.

This solves the basic unrelated-upload same-origin problem. It is not a security audit of every gateway route, cookie setting, or application. Separate tunnels served by our own single application origin would still need their own isolation/access-control design.

### 3. Folder manifests and same-origin asset paths: confirmed

Irys supports logical paths under a folder manifest [4], and `uploadFolder()` accepts an index file that loads when the manifest URL is opened [5].

Live probes of the documentation's example manifest verified both forms below:

```text
https://gateway.irys.xyz/8eNpkShMwdbiNBtGuVGBKp8feDZCa21VppX2eDi3eLME/image-1.png
```

This redirected into the **manifest's** CDN hostname and returned `200 image/png` with child item ID `DTMcqFqwaDukaYxs7iK2fa6CuMtyi7sN93rBGSAa13Ug`.

Also tested directly as a diagnostic, not a recommended permanent link:

```text
https://ogkpsw6zysr2ku6qit45kggzjctzrqwdcdm7ugde3l3bamw4m5eq.mainnet-1.datasprite-cdn.com/image-1.png
```

This returned the same child item with `200`, without redirecting to that child's separate transaction origin. That demonstrates manifest-root asset routing on the sampled deployment, consistent with the documentation's root-base-path claim [3]. The sampled manifest contains images, not a Service Worker.

### 4. Service Worker support: plausible, not fully verified

The browser specification requires [6]:

- A trustworthy origin, normally HTTPS.
- Same-origin script, scope, and registering page.
- A JavaScript MIME type for the worker script.
- No redirect when fetching the top-level worker script: the fetch uses redirect mode `error`.
- Scope within the script's directory unless `Service-Worker-Allowed` explicitly expands it.

Consequences for deployment:

1. Put `index.html` and `sw.js` in **one folder manifest**.
2. Let the initial navigation follow the gateway redirect to the isolated CDN origin.
3. Register the worker using a same-origin manifest path, not its independent `gateway.irys.xyz/<worker-tx>` URL.
4. Prefer a worker at the manifest origin's root (`/sw.js`, scope `/`) if verified to resolve without redirects. A worker under `/<manifest-id>/sw.js` can use that narrower directory scope without a special header, but arbitrary root-relative application URLs would then need care.
5. The top-level worker must itself be available through HTTP(S). Fetching it from Autonomi into a `blob:` URL is not a substitute for a registrable HTTP(S) worker script.

A live request to an existing JavaScript transaction:

```text
https://gateway.irys.xyz/7onkYU74mS1UV1vUxWLZWXC2yzyrrYupEKQwfHnxtShF
```

with `Service-Worker: script` and `Sec-Fetch-Dest: serviceworker` returned a gateway redirect, followed by `200 Content-Type: text/javascript`. The body was not downloaded in full because it exceeded the probe's 2 MB cap; response headers were captured. No `Service-Worker-Allowed` header was observed. Its absence does **not** prohibit ordinary directory-scoped registration.

This probe does **not** prove registration works: it used curl (which followed a redirect a browser worker fetch would reject), the script was not a worker fixture, and the response was on a different transaction origin. It only confirms JavaScript MIME delivery with those request headers on that sampled route.

No explicit guarantee of Service Worker support or arbitrary response-header configuration was found in the official Irys pages reviewed. Do not assume upload tags become arbitrary HTTP headers: the documentation specifically establishes `Content-Type` behavior [2].

### 5. Stable sharing URL, potentially changing browser origin

Irys explicitly says to share gateway URLs, **not CDN URLs**, because CDN domains can be rotated or replaced without notice [3].

Therefore:

- Share `https://gateway.irys.xyz/<manifest-id>/...`.
- Compute internal asset URLs from the loaded page's current origin/path; do not hard-code the current CDN hostname.
- Treat browser local storage, IndexedDB, caches, and worker registrations as recreatable state.
- Do not promise durable sessions, persisted permission grants, or origin-bound identity across CDN migrations.
- Different immutable release transactions may have different origins. Mutable references provide a stable entry URL, but do not establish a contract for stable final origins across updates.

Irys supports mutable references at `/mutable/<root-tx>` and mutable folder manifests; updates must be signed by the original uploader [4, 7]. Immutable release URLs are simpler for reproducibility. A mutable “latest” URL is an optional convenience with a separate update-trust policy.

### 6. Storage network and availability caveats

The current docs distinguish Irys L1 mainnet beta from legacy Arweave storage and temporary devnet storage [1, 8]. The documented mainnet bundler is `uploader.irys.xyz`; devnet data is retained for approximately 60 days [8]. Select the correct storage destination rather than assuming all historical Irys transaction IDs are on Irys L1.

This distinction was visible in probes: the image ID in the downloading documentation, `CO9EpX0lekJEfXUOeXncUmMuG8eEp5WJHXl9U9yZUYA`, went through a `legacy.datasprite-cdn.com` hostname and then to `arweave.net`. In contrast, the HTML and manifest samples above went to `mainnet-1.datasprite-cdn.com`.

“No infrastructure we operate” is achievable for the frontend; “no hosted infrastructure” is not. Visitors depend on the public gateway/CDN, DNS, certificate infrastructure, and network availability. Permanent data storage does not guarantee continuous availability of one HTTP gateway.

### 7. Integrity and post-quantum scope

Irys metadata tags are signed and stored with the data [2]. However, an ordinary browser loading the initial HTML still trusts the HTTPS delivery path: the page cannot independently establish its own integrity merely by containing a self-check.

Pinning Autonomi frontend assets/content addresses in the loader is useful once that loader is trusted. It does not remove the initial gateway/code-delivery trust dependency or establish end-to-end PQ authentication for the entire bootstrap chain. Autonomi's PQ session protects its own communication path, not arbitrary malicious JavaScript substituted before that session starts.

## Recommended deployment shape

```text
Shared Irys gateway URL
  -> isolated HTTPS CDN origin
     -> index.html + sw.js + minimum loader/SDK assets
        -> direct WebRTC connections to Autonomi nodes
           -> verified, version-pinned frontend assets
        -> separate authenticated tunnel connection to publisher
```

Host the Service Worker with the Irys shell. Decide whether the SDK/WASM also lives there based on bootstrap dependencies and verified loading behavior. Remaining assets can come from Autonomi; storing them there is optional, not necessary to make the entry page work.

The Irys check does not verify general-purpose routing/relay rights on Autonomi storage nodes, NAT traversal to the publisher, or arbitrary website compatibility with Service Worker tunneling.

## Required small acceptance test before committing

Publish a controlled folder containing `index.html`, `sw.js`, a minimal JavaScript file, and a small WASM fixture or pinned SDK build. Use a disposable development signing key, not an existing wallet secret. Publishing requires a separate deliberate step; none was performed in this research.

On iOS Safari and Android Chrome, test:

1. Open the gateway share URL; record final origin and document base URL.
2. Fetch `/sw.js`; require direct `200` JavaScript with no redirect and no policy rejection.
3. Register, activate, and obtain control of the document.
4. Intercept a synthetic navigation under the intended scope.
5. Load JS/WASM and make a real Autonomi authenticated read.
6. Reload, deep-link, and repeat after browser storage is cleared.
7. Open a second immutable release and test any mutable-link update flow.
8. Check that a share-link fragment survives redirects before using fragments for invitations. No secret-bearing links were tested here.

Acceptance is **not** dependent on arbitrary custom headers if the worker is served at the appropriate directory scope. If worker delivery fails, Irys can still serve a plain browser UI, but the current transparent Service Worker tunnel would need different hosting or a different browsing interface.

## Primary sources

1. Irys, Downloading: https://docs.irys.xyz/onchain-storage/downloading
2. Irys, Tags: https://docs.irys.xyz/onchain-storage/tags
3. Irys, CDN Domains: https://docs.irys.xyz/onchain-storage/cdn-domains
4. Irys, Onchain Folders: https://docs.irys.xyz/onchain-storage/onchain-folders
5. Irys, uploadFolder(): https://docs.irys.xyz/onchain-storage/uploadfolder
6. W3C Service Workers: https://w3c.github.io/ServiceWorker/#register-algorithm and https://w3c.github.io/ServiceWorker/#update-algorithm ; header/scoping examples: https://w3c.github.io/ServiceWorker/#service-worker-allowed
7. Irys, Mutability: https://docs.irys.xyz/onchain-storage/mutability
8. Irys, Mainnet / Devnet: https://docs.irys.xyz/onchain-storage/mainnet-devnet
9. Irys, Querying (used to locate probe samples): https://docs.irys.xyz/onchain-storage/querying

Live response samples are identified by gateway URLs above. They document observed behavior at research time, not an uptime or compatibility guarantee.
