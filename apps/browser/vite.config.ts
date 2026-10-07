import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readAsset, rejectSymlinkChain } from "./export.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const cryptoFiles = ["pkg/relay_crypto.js", "pkg/relay_crypto_bg.wasm"];

// Check before Vite can empty/write its generated output directory.
rejectSymlinkChain(fileURLToPath(new URL("./dist/frontend", import.meta.url)));

export default defineConfig(({ command }) => ({
  root,
  base: "./",
  publicDir: false, // Never copy arbitrary files into the publishable website.
  envPrefix: "UNUSED_PUBLIC_", // No secrets/config values are passed to frontend code.
  build: {
    outDir: "dist/frontend",
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
    modulePreload: false,
    target: "es2022",
    cssCodeSplit: false,
    rollupOptions: {
      output: { entryFileNames: "app.js", chunkFileNames: "[name].js", assetFileNames: "style.css" },
    },
  },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  plugins: [{
    name: "bounded-pq-assets",
    transformIndexHtml(html) {
      // Dev UI has no helper HTTP metadata server. Local production builds keep
      // their local marker; the exporter prepares separate local/hosted bundles.
      return command === "serve" ? html.replace('data-fixture="local"', 'data-fixture="hosted"') : html;
    },
    generateBundle() {
      for (const fileName of cryptoFiles) {
        this.emitFile({ type: "asset", fileName, source: readAsset(root, fileName) });
      }
    },
  }],
}));
