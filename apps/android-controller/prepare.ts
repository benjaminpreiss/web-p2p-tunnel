// Build from the current working tree, then stage only the approved static assets.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { buildBundle, rejectSymlinkChain } from "../browser/export.ts";

const browser = fileURLToPath(new URL("../browser/", import.meta.url));
const generated = fileURLToPath(new URL("./generated/", import.meta.url));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function stageController(source: string, destination: string): void {
  rejectSymlinkChain(destination);
  const receipt = join(destination, "controller.properties");
  rejectSymlinkChain(receipt);
  const assets = buildBundle(join(source, "dist/frontend"), join(destination, "assets/controller"), "hosted");
  const sources = ["index.html", "package.json", "package-lock.json", "vite.config.ts",
    "tsconfig.json", "tsconfig.tools.json", "build.ts", "export.ts", "pkg/relay_crypto.js", "pkg/relay_crypto_bg.wasm"];
  function collect(relative: string): void {
    const directory = join(source, relative);
    rejectSymlinkChain(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) collect(name);
      else sources.push(name); // Validated below; source bytes never go into the APK.
    }
  }
  collect("src");
  const entries = [...assets].map(([name, bytes]) => `asset.${name}=${hash(bytes)}`);
  for (const name of sources.sort()) {
    const path = join(source, name);
    rejectSymlinkChain(path);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid frontend source input");
    // Source tooling contains privacy-scanner patterns; only its digest is kept.
    // Executable assets above still pass the full exporter's privacy checks.
    entries.push(`source.${name}=${hash(readFileSync(path))}`);
  }
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(receipt, entries.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const build = spawnSync("npm", ["--prefix", browser, "run", "build:frontend"], { stdio: "inherit" });
    if (build.error || build.status !== 0) throw new Error("Frontend build failed");
    stageController(browser, generated);
    console.log("Android controller staged: five fixed assets, hosted/manual-descriptor mode.");
    console.log("Now rebuild/run apps/android-controller in Android Studio. Nothing uploaded.");
  } catch {
    console.error("Controller preparation failed. Check browser dependencies, existing privacy-safe WASM and generated output. No upload performed.");
    process.exitCode = 1;
  }
}
