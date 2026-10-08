# Brave mobile: decentralized names versus verified controller delivery

## Scope

Question: can Brave on Android verify controller code independently of its HTTPS
hosting gateway by using ENS (`.eth`) or another decentralized URL scheme?
This is a source inspection, not a test of the user's installed Brave version.
No phone settings, wallets, deployments or application code were changed.

## Findings and primary sources

- Brave's current main-branch Android source includes ENS settings:
  <https://github.com/brave/brave-core/blob/master/android/java/org/chromium/chrome/browser/decentralized_dns/settings/ENSSettingsFragment.java>.
  This establishes Android integration in source, not availability/configuration
  in every released mobile build. Do not extrapolate to iOS.
- The ENS navigation path calls `EnsGetContentHash`, converts the returned content
  hash into an IPFS/IPNS URI, and translates it to a gateway URL for navigation:
  <https://github.com/brave/brave-core/blob/master/browser/net/decentralized_dns_network_delegate_helper.cc>.
- `TranslateIPFSURI` constructs an HTTPS public-gateway URL from the CID and path:
  <https://github.com/brave/brave-core/blob/master/components/ipfs/ipfs_utils.cc>.
  Recognizing/validating the CID's format is not verification of the downloaded
  response bytes. The inspected ENS path is gateway redirection, not an
  independently verifying website loader.
- Brave's official IPFS announcement now carries a deprecation notice dated
  August 22, 2024 (version 1.69.153). The same article explicitly distinguishes
  local-node verification from trusting gateway responses:
  <https://brave.com/blog/ipfs-support/>.
  Historical local-node documentation is not a current mobile capability.

## Implication

ENS naming can identify a content hash, but name resolution and verification of
executed website bytes are separate requirements. Even assuming correct ENS
resolution, redirecting to an HTTPS gateway leaves that gateway trusted for
content integrity unless an independently trusted verifier checks the content
before execution, including executable dependencies. ENS records can also change;
an ENS name is not itself a pinned immutable release.

No built-in Brave Android delivery mechanism was established here that guarantees
execution of the helper-approved controller bytes regardless of gateway behavior.
A `.eth` address alone does not solve this project's initial-delivery trust issue.

The Brave support-center page was blocked by a web challenge; these conclusions
use the official source and announcement above instead. No background-agent tool
was available, so the sources were inspected directly.
