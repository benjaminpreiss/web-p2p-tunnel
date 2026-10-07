import test from "node:test";
import assert from "node:assert/strict";
import { hostedConfiguration } from "../src/hosted-config.ts";

// Synthetic addresses only, not recorded endpoints. Cryptographic validation belongs to Rust/WASM.
const suffix = `/webrtc-direct/certhash/u${"A".repeat(48)}/p2p/${"a".repeat(64)}`;
const descriptor = `/ip4/10.0.0.1/udp/49623${suffix}`;

test("accepts an explicitly pasted LAN descriptor without altering its pins", () => {
  const config = hostedConfiguration(`\n${descriptor}\n`);
  assert.equal(config.multiaddr, descriptor);
  assert.equal(config.mode, "hosted-lan");
  assert.equal(config.label, "web-p2p-tunnel.relay-spike.v1");
  assert.equal(config.messageLimit, 8192);
});

test("rejects remote URLs, public/loopback targets, invalid ports, and malformed input", () => {
  for (const input of [
    "", null, "x".repeat(4097), "https://example.com/session.json",
    `/ip4/127.0.0.1/udp/49623${suffix}`, `/ip4/198.51.100.1/udp/49623${suffix}`,
    `/ip4/10.0.0.999/udp/49623${suffix}`, `/ip4/10.0.0.1/udp/0${suffix}`,
    `/ip4/10.0.0.1/udp/65536${suffix}`, `${descriptor}\n${descriptor}`,
    descriptor.replace("/p2p/", "/wrong/"),
  ]) assert.throws(() => hostedConfiguration(input), Error, String(input));
});
