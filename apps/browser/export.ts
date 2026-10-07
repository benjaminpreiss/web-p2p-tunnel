import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FILES = Object.freeze([
  "index.html", "app.js", "hosted-config.mjs",
  "pkg/relay_crypto.js", "pkg/relay_crypto_bg.wasm",
]);
const wasmHeader = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const userHomePath = /\/Users\/|\/home\/(?!build(?:\/|\x00))|[A-Za-z]:[\\/]Users[\\/]/;

function rejectSymlinkChain(path: string): void {
  let current = resolve(path);
  for (;;) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error("Refusing a symlinked asset or output path.");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function buildBundle(source: string, destination: string): Map<string, Buffer> {
  const assets = new Map<string, Buffer>();
  for (const name of FILES) {
    const path = join(source, name);
    rejectSymlinkChain(path);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Missing asset: ${name}; build WASM first.`);
    if (stat.size > 16 * 1024 * 1024) throw new Error(`Asset exceeds 16 MiB: ${name}`);
    const bytes = readFileSync(path);
    if (userHomePath.test(bytes.toString("latin1"))) {
      throw new Error(`Embedded user-home path in ${name}; rebuild with apps/browser/build.ts.`);
    }
    assets.set(name, bytes);
  }
  const html = new TextDecoder("utf-8", { fatal: true }).decode(assets.get("index.html")!);
  if (html.split('data-fixture="local"').length !== 2 || html.includes('data-fixture="hosted"')) {
    throw new Error("Expected exactly one local fixture marker in source HTML.");
  }
  assets.set("index.html", Buffer.from(html.replace('data-fixture="local"', 'data-fixture="hosted"')));
  if (!assets.get("pkg/relay_crypto_bg.wasm")!.subarray(0, 8).equals(wasmHeader)) {
    throw new Error("Invalid WASM file header.");
  }
  rejectSymlinkChain(destination);
  function checkOutput(relative = ""): void {
    const path = join(destination, relative);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new Error("Refusing a symlinked output entry.");
    if (stat.isDirectory()) {
      if (relative && relative !== "pkg") throw new Error("Unexpected output directory; review it manually.");
      for (const name of readdirSync(path)) checkOutput(relative ? `${relative}/${name}` : name);
    } else if (!stat.isFile() || !FILES.includes(relative)) {
      throw new Error("Unexpected output file; review it manually.");
    }
  }
  checkOutput();
  // Validate everything before writing; do not delete unexpected user files.
  for (const [name, bytes] of assets) {
    const path = join(destination, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  return assets;
}

export function exportSite(source: string): Map<string, Buffer> {
  const destination = join(source, "dist/irys-browser");
  const checksumPath = join(source, "dist/irys-browser.SHA256SUMS");
  rejectSymlinkChain(checksumPath);
  const checksumStat = lstatSync(checksumPath, { throwIfNoEntry: false });
  if (checksumStat && !checksumStat.isFile()) throw new Error("Invalid checksum output path.");
  const assets = buildBundle(source, destination);
  const checksums = [...assets].map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`).join("");
  writeFileSync(checksumPath, checksums);
  return assets;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const source = realpathSync(fileURLToPath(new URL(".", import.meta.url)));
    const assets = exportSite(source);
    for (const [name, bytes] of assets) console.log(`${bytes.length} bytes  ${name}`);
    console.log("Static bundle: apps/browser/dist/irys-browser/");
    console.log("Checksums: apps/browser/dist/irys-browser.SHA256SUMS (not an Irys manifest)");
    console.log("Nothing uploaded. No wallet or payment operation performed.");
  } catch {
    // Filesystem exceptions can contain personal absolute paths.
    console.error("Export failed. Check assets/output paths and rebuild with apps/browser/build.ts; embedded user-home paths are forbidden.");
    process.exitCode = 1;
  }
}
