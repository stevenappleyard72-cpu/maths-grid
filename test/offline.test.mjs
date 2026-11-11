import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const workerSource = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const origin = 'https://sumsurge.test';
const html = '<!doctype html><html><head><link href="/assets/index-a12.css" rel="stylesheet"></head><body><script src="/assets/index-b34.js" type="module"></script></body></html>';

function createWorker() {
  const listeners = new Map();
  const stores = new Map();
  const fetched = [];
  const resources = new Map([
    ['/', { body: html, type: 'text/html' }],
    ['/index.html', { body: html, type: 'text/html' }],
    ['/manifest.webmanifest', { body: '{"name":"Sum Surge"}', type: 'application/manifest+json' }],
    ['/icon.svg', { body: '<svg/>', type: 'image/svg+xml' }],
    ['/assets/index-a12.css', { body: 'body { color: mintcream; }', type: 'text/css' }],
    ['/assets/index-b34.js', { body: 'console.log("Sum Surge loaded");', type: 'application/javascript' }],
  ]);
  const state = { offline: false, skippedWaiting: false, claimed: false };
  const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  const networkFetch = async (request) => {
    const key = keyOf(request);
    fetched.push(key);
    if (state.offline) throw new TypeError('Network is offline');
    const resource = resources.get(new URL(key).pathname);
    return new Response(resource?.body ?? 'Asset not found', {
      status: resource ? 200 : 404,
      headers: { 'content-type': resource?.type ?? 'text/plain' },
    });
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const items = stores.get(name);
      return {
        async match(request) { return items.get(keyOf(request))?.clone(); },
        async put(request, response) { items.set(keyOf(request), response.clone()); },
        async addAll(requests) {
          for (const request of requests) {
            const response = await networkFetch(request);
            if (!response.ok) throw new TypeError('Cannot cache an unsuccessful response');
            items.set(keyOf(request), response.clone());
          }
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const context = vm.createContext({
    URL, caches, fetch: networkFetch,
    self: {
      location: { origin },
      addEventListener(type, callback) { listeners.set(type, callback); },
      async skipWaiting() { state.skippedWaiting = true; },
      clients: { async claim() { state.claimed = true; } },
    },
  });
  vm.runInContext(workerSource, context, { filename: 'public/sw.js' });
  return {
    state, stores, fetched, caches,
    cacheName: vm.runInContext('CACHE_NAME', context),
    async lifecycle(type) {
      let pending;
      listeners.get(type)({ waitUntil(value) { pending = value; } });
      await pending;
    },
    request(path, { method = 'GET', mode = 'cors' } = {}) {
      let response;
      listeners.get('fetch')({
        request: { url: new URL(path, origin).href, method, mode },
        respondWith(value) { response = Promise.resolve(value); },
      });
      return response;
    },
  };
}

test('install precaches the shell and the hashed JS/CSS referenced by the built HTML', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  const cachedPaths = [...worker.stores.get(worker.cacheName).keys()].map((url) => new URL(url).pathname);
  assert.deepEqual(cachedPaths.sort(), [
    '/', '/index.html', '/manifest.webmanifest', '/icon.svg',
    '/assets/index-a12.css', '/assets/index-b34.js',
  ].sort());
  assert.equal(worker.state.skippedWaiting, true);
});

test('an installed game opens offline with cached HTML and the actual cached JavaScript', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  worker.state.offline = true;
  const page = await worker.request('/play', { mode: 'navigate' });
  assert.equal(await page.text(), html);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const script = await worker.request('/assets/index-b34.js');
  assert.equal(await script.text(), 'console.log("Sum Surge loaded");');
  assert.match(script.headers.get('content-type'), /application\/javascript/);
});

test('a missing script never receives the HTML fallback or gets cached as a successful asset', async () => {
  const worker = createWorker();
  await worker.lifecycle('install');
  const response = await worker.request('/assets/missing.js');
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Asset not found');
  const cache = await worker.caches.open(worker.cacheName);
  assert.equal(await cache.match('/assets/missing.js'), undefined);
  worker.state.offline = true;
  await assert.rejects(worker.request('/assets/missing.js'), /Network is offline/);
});

test('API calls, writes, and requests to another origin bypass the service worker', () => {
  const worker = createWorker();
  assert.equal(worker.request('/api/leaderboard'), undefined);
  assert.equal(worker.request('/api/score', { method: 'POST' }), undefined);
  assert.equal(worker.request('/submit', { method: 'POST' }), undefined);
  assert.equal(worker.request('https://elsewhere.test/assets/game.js'), undefined);
  assert.equal(worker.fetched.length, 0);
  assert.equal(worker.stores.size, 0);
});

test('activation removes obsolete game caches and preserves unrelated application caches', async () => {
  const worker = createWorker();
  for (const name of [worker.cacheName, 'mathsgrid-cache-v3', 'sumsurge-old-build', 'another-app-v1']) {
    await worker.caches.open(name);
  }
  await worker.lifecycle('activate');
  assert.deepEqual((await worker.caches.keys()).sort(), [worker.cacheName, 'another-app-v1'].sort());
  assert.equal(worker.state.claimed, true);
});
