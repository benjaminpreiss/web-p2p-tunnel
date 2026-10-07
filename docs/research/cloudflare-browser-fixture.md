# Cloudflare Pages for the browser relay fixture

Investigated 2026-10-06 against Cloudflare's official documentation. No deployment
or VPS modification was performed. Research was performed directly because this
session has no background-agent tool.

## Recommendation

Use Cloudflare Pages Direct Upload for the diagnostic HTML, JS, and WASM. Keep the
Saorsa UDP/MASQUE relay on the user's Debian VPS, reached by its public IP. This
separates website HTTPS from the relay transport; no user-owned domain, VPS web
server, or VPS website certificate is needed for this layout.

Cloudflare serves executable client assets and is therefore trusted for their
integrity. PQ protection of the subsequent connection does not remove that trust.
Pages serves the frontend, not this custom UDP relay or its tunnel traffic.

## Verified hosting facts

- Direct Upload supports prebuilt static assets via dashboard drag-and-drop
  (folder or zip) or Wrangler (folder). Projects receive a `<project>.pages.dev`
  hostname. A Direct Upload project cannot later switch to Git integration;
  a new project would be needed. [Direct Upload][upload]
- Cloudflare documents HTTPS `pages.dev` deployment URLs. Preview deployments
  are public by default; Access restrictions are optional. [Preview deployments][previews]
- Pages has a Free plan, up to 20,000 site files, and a 25 MiB per-file limit.
  Dashboard uploads have a tighter 1,000-file limit. [Limits][limits], [Direct Upload][upload]
- The locally built `browser/pkg/relay_crypto_bg.wasm` is approximately 1.2 MiB,
  below that file limit. This is a local filesystem observation, not a deployed
  serving/WASM-execution test.
- Without a top-level `404.html`, Pages falls back to the root page for missing
  paths. Include a `404.html` in the fixture bundle so missing WASM/JSON assets
  fail clearly instead of returning HTML with a successful status. [Serving Pages][serving]

## Changes still needed before upload

The working local fixture is not deployable unchanged:

1. `browser/app.js` currently fetches `/session.json` and `/stats.json` from the
   local Rust HTTP server. A static Pages project will not provide those APIs.
2. Supply the relay endpoint, certificate pin, and publisher identity through
   explicit invitation input, e.g. a link fragment. Do not bake a short-lived
   allocation into the static bundle or upload keys/credentials. This invitation
   mechanism is not implemented yet and is not visitor authorization.
3. Keep relay counters in CLI logs for the public test, or deliberately design
   an authenticated diagnostic protocol. Do not expose the local HTTP server to
   the Internet merely to preserve its statistics endpoint.
4. Separate the relay and publisher into distinct processes/machines and replace
   the local-only bridge restriction with a reviewed bounded public-test adapter.
   The current CLI binds loopback and cannot yet run the proposed Internet test.
5. Upload only a staged static asset directory, not the whole repo or Rust crate.

The intended test remains **encrypted echo only**. No localhost application is
exposed, and no Internet/mobile success is claimed before the actual run.

## Rollback boundary

A disposable Pages project avoids changing existing DNS/sites and can be removed
after the experiment. That does not erase browser caches, provider logs, or copies
of publicly served assets. Keep all published assets non-sensitive. The VPS relay
needs its own inventory and explicitly documented reversible setup/cleanup; no
package installation, firewall change, or relay deployment is authorized by this
research note.

[upload]: https://developers.cloudflare.com/pages/get-started/direct-upload/
[limits]: https://developers.cloudflare.com/pages/platform/limits/
[serving]: https://developers.cloudflare.com/pages/configuration/serving-pages/
[previews]: https://developers.cloudflare.com/pages/configuration/preview-deployments/
