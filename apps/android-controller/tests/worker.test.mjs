import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app/src/main/assets/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = new Map();
  const calls = [];
  const self = {
    location: { origin: 'http://127.0.0.1:18787' },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => calls.push('skipWaiting'),
    clients: { claim: async () => calls.push('claim') },
  };
  vm.runInNewContext(source, { self, URL, Response, Promise });
  return { handlers, calls };
}
test('worker activates and claims its scope without installing a cache', async () => {
  const { handlers, calls } = worker();
  for (const name of ['install', 'activate']) {
    let pending;
    handlers.get(name)({ waitUntil: (promise) => { pending = promise; } });
    await pending;
  }
  assert.deepEqual(calls, ['skipWaiting', 'claim']);
});
test('only same-origin GET to the exact proof route gets a synthetic response', async () => {
  const { handlers } = worker();
  let response;
  handlers.get('fetch')({
    request: { method: 'GET', url: 'http://127.0.0.1:18787/probe-scope/proof' },
    respondWith: (promise) => { response = promise; },
  });
  const result = await response;
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'local-controller-worker-v1');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  for (const [method, url] of [
    ['GET', 'http://127.0.0.1:18787/'],
    ['GET', 'http://127.0.0.1:18787/probe-scope/index.html'],
    ['GET', 'http://127.0.0.1:18787/probe-scope/proof?q=1'],
    ['GET', 'https://untrusted.example/probe-scope/proof'],
    ['POST', 'http://127.0.0.1:18787/probe-scope/proof'],
  ]) {
    handlers.get('fetch')({ request: { method, url }, respondWith: () => assert.fail(`Unexpected interception: ${method} ${url}`) });
  }
});
