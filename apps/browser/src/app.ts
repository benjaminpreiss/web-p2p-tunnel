// Throwaway browser diagnostic. Cryptography and SDP synthesis live in Rust/WASM.
import "./style.css";
import { hostedConfiguration } from "./hosted-config.ts";
import type { Configuration } from "./hosted-config.ts";
import type { PqEchoClient } from "../pkg/relay_crypto.js";

function element<T extends Element>(selector: string, type: { new(): T }): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing UI element: ${selector}`);
  return found;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const status = element("#status", HTMLParagraphElement);
const output = element("#log", HTMLPreElement);
const button = element("#run", HTMLButtonElement);
const messageInput = element("#message", HTMLInputElement);
const descriptorInput = element("#descriptor", HTMLTextAreaElement);
const hosted = document.documentElement.dataset.fixture === "hosted";
const started = performance.now();

function log(message: string, details?: unknown) {
  const elapsed = ((performance.now() - started) / 1000).toFixed(2);
  output.textContent += `[${elapsed}s] ${message}${details === undefined ? "" : ` ${JSON.stringify(details)}`}\n`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function json(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

// Install before negotiation so an early server response cannot be lost.
class Inbox {
  private queue: Uint8Array[] = [];
  private waiter: { resolve: (message: Uint8Array) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private failure: Error | null = null;

  constructor(channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", (event) => {
      if (this.failure) return;
      if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 16384) {
        this.fail(new Error("Invalid or oversized DataChannel message"));
        channel.close();
        return;
      }
      const message = new Uint8Array(event.data);
      if (this.waiter) {
        const waiter = this.waiter;
        this.waiter = null;
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      } else if (this.queue.length < 2) {
        this.queue.push(message);
      } else {
        this.fail(new Error("Unexpected excess DataChannel messages"));
        channel.close();
      }
    });
    channel.addEventListener("error", () => this.fail(new Error("DataChannel error")));
    channel.addEventListener("close", () => this.fail(new Error("DataChannel closed")));
  }

  fail(error: Error): void {
    this.failure ??= error;
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.reject(this.failure);
      this.waiter = null;
    }
  }

  next(): Promise<Uint8Array> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.waiter) return Promise.reject(new Error("Concurrent inbox read"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Timed out waiting for PQ/echo response")), 20000);
      this.waiter = { resolve, reject, timer };
    });
  }
}

function waitForOpen(peer: RTCPeerConnection, channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === "open") return Promise.resolve();
  if (channel.readyState === "closed" || peer.connectionState === "failed") {
    return Promise.reject(new Error("WebRTC closed or failed during negotiation"));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      channel.removeEventListener("open", opened);
      channel.removeEventListener("error", failed);
      channel.removeEventListener("close", failed);
      peer.removeEventListener("connectionstatechange", changed);
      if (error) reject(error); else resolve();
    };
    const opened = () => finish();
    const failed = () => finish(new Error("WebRTC channel failed before opening"));
    const changed = () => {
      if (["failed", "closed"].includes(peer.connectionState)) failed();
    };
    const timer = setTimeout(() => finish(new Error("WebRTC opening timed out after 30 seconds")), 30000);
    channel.addEventListener("open", opened);
    channel.addEventListener("error", failed);
    channel.addEventListener("close", failed);
    peer.addEventListener("connectionstatechange", changed);
  });
}

async function candidateSummary(peer: RTCPeerConnection): Promise<Record<string, unknown>> {
  const reports = await peer.getStats();
  const entries: unknown[] = [...reports.values()];
  let pair: unknown;
  for (const report of entries) {
    if (isRecord(report) && report.type === "transport" && typeof report.selectedCandidatePairId === "string") {
      pair = reports.get(report.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    pair = entries.find((report) => isRecord(report) && report.type === "candidate-pair" && report.nominated && report.state === "succeeded");
  }
  if (!isRecord(pair)) return { selectedPair: "not exposed by this browser" };
  const localEntry: unknown = typeof pair.localCandidateId === "string" ? reports.get(pair.localCandidateId) : undefined;
  const remoteEntry: unknown = typeof pair.remoteCandidateId === "string" ? reports.get(pair.remoteCandidateId) : undefined;
  const local = isRecord(localEntry) ? localEntry : undefined;
  const remote = isRecord(remoteEntry) ? remoteEntry : undefined;
  return {
    state: pair.state,
    localType: local?.candidateType,
    remoteType: remote?.candidateType,
    remoteAddress: remote?.address,
    remotePort: remote?.port,
    protocol: remote?.protocol,
    note: "MASQUE forwarding is external to browser ICE; candidateType need not say relay.",
  };
}

async function run(Client: typeof PqEchoClient, configuration: Configuration): Promise<void> {
  button.disabled = true;
  messageInput.disabled = true;
  descriptorInput.disabled = true;
  let cleanupPeer: RTCPeerConnection | undefined;
  let cleanupCrypto: PqEchoClient | undefined;
  try {
    const message = new TextEncoder().encode(messageInput.value);
    if (message.length > 8192) throw new Error("UTF-8 message exceeds 8 KiB");
    const crypto = new Client(configuration.multiaddr);
    cleanupCrypto = crypto;
    const peer = new RTCPeerConnection({ iceServers: [] });
    cleanupPeer = peer;
    const channel = peer.createDataChannel(configuration.label, { ordered: true });
    const inbox = new Inbox(channel);
    peer.addEventListener("iceconnectionstatechange", () => log("ICE state:", peer.iceConnectionState));
    peer.addEventListener("connectionstatechange", () => {
      log("Connection state:", peer.connectionState);
      if (["failed", "closed"].includes(peer.connectionState)) inbox.fail(new Error(`WebRTC ${peer.connectionState}`));
    });
    peer.addEventListener("icecandidateerror", (event) => log("ICE candidate warning:", { code: event.errorCode, message: event.errorText }));

    status.textContent = "Connecting through the relay…";
    log("Dialing the relay allocation only:", configuration.multiaddr);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    // Do not modify browser-generated ICE credentials. Saorsa's shared code
    // generates the v2 ICE-lite remote answer from the original local SDP.
    if (!peer.localDescription?.sdp) throw new Error("Browser did not produce a local SDP");
    const answer = crypto.answer_sdp(peer.localDescription.sdp);
    await peer.setRemoteDescription({ type: "answer", sdp: answer });
    await waitForOpen(peer, channel);
    log("WebRTC DataChannel open");

    status.textContent = "Authenticating the publisher…";
    channel.send(Uint8Array.from(crypto.client_hello()).buffer);
    crypto.authenticate(await inbox.next());
    log("Publisher identity authenticated by Saorsa PQ session");
    status.textContent = "Checking encrypted echo…";
    channel.send(Uint8Array.from(crypto.encrypt(message)).buffer);
    const echoed = crypto.decrypt(await inbox.next());
    if (echoed.length !== message.length || !echoed.every((byte, index) => byte === message[index])) {
      throw new Error("Decrypted echo does not match the sent message");
    }
    log("PQ-encrypted echo matched:", { bytes: echoed.length });
    try {
      log("Selected ICE pair:", await candidateSummary(peer));
    } catch (error) {
      log("Optional ICE statistics unavailable:", errorText(error));
    }
    if (hosted) {
      status.textContent = "PASS — authenticated PQ echo; check relay counters in the helper terminal";
      log("PASS: hosted-page browser authenticated the publisher and matched the encrypted echo");
      log("Relay accounting is NOT fetched by this static page. After recording these results, Ctrl-C the helper and capture its final bidirectional counters.");
    } else {
      const counters = await json("/stats.json");
      log("Measured helper bridge traffic:", counters);
      if (!isRecord(counters) || typeof counters.relayToListenerPackets !== "number" ||
          typeof counters.listenerToRelayPackets !== "number" ||
          counters.relayToListenerPackets < 1 || counters.listenerToRelayPackets < 1) {
        throw new Error("Echo matched, but bidirectional relay counters are missing");
      }
      status.textContent = "PASS — browser PQ echo through the local MASQUE relay";
      log("PASS: real browser + PQ echo + measured local relay traffic");
    }
    log("Test mode:", configuration.mode);
    log("NOT YET PROVEN: other browsers/devices, cellular/home NAT, direct-first fallback, authorization, HTTP forwarding, Service Worker routing.");
  } catch (error) {
    status.textContent = "FAIL — copy diagnostics and terminal output";
    log("FAIL:", errorText(error));
    if (!hosted) {
      try { log("Bridge counters at failure:", await json("/stats.json")); } catch {}
    }
  } finally {
    cleanupPeer?.close();
    cleanupCrypto?.free();
    log("One attempt per run. Restart the CLI before retrying or switching browsers.");
  }
}

async function boot() {
  log("Browser:", navigator.userAgent);
  log("Secure context:", window.isSecureContext);
  log("Page location:", { origin: location.origin, path: location.pathname, mode: hosted ? "hosted" : "local" });
  if (!window.isSecureContext) throw new Error("This fixture requires HTTPS or the exact trusted localhost URL");
  if (typeof RTCPeerConnection !== "function") throw new Error("WebRTC unavailable in this browser");
  // Keep the generated glue and its sibling WASM at stable manifest-relative paths.
  // Vite must not rewrite this external module or silently inline the WASM.
  const module: typeof import("../pkg/relay_crypto.js") = await import(/* @vite-ignore */ new URL("./pkg/relay_crypto.js", document.baseURI).href);
  await module.default();
  log("Saorsa PQ WASM loaded");
  if (hosted) {
    element("#hosted-connection", HTMLElement).hidden = false;
    status.textContent = "Ready — paste your helper's fresh public descriptor";
    log("Static hosted mode: no localhost fetches, ADB, telemetry, stored invitation, or automatic connection.");
    log("Browser/device local-network policy still applies. Normal permission prompts are allowed; do not disable browser security.");
    button.disabled = false;
    button.addEventListener("click", () => {
      let configuration: Configuration;
      try { configuration = hostedConfiguration(descriptorInput.value); }
      catch (error) {
        status.textContent = "Check the pasted descriptor";
        log("INPUT REJECTED:", errorText(error));
        return;
      }
      void run(module.PqEchoClient, configuration);
    });
    return;
  }
  const configuration = await json("/session.json");
  if (!isRecord(configuration) || typeof configuration.multiaddr !== "string" ||
      typeof configuration.mode !== "string" || configuration.label !== "web-p2p-tunnel.relay-spike.v1" || configuration.messageLimit !== 8192) {
    throw new Error("Browser/helper fixture version mismatch");
  }
  const localConfiguration: Configuration = {
    multiaddr: configuration.multiaddr, label: configuration.label,
    messageLimit: configuration.messageLimit, mode: configuration.mode,
  };
  log("Fixture mode:", configuration.mode);
  if (configuration.mode === "phone-lan") {
    log("Development test: page and identity metadata use USB/ADB localhost; WebRTC UDP uses Wi-Fi through MASQUE.");
    log("Keep USB connected. Browser networking is still subject to device policy; do not disable browser security.");
  }
  status.textContent = "Ready — one browser attempt";
  button.disabled = false;
  button.addEventListener("click", () => void run(module.PqEchoClient, localConfiguration), { once: true });
}

boot().catch((error) => {
  status.textContent = "Setup failed — copy diagnostics";
  log("SETUP FAILED:", errorText(error));
});
