// Build only public browser crypto assets, never credentials or session metadata.
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(directory, "../..");
const profile = process.argv[2] ?? "--release";
if (process.argv.length > 3 || !["--release", "--dev"].includes(profile)) {
  console.error("Usage: node apps/browser/build.ts [--release|--dev]");
  process.exit(1);
}

// Rust panic/debug strings can otherwise disclose the machine owner's name.
// Later prefixes take precedence, so the repository path is mapped last.
const mappings = [
  [homedir(), "/home/build"],
  [process.env.CARGO_HOME || resolve(homedir(), ".cargo"), "/build/cargo"],
  [process.env.RUSTUP_HOME || resolve(homedir(), ".rustup"), "/build/rustup"],
  [root, "/workspace"],
];
const flags = mappings.map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
// Explicit flags rather than inheriting potentially identifying local build flags.
// Cargo's encoded form supports paths containing spaces.
const result = spawnSync("wasm-pack", [
  "build", resolve(directory, "crypto"), "--target", "web", "--out-dir", "../pkg",
  profile, "--", "--locked",
], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN || "stable",
    CARGO_ENCODED_RUSTFLAGS: flags.join("\u001f"),
  },
});
if (result.error) console.error("Could not start wasm-pack. Install it and ensure it is on PATH.");
process.exit(result.status ?? 1);
