import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AtomicAmount { toFixed(): string }
export interface SignedItem {
  id: string;
  size: number;
  sign(): Promise<unknown>;
  getPrice(): Promise<AtomicAmount>;
  upload(): Promise<{ id: string }>;
}
export interface Publisher {
  createTransaction(data: string | Uint8Array, options: { tags: { name: string; value: string }[] }): SignedItem;
  getBalance(): Promise<AtomicAmount>;
  fund(amount: string): Promise<{ id: string }>;
}
export interface Asset { path: string; data: Buffer; type: string }
export interface PlannedItem { path: string; tx: SignedItem; id: string; bytes: number }
export type PublicationEvent =
  | { type: "quote" | "funding-started"; atomicUsdc: string }
  | { type: "funded"; id: string; atomicUsdc: string }
  | { type: "uploaded"; path: string; id: string; atomicUsdc: string };
export interface PublishOptions {
  maxUpload: bigint;
  fundTo?: bigint;
  maxFund?: bigint;
  fundOnly?: boolean;
  record?: (event: PublicationEvent) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export const FILES: Readonly<Record<string, string>> = Object.freeze({
  "index.html": "text/html; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "style.css": "text/css; charset=utf-8",
  "pkg/relay_crypto.js": "text/javascript; charset=utf-8",
  "pkg/relay_crypto_bg.wasm": "application/wasm",
});

export function isMergedMainEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null || !("action" in event) || event.action !== "closed" ||
      !("pull_request" in event)) return false;
  const pr = event.pull_request;
  if (typeof pr !== "object" || pr === null || !("merged" in pr) || pr.merged !== true || !("base" in pr)) return false;
  const base = pr.base;
  return typeof base === "object" && base !== null && "ref" in base && base.ref === "main";
}

export function usdc(value: string): bigint {
  if (!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(value ?? "")) {
    throw new Error("Use a nonnegative USDC decimal with at most six fractional digits.");
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function atomic(value: AtomicAmount): bigint {
  const text = value.toFixed();
  if (!/^\d+$/.test(text)) throw new Error("Invalid atomic USDC amount from bundler.");
  return BigInt(text);
}

export function transactionId(value: string): string {
  // Irys L1 IDs are base58-encoded SHA-256 hashes, not legacy Arweave
  // base64url IDs. Validate the decoded 32-byte width, including leading zeros.
  if (typeof value !== "string" || value.length < 32 || value.length > 44 || /[^1-9A-HJ-NP-Za-km-z]/.test(value)) {
    throw new Error("Invalid Irys transaction ID.");
  }
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  let bytes = 0;
  while (number > 0n) {
    bytes++;
    number >>= 8n;
  }
  const leadingZeros = value.match(/^1*/)?.[0].length ?? 0;
  if (bytes + leadingZeros !== 32) throw new Error("Invalid Irys transaction ID.");
  return value;
}

export function loadSite(directory: string): Asset[] {
  const found: string[] = [];
  function walk(relative = "") {
    const path = join(directory, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error("Symlinks are not publishable.");
    if (stat.isDirectory()) {
      if (relative && relative !== "pkg") throw new Error("Unexpected site directory.");
      for (const name of readdirSync(path)) walk(relative ? `${relative}/${name}` : name);
    } else {
      if (!stat.isFile() || !Object.hasOwn(FILES, relative)) throw new Error("Unexpected site file.");
      if (stat.size > 16 * 1024 * 1024) throw new Error("Asset exceeds size limit.");
      found.push(relative);
    }
  }
  walk();
  if (found.length !== Object.keys(FILES).length) throw new Error("Incomplete site bundle.");
  const assets = found.sort().map((path) => ({ path, data: readFileSync(join(directory, path)), type: FILES[path] }));
  for (const asset of assets) {
    if (/\/Users\/|\/home\/(?!build(?:\/|\x00))|[A-Za-z]:[\\/]Users[\\/]/.test(asset.data.toString("latin1"))) {
      throw new Error("Asset contains an embedded user-home path; rebuild with apps/browser/build.ts.");
    }
  }
  const html = assets.find((asset) => asset.path === "index.html")!.data.toString();
  if (!html.includes('data-fixture="hosted"') || html.includes('data-fixture="local"')) {
    throw new Error("Only the hosted frontend can be published.");
  }
  const wasm = assets.find((asset) => asset.path.endsWith(".wasm"))!.data;
  if (!wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
    throw new Error("Invalid WASM asset.");
  }
  return assets;
}

// Sign first so all file IDs, the complete folder manifest, and serialized sizes
// are known before any payment/upload. Signed items remain local until upload().
export async function preparePublication(irys: Publisher, assets: Asset[]): Promise<PlannedItem[]> {
  const plan: PlannedItem[] = [];
  const paths: Record<string, { id: string }> = {};
  async function prepare(path: string, data: Buffer | string, type: string, extraTags: { name: string; value: string }[] = []) {
    const tx = irys.createTransaction(data, {
      tags: [{ name: "Content-Type", value: type }, ...extraTags],
    });
    await tx.sign();
    plan.push({ path, tx, id: transactionId(tx.id), bytes: tx.size });
    return tx.id;
  }
  for (const asset of assets) {
    paths[asset.path] = { id: await prepare(asset.path, asset.data, asset.type) };
  }
  const manifest = { manifest: "irys/paths", version: "0.1.0", index: { path: "index.html" }, paths };
  await prepare("manifest.json", JSON.stringify(manifest), "application/x.irys-manifest+json", [{ name: "Type", value: "manifest" }]);
  return plan;
}

// A quote guard, not a price-locked contract: prices may move between quote and
// acceptance. Native SOL fees are separate. Keep the deployment wallet small.
export async function publishPrepared(irys: Publisher, plan: PlannedItem[], {
  maxUpload, fundTo = 0n, maxFund = 1_000_000n, fundOnly = false,
  record = async () => {}, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: PublishOptions): Promise<string | null> {
  if (fundOnly && fundTo <= 0n) throw new Error("Funding-only mode requires an explicit positive target.");
  if (plan.length === 0) throw new Error("Empty publication plan.");
  if (maxUpload <= 0n || fundTo < 0n || fundTo > maxFund) throw new Error("Invalid spending limits.");
  const quotes = await Promise.all(plan.map(async ({ tx }) => atomic(await tx.getPrice())));
  const total = quotes.reduce((a, b) => a + b, 0n);
  await record({ type: "quote", atomicUsdc: total.toString() });
  if (total > maxUpload) throw new Error("Publication quote exceeds USDC limit.");
  let balance = atomic(await irys.getBalance());
  if (fundTo && fundTo < total) throw new Error("Funding target is below the publication quote.");
  if (fundTo > balance) {
    const amount = fundTo - balance;
    await record({ type: "funding-started", atomicUsdc: amount.toString() });
    // Never retry this call here. A failure can occur AFTER an on-chain transfer.
    const receipt = await irys.fund(amount.toString());
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(receipt.id)) throw new Error("Invalid funding receipt ID.");
    await record({ type: "funded", id: receipt.id, atomicUsdc: amount.toString() });
    for (let attempt = 0; attempt < 30; attempt++) {
      balance = atomic(await irys.getBalance());
      if (balance >= fundTo) break;
      await sleep(2000);
    }
    if (balance < fundTo) throw new Error("Funding not yet credited; reconcile before rerunning.");
  }
  if (fundOnly) return null; // No upload calls, including when credit already meets the target.
  if (balance < total) throw new Error("Insufficient prepaid Irys USDC balance; use manual funding.");
  let quotedSpent = 0n;
  for (const item of plan) {
    const price = atomic(await item.tx.getPrice());
    if (quotedSpent + price > maxUpload) throw new Error("Updated quote exceeds USDC limit.");
    if (atomic(await irys.getBalance()) < price) throw new Error("Insufficient remaining Irys balance.");
    const response = await item.tx.upload();
    if (transactionId(response.id) !== item.id) throw new Error("Upload receipt ID mismatch.");
    quotedSpent += price;
    await record({ type: "uploaded", path: item.path, id: item.id, atomicUsdc: price.toString() });
  }
  return transactionId(plan.at(-1)!.id);
}
