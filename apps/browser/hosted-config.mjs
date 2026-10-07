// LAN-only fixture input validation, not cryptography or visitor authorization.
// The shared Rust/WASM client subsequently validates the actual pins/descriptor.
export function hostedConfiguration(input) {
  if (typeof input !== "string" || input.length > 4096) {
    throw new Error("Paste one public helper descriptor (maximum 4096 characters)");
  }
  const multiaddr = input.trim();
  const match = /^\/ip4\/(\d{1,3}(?:\.\d{1,3}){3})\/udp\/(\d{1,5})\/webrtc-direct\/certhash\/u[A-Za-z0-9_-]{8,128}\/p2p\/[a-f0-9]{64}$/.exec(multiaddr);
  if (!match) throw new Error("Expected the complete /ip4/.../p2p/... descriptor printed by your helper");
  const ip = match[1].split(".").map(Number);
  const privateIp = ip.every((part) => part <= 255) &&
    (ip[0] === 10 || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] === 192 && ip[1] === 168));
  if (!privateIp || Number(match[2]) < 1 || Number(match[2]) > 65535) {
    throw new Error("This diagnostic accepts only a private LAN IPv4 address and a valid UDP port");
  }
  return Object.freeze({
    multiaddr,
    label: "web-p2p-tunnel.relay-spike.v1",
    messageLimit: 8192,
    mode: "hosted-lan",
  });
}
