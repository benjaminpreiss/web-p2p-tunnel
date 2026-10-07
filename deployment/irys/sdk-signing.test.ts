import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { preparePublication } from "./publication.ts";

const require = createRequire(import.meta.url);
const { BaseNodeIrys }: typeof import("@irys/upload/base") = require("@irys/upload/base");
const { USDCSolana }: typeof import("@irys/upload-solana") = require("@irys/upload-solana");
const { Keypair }: typeof import("@solana/web3.js") = require("@solana/web3.js");

test("prepares signed files and manifest with the actual pinned SDK, offline", async () => {
  // Public, deterministic test seed, never a funded account or user credential.
  const wallet = Keypair.fromSeed(new Uint8Array(32).fill(42)).secretKey;
  const irys = new BaseNodeIrys({
    url: "https://example.invalid",
    getTokenConfig: (client) => new USDCSolana({ irys: client, wallet }),
  });
  // Do not build()/ready(): those fetch chain metadata. Signing needs only the
  // real local token signer, not RPC state or payment methods.
  irys.tokenConfig = new USDCSolana({ irys, wallet });
  irys.api.get = async () => { throw new Error("Unexpected network request in offline signing test"); };
  irys.api.post = async () => { throw new Error("Unexpected network request in offline signing test"); };
  const createTransaction = irys.createTransaction.bind(irys);
  irys.createTransaction = (data, options) => createTransaction(data, { ...options, anchor: "a".repeat(32) });
  const probe = irys.createTransaction("<!doctype html>test", { tags: [{ name: "Content-Type", value: "text/html" }] });
  await probe.sign();
  const id = probe.id;
  assert.equal(await probe.isValid(), true);
  await Promise.resolve();
  assert.equal(probe.id, id);
  assert.equal(probe.rawId.length, 32);
  assert.equal(id.length, 44); // Fixed anchor/payload: regression for the old 43-character gate.
  const plan = await preparePublication(irys, [
    { path: "index.html", data: Buffer.from("<!doctype html>test"), type: "text/html" },
  ]);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].id, id);
  assert.equal(plan[1].path, "manifest.json");
  for (const item of plan) {
    assert.ok(item.tx instanceof irys.IrysTransaction);
    assert.equal(await item.tx.isValid(), true);
  }
  const manifestTx = plan[1].tx;
  assert.ok(manifestTx instanceof irys.IrysTransaction);
  const manifest = JSON.parse(manifestTx.rawData.toString());
  assert.equal(manifest.paths["index.html"].id, plan[0].id);
});
