import assert from "node:assert/strict";
import test from "node:test";
import { appendHttpResponse, openHttpInspector } from "../src/http-inspector.ts";

test("localhost HTML is displayed as text, never assigned to an HTML sink", () => {
  let text = "";
  const output = {
    get textContent() { return text; },
    set textContent(value: string) { text = value; },
    set innerHTML(_value: string) { assert.fail("Executing target content is forbidden"); },
  };
  appendHttpResponse(output, "/", { status: 200, contentType: "text/html", body: new TextEncoder().encode("<script>stealToken()</script>") });
  assert.match(text, /<script>stealToken\(\)<\/script>/);
  assert.match(text, /HTTP 200/);
});

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const authorized = () => encode({ v: 1, type: "authorized", maxRequests: 16, maxBodyBytes: 4096 });

test("invalid grants make no exchange and rejected grants cannot yield an inspector", async () => {
  let exchanges = 0;
  const exchange = async () => { exchanges++; return encode({ v: 1, type: "error" }); };
  for (const token of ["", "short", "x".repeat(64)]) await assert.rejects(openHttpInspector(exchange, token));
  assert.equal(exchanges, 0);
  await assert.rejects(openHttpInspector(exchange, "a".repeat(64)), /authorization failed/);
  assert.equal(exchanges, 1);
});

test("an echo of an authorization record is not an authorization acknowledgement", async () => {
  await assert.rejects(openHttpInspector(async (record) => record, "a".repeat(64)), /authorization failed/);
});

test("unsafe paths are refused before exchanging an HTTP request", async () => {
  let exchanges = 0;
  const inspector = await openHttpInspector(async () => { exchanges++; return authorized(); }, "a".repeat(64));
  for (const path of ["http://example.invalid/", "//example.invalid/", "/\\evil", "/\r\nHost: evil", "/#fragment", "/" + "x".repeat(1024)]) {
    await assert.rejects(inspector.get(path));
  }
  assert.equal(exchanges, 1);
});

test("response mismatch or overflow permanently closes the inspector", async () => {
  for (const bad of [
    encode({ v: 1, type: "response", id: 2, status: 200, contentType: "text/plain", body: "" }),
    encode({ v: 1, type: "response", id: 1, status: 200, contentType: "text/plain", body: "AAAA".repeat(1366) }),
    new Uint8Array(8193),
    new TextEncoder().encode("not JSON"),
  ]) {
    let exchanges = 0;
    const inspector = await openHttpInspector(async () => ++exchanges === 1 ? authorized() : bad, "a".repeat(64));
    await assert.rejects(inspector.get("/"));
    await assert.rejects(inspector.get("/again"), /closed/);
    assert.equal(exchanges, 2);
  }
});

test("only sixteen sequential requests are admitted", async () => {
  let exchanges = 0;
  const inspector = await openHttpInspector(async () => {
    const id = exchanges++;
    return id === 0 ? authorized() : encode({ v: 1, type: "response", id, status: 200, contentType: "application/octet-stream", body: "AP8=" });
  }, "a".repeat(64));
  for (let i = 0; i < 16; i++) assert.deepEqual((await inspector.get("/")).body, Uint8Array.of(0, 255));
  await assert.rejects(inspector.get("/"), /limit/);
  assert.equal(exchanges, 17);
});

test("authorizes before requesting a resource and preserves response bytes", async () => {
  const requests: unknown[] = [];
  const inspector = await openHttpInspector(async (record) => {
    requests.push(JSON.parse(new TextDecoder().decode(record)));
    return requests.length === 1
      ? encode({ v: 1, type: "authorized", maxRequests: 16, maxBodyBytes: 4096 })
      : encode({ v: 1, type: "response", id: 1, status: 200, contentType: "text/html", body: "PGgxPkhlbGxvPC9oMT4=" });
  }, "a".repeat(64));
  const response = await inspector.get("/");
  assert.deepEqual(requests, [
    { v: 1, type: "authorize", token: "a".repeat(64) },
    { v: 1, type: "get", id: 1, path: "/" },
  ]);
  assert.equal(response.status, 200);
  assert.equal(new TextDecoder().decode(response.body), "<h1>Hello</h1>");
});
