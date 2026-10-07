import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FILES, loadSite, preparePublication, publishPrepared, usdc, isMergedMainEvent } from "./publication.ts";
import type { Publisher, SignedItem } from "./publication.ts";

function fixture(prices = [10n, 20n], initialBalance = 100n) {
  let balance = initialBalance;
  let nextId = 0;
  const uploads: string[] = [];
  const funding: string[] = [];
  const data: (string | Uint8Array)[] = [];
  const items: SignedItem[] = [];
  const client: Publisher = {
    createTransaction(input) {
      data.push(input);
      const index = nextId++;
      const item: SignedItem = {
        id: String(index).padStart(43, "a"), size: input.length,
        async sign() {},
        async getPrice() { return { toFixed: () => String(prices[index % prices.length] ?? 0n) }; },
        async upload() {
          uploads.push(item.id);
          balance -= prices[index % prices.length] ?? 0n;
          return { id: item.id };
        },
      };
      items.push(item);
      return item;
    },
    async getBalance() { return { toFixed: () => balance.toString() }; },
    async fund(amount) { funding.push(amount); balance += BigInt(amount); return { id: "1".repeat(88) }; },
  };
  const prepare = () => preparePublication(client, [{ path: "index.html", data: Buffer.from("site"), type: "text/html" }]);
  return { client, prepare, funding, uploads, data, items };
}

test("publication admits only closed, merged PRs targeting main", () => {
  assert.equal(isMergedMainEvent({ action: "closed", pull_request: { merged: true, base: { ref: "main" } } }), true);
  for (const event of [
    null, {}, { ref: "refs/heads/main" },
    { action: "opened", pull_request: { merged: true, base: { ref: "main" } } },
    { action: "closed", pull_request: { merged: false, base: { ref: "main" } } },
    { action: "closed", pull_request: { merged: true, base: { ref: "other" } } },
  ]) assert.equal(isMergedMainEvent(event), false);
});

test("manual funding mode never uploads, including when the target is already met", async () => {
  for (const balance of [0n, 100n]) {
    const f = fixture(undefined, balance);
    assert.equal(await publishPrepared(f.client, await f.prepare(), { maxUpload: 30n, fundTo: 100n, fundOnly: true }), null);
    assert.deepEqual(f.uploads, []);
    assert.deepEqual(f.funding, balance === 0n ? ["100"] : []);
  }
});

test("USDC uses exact six-decimal arithmetic and rejects unsafe inputs", () => {
  assert.equal(usdc("0.000001"), 1n);
  assert.equal(usdc("1.25"), 1_250_000n);
  for (const value of ["-1", "1e6", "NaN", "Infinity", "0.0000001", " 1", "01", ""]) {
    assert.throws(() => usdc(value));
  }
});

test("signed file IDs form an index manifest, uploaded last with no automatic funding", async () => {
  const f = fixture();
  const plan = await f.prepare();
  const manifest = JSON.parse(String(f.data.at(-1)));
  assert.equal(manifest.manifest, "irys/paths");
  assert.equal(manifest.index.path, "index.html");
  assert.equal(manifest.paths["index.html"].id, plan[0].id);
  assert.equal(f.uploads.length, 0);
  assert.equal(await publishPrepared(f.client, plan, { maxUpload: 30n }), plan[1].id);
  assert.deepEqual(f.uploads, plan.map((item) => item.id));
  assert.deepEqual(f.funding, []);
});

test("insufficient prepaid balance never implicitly spends from wallet", async () => {
  const f = fixture(undefined, 0n);
  await assert.rejects(publishPrepared(f.client, await f.prepare(), { maxUpload: 30n }), /Insufficient/);
  assert.deepEqual(f.funding, []);
  assert.deepEqual(f.uploads, []);
});

test("manual funding tops up only the shortfall and is reused on another deployment", async () => {
  const f = fixture(undefined, 10n);
  await publishPrepared(f.client, await f.prepare(), { maxUpload: 30n, fundTo: 100n });
  assert.deepEqual(f.funding, ["90"]);
  await publishPrepared(f.client, await f.prepare(), { maxUpload: 30n });
  assert.deepEqual(f.funding, ["90"]);
});

test("excessive quotes and funding targets fail before payment or upload", async () => {
  const f = fixture(undefined, 0n);
  const plan = await f.prepare();
  for (const options of [
    { maxUpload: 29n, fundTo: 100n },
    { maxUpload: 30n, fundTo: 101n, maxFund: 100n },
    { maxUpload: 30n, fundTo: 20n },
  ]) await assert.rejects(publishPrepared(f.client, plan, options));
  assert.deepEqual(f.funding, []);
  assert.deepEqual(f.uploads, []);
});

test("a rising quote stops further uploads before the manifest is published", async () => {
  const f = fixture();
  const plan = await f.prepare();
  let calls = 0;
  f.items[1].getPrice = async () => ({ toFixed: () => ++calls === 1 ? "20" : "21" });
  await assert.rejects(publishPrepared(f.client, plan, { maxUpload: 30n }), /Updated quote/);
  assert.equal(f.uploads.length, 1);
});

test("ambiguous funding failures are not retried", async () => {
  const f = fixture(undefined, 0n);
  let calls = 0;
  f.client.fund = async () => { calls++; throw new Error("transfer status unknown"); };
  await assert.rejects(publishPrepared(f.client, await f.prepare(), { maxUpload: 30n, fundTo: 100n }));
  assert.equal(calls, 1);
  assert.equal(f.uploads.length, 0);
});

test("publisher admits only the hosted five-file artifact, never extra files", () => {
  const root = mkdtempSync(join(tmpdir(), "irys-site-"));
  try {
    mkdirSync(join(root, "pkg"));
    for (const path of Object.keys(FILES)) writeFileSync(join(root, path), "fixture");
    writeFileSync(join(root, "index.html"), '<html data-fixture="hosted">');
    writeFileSync(join(root, "pkg/relay_crypto_bg.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
    assert.equal(loadSite(root).length, 5);
    writeFileSync(join(root, "app.js"), "/Users/example/build-path");
    assert.throws(() => loadSite(root), /embedded user-home path/);
    writeFileSync(join(root, "app.js"), "fixture");
    writeFileSync(join(root, "wallet.json"), "not publishable");
    assert.throws(() => loadSite(root), /Unexpected site file/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
