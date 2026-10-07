import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildBundle, exportSite, FILES } from "../export.ts";

function fixture() {
  // macOS temp directories may have system symlink aliases.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "browser-export-")));
  const source = join(root, "source");
  const destination = join(root, "output");
  for (const name of FILES) {
    mkdirSync(dirname(join(source, name)), { recursive: true });
    writeFileSync(join(source, name), "fixture");
  }
  writeFileSync(join(source, "index.html"), '<html data-fixture="local"></html>');
  writeFileSync(join(source, "pkg/relay_crypto_bg.wasm"), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(source, "session.json"), '"not for publication"');
  return { root, source, destination, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("exports only the five static assets, with hosted mode and external checksums", () => {
  const f = fixture();
  try {
    for (const name of [...FILES, "session.json"]) {
      const target = join(f.source, "dist/frontend", name);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(f.source, name), target);
    }
    const assets = exportSite(f.source);
    const output = join(f.source, "dist/irys-browser");
    assert.deepEqual(readdirSync(output, { recursive: true }).filter((name) => name !== "pkg").sort(), [...FILES].sort());
    assert.match(readFileSync(join(output, "index.html"), "utf8"), /data-fixture="hosted"/);
    assert.match(readFileSync(join(f.source, "index.html"), "utf8"), /data-fixture="local"/);
    assert.match(readFileSync(join(f.source, "dist/local-browser/index.html"), "utf8"), /data-fixture="local"/);
    const expected = [...assets].map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`).join("");
    assert.equal(readFileSync(join(f.source, "dist/irys-browser.SHA256SUMS"), "utf8"), expected);
  } finally { f.close(); }
});

test("missing or malformed WASM cannot produce an incomplete bundle", () => {
  const f = fixture();
  try {
    const wasm = join(f.source, "pkg/relay_crypto_bg.wasm");
    writeFileSync(wasm, "invalid");
    assert.throws(() => buildBundle(f.source, f.destination), /Invalid WASM/);
    unlinkSync(wasm);
    assert.throws(() => buildBundle(f.source, f.destination), /Missing asset/);
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});

test("unexpected output is preserved and blocks export", () => {
  const f = fixture();
  try {
    mkdirSync(f.destination);
    const extra = join(f.destination, "session.json");
    writeFileSync(extra, "not for publication");
    assert.throws(() => buildBundle(f.source, f.destination), /Unexpected output/);
    assert.equal(readFileSync(extra, "utf8"), "not for publication");
    assert.equal(existsSync(join(f.destination, "index.html")), false);
  } finally { f.close(); }
});

test("embedded user-home paths are rejected without writing output", () => {
  const f = fixture();
  try {
    for (const path of ["/Users/example/project", "/home/example/project", "C:\\Users\\example\\project"]) {
      writeFileSync(join(f.source, "app.js"), path);
      assert.throws(() => buildBundle(f.source, f.destination), /Embedded user-home path/);
    }
    assert.equal(existsSync(f.destination), false);
    writeFileSync(join(f.source, "app.js"), "/home/build/project");
    assert.doesNotThrow(() => buildBundle(f.source, f.destination));
  } finally { f.close(); }
});

test("symlinked output ancestors and checksum files are rejected", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "actual"));
    symlinkSync(join(f.root, "actual"), join(f.root, "alias"), "dir");
    assert.throws(() => buildBundle(f.source, join(f.root, "alias/output")), /symlinked/);
    mkdirSync(join(f.source, "dist"));
    symlinkSync(join(f.source, "session.json"), join(f.source, "dist/irys-browser.SHA256SUMS"));
    assert.throws(() => exportSite(f.source), /symlinked/);
    assert.equal(existsSync(join(f.source, "dist/irys-browser")), false);
  } finally { f.close(); }
});

test("symlinked source directories cannot leak outside files", () => {
  const f = fixture();
  try {
    rmSync(join(f.source, "pkg"), { recursive: true });
    mkdirSync(join(f.root, "private"));
    symlinkSync(join(f.root, "private"), join(f.source, "pkg"), "dir");
    assert.throws(() => buildBundle(f.source, f.destination), /symlinked/);
    assert.equal(existsSync(f.destination), false);
  } finally { f.close(); }
});
