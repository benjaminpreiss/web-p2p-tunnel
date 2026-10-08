import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { stageController } from "../prepare.ts";
import { FILES } from "../../browser/export.ts";

const source = fileURLToPath(new URL("../../browser/", import.meta.url));
test("stages exactly the hosted artifact and records source and asset digests outside APK assets", () => {
  const output = mkdtempSync(join(realpathSync(tmpdir()), "controller-stage-"));
  try {
    stageController(source, output);
    const root = join(output, "assets/controller");
    assert.deepEqual(readdirSync(join(output, "assets")), ["controller"]);
    assert.deepEqual(readdirSync(root).sort(), ["app.js", "index.html", "pkg", "style.css"]);
    assert.deepEqual(readdirSync(join(root, "pkg")).sort(), ["relay_crypto.js", "relay_crypto_bg.wasm"]);
    const receipt = new Map(readFileSync(join(output, "controller.properties"), "utf8").trim().split("\n").map((line) => {
      const [key, value] = line.split("=");
      return [key!, value!];
    }));
    for (const file of FILES) {
      const bytes = readFileSync(join(root, file));
      assert.equal(receipt.get(`asset.${file}`), createHash("sha256").update(bytes).digest("hex"));
      assert.deepEqual(bytes, readFileSync(join(source, "dist/hosted-browser", file)));
    }
    assert.match(readFileSync(join(root, "index.html"), "utf8"), /data-fixture="hosted"/);
    const app = readFileSync(join(source, "src/app.ts"));
    assert.equal(receipt.get("source.src/app.ts"), createHash("sha256").update(app).digest("hex"));
    assert.ok(!readFileSync(join(output, "controller.properties"), "utf8").includes("/Users/"));
    // Unrelated output must not silently become APK content or be deleted.
    writeFileSync(join(root, "unexpected.txt"), "keep");
    assert.throws(() => stageController(source, output), /Unexpected output file/);
    assert.equal(readFileSync(join(root, "unexpected.txt"), "utf8"), "keep");
  } finally { rmSync(output, { recursive: true, force: true }); }
});
