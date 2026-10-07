// Deliberately tiny localhost test app. No filesystem access or private data.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535");
const files = new Map([
  ["/", { type: "text/html; charset=utf-8", body: '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Hello through the encrypted tunnel</h1><p>This is public test content, not a private app.</p></body></html>' }],
  ["/style.css", { type: "text/css; charset=utf-8", body: "body { font-family: system-ui; color: #164b38; }" }],
]);
createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
  if (request.url === "/redirect") {
    response.writeHead(302, { Location: "/style.css", "Content-Length": "0" }); response.end(); return;
  }
  if (request.url === "/large") {
    response.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "4097" }); response.end("x".repeat(4097)); return;
  }
  const file = files.get(request.url ?? "");
  const body = file?.body ?? "Not found";
  response.writeHead(file ? 200 : 404, { "Content-Type": file?.type ?? "text/plain", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}).listen(port, "127.0.0.1", () => {
  console.log(`Public test fixture only: http://127.0.0.1:${port}/`);
  console.log("Paths: /, /style.css; negative checks: /redirect (must not follow), /large (must reject). Ctrl-C stops it.");
});
