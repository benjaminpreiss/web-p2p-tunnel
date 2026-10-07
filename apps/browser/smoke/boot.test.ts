// Executes the built app and real WASM in a minimal browser-API harness.
// This checks startup/asset routing, not rendering or real WebRTC connectivity.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createContext, SourceTextModule } from "node:vm";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { loadSite } from "../../../deployment/irys/publication.ts";

test("Vite hosted output satisfies the publisher allowlist; local output cannot publish", () => {
  const hosted = fileURLToPath(new URL("../dist/irys-browser/", import.meta.url));
  const local = fileURLToPath(new URL("../dist/local-browser/", import.meta.url));
  const assets = loadSite(hosted);
  assert.equal(assets.length, 5);
  assert.equal(assets.find((asset) => asset.path === "style.css")?.type, "text/css; charset=utf-8");
  assert.throws(() => loadSite(local), /Only the hosted frontend/);
});

class Element {
  textContent = "";
  disabled = true;
  hidden = true;
  value = "test";
  addEventListener() {}
}
class Paragraph extends Element {}
class Pre extends Element {}
class Button extends Element {}
class Input extends Element {}
class Textarea extends Element {}

for (const mode of ["hosted", "local"] as const) {
  test(`built ${mode} page boots real PQ WASM at a nested manifest URL without connecting`, async () => {
    const directory = fileURLToPath(new URL(`../dist/${mode === "hosted" ? "irys-browser" : "local-browser"}/`, import.meta.url));
    const html = readFileSync(`${directory}index.html`, "utf8");
    assert.ok(html.includes(`data-fixture="${mode}"`));
    assert.match(html, /src="\.\/app\.js"/);
    assert.match(html, /href="\.\/style\.css"/);
    assert.ok(!html.includes("/src/") && !html.includes(".ts\""));
    const page = new URL("https://example.invalid/nested/manifest/");
    const requests: string[] = [];
    let connections = 0;
    const status = new Paragraph();
    const output = new Pre();
    const button = new Button();
    const elements = new Map<string, Element>([
      ["#status", status], ["#log", output], ["#run", button],
      ["#message", new Input()], ["#descriptor", new Textarea()], ["#hosted-connection", new Element()],
    ]);
    for (const selector of elements.keys()) {
      assert.ok(html.includes(`id="${selector.slice(1)}"`), `Built HTML is missing ${selector}`);
    }
    const context = createContext({
      document: {
        baseURI: page.href, documentElement: { dataset: { fixture: mode } },
        querySelector: (selector: string) => elements.get(selector),
        createElement: (tag: string) => {
          assert.equal(tag, "link");
          return { relList: { supports: () => true } };
        },
      },
      HTMLElement: Element, HTMLParagraphElement: Paragraph, HTMLPreElement: Pre,
      HTMLButtonElement: Button, HTMLInputElement: Input, HTMLTextAreaElement: Textarea,
      window: { isSecureContext: true, dispatchEvent: () => true }, Event, location: page, navigator: { userAgent: "offline-bundle-test" },
      performance, TextEncoder, TextDecoder, URL, Request, Response, Headers, AbortSignal,
      WebAssembly, setTimeout, clearTimeout, console,
      RTCPeerConnection: class { constructor() { connections++; throw new Error("Unexpected automatic connection"); } },
      fetch: async (input: string | URL) => {
        const url = new URL(String(input), page);
        requests.push(url.href);
        if (url.href === new URL("pkg/relay_crypto_bg.wasm", page).href) {
          return new Response(readFileSync(`${directory}pkg/relay_crypto_bg.wasm`), { headers: { "Content-Type": "application/wasm" } });
        }
        if (mode === "local" && url.pathname === "/session.json") {
          return Response.json({ multiaddr: "test-descriptor", mode: "desktop", label: "web-p2p-tunnel.relay-spike.v1", messageLimit: 8192 });
        }
        throw new Error("Unexpected request in browser boot");
      },
    });
    const glueURL = new URL("pkg/relay_crypto.js", page).href;
    const glue = new SourceTextModule(readFileSync(`${directory}pkg/relay_crypto.js`, "utf8"), {
      context, identifier: glueURL, initializeImportMeta(meta) { meta.url = glueURL; },
    });
    await glue.link(() => { throw new Error("Unexpected crypto module import"); });
    const app = new SourceTextModule(readFileSync(`${directory}app.js`, "utf8"), {
      context, identifier: new URL("app.js", page).href,
      initializeImportMeta(meta) { meta.url = new URL("app.js", page).href; },
      importModuleDynamically: async (specifier) => {
        assert.equal(specifier, glueURL);
        requests.push(specifier);
        await glue.evaluate();
        return glue;
      },
    });
    await app.link(() => { throw new Error("Unexpected bundled static import"); });
    await app.evaluate();
    const deadline = Date.now() + 5000;
    while (button.disabled && !status.textContent.startsWith("Setup failed") && Date.now() < deadline) await delay(10);
    assert.equal(button.disabled, false, output.textContent);
    assert.match(output.textContent, /Saorsa PQ WASM loaded/);
    assert.equal(connections, 0);
    assert.deepEqual(requests, [
      glueURL, new URL("pkg/relay_crypto_bg.wasm", page).href,
      ...(mode === "local" ? [new URL("/session.json", page).href] : []),
    ]);
  });
}
