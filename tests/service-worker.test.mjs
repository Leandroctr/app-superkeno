import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const ORIGIN = "https://pwa.app-bigpix.com";
const swSource = readFileSync("public/sw.js", "utf8");

function requestFor(path, overrides = {}) {
  return {
    destination: "",
    headers: new Headers(),
    method: "GET",
    mode: "cors",
    url: new URL(path, ORIGIN).href,
    ...overrides,
  };
}

function cacheKey(input) {
  return new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
}

class MemoryCache {
  constructor() {
    this.entries = new Map();
  }

  async addAll(urls) {
    for (const url of urls) {
      this.entries.set(cacheKey(url), new Response(`precache:${url}`));
    }
  }

  async match(input) {
    const response = this.entries.get(cacheKey(input));
    return response?.clone();
  }

  async put(input, response) {
    this.entries.set(cacheKey(input), response.clone());
  }
}

class MemoryCacheStorage {
  constructor() {
    this.caches = new Map();
  }

  async open(name) {
    if (!this.caches.has(name)) {
      this.caches.set(name, new MemoryCache());
    }
    return this.caches.get(name);
  }

  async keys() {
    return [...this.caches.keys()];
  }

  async delete(name) {
    return this.caches.delete(name);
  }
}

function loadServiceWorker(fetchImpl) {
  const listeners = new Map();
  const cacheStorage = new MemoryCacheStorage();
  const calls = { claim: 0, skipWaiting: 0 };
  const self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    clients: {
      async claim() {
        calls.claim += 1;
      },
    },
    location: { origin: ORIGIN },
    skipWaiting() {
      calls.skipWaiting += 1;
    },
  };

  vm.runInNewContext(swSource, {
    URL,
    caches: cacheStorage,
    fetch: fetchImpl,
    self,
    Set,
  });

  async function dispatchLifecycle(type) {
    let pending;
    listeners.get(type)({
      waitUntil(promise) {
        pending = promise;
      },
    });
    await pending;
  }

  async function dispatchFetch(request) {
    let responsePromise;
    listeners.get("fetch")({
      request,
      respondWith(promise) {
        responsePromise = Promise.resolve(promise);
      },
    });

    return {
      handled: Boolean(responsePromise),
      response: responsePromise ? await responsePromise : undefined,
    };
  }

  return { cacheStorage, calls, dispatchFetch, dispatchLifecycle };
}

test("navigation uses the network before an old cached shell and refreshes the cache", async () => {
  let fetchCount = 0;
  const worker = loadServiceWorker(async () => {
    fetchCount += 1;
    return new Response("new shell", { status: 200 });
  });
  const cache = await worker.cacheStorage.open("app-big-v2");
  await cache.put("/", new Response("old shell"));

  const result = await worker.dispatchFetch(requestFor("/", { mode: "navigate" }));

  assert.equal(result.handled, true);
  assert.equal(await result.response.text(), "new shell");
  assert.equal(await (await cache.match("/")).text(), "new shell");
  assert.equal(fetchCount, 1);
});

test("navigation falls back to the cached shell when the network fails", async () => {
  const worker = loadServiceWorker(async () => {
    throw new TypeError("offline");
  });
  const cache = await worker.cacheStorage.open("app-big-v2");
  await cache.put("/", new Response("offline shell"));

  const result = await worker.dispatchFetch(requestFor("/page", { mode: "navigate" }));

  assert.equal(result.handled, true);
  assert.equal(await result.response.text(), "offline shell");
});

test("versioned static assets preserve cache-first behavior", async () => {
  let fetchCount = 0;
  const worker = loadServiceWorker(async () => {
    fetchCount += 1;
    return new Response("network asset");
  });
  const cache = await worker.cacheStorage.open("app-big-v2");
  const request = requestFor("/_next/static/chunks/app.js", { destination: "script" });
  await cache.put(request, new Response("cached asset"));

  const result = await worker.dispatchFetch(request);

  assert.equal(result.handled, true);
  assert.equal(await result.response.text(), "cached asset");
  assert.equal(fetchCount, 0);
});

test("unversioned resources outside the static allowlist bypass runtime caching", async () => {
  const worker = loadServiceWorker(async () => new Response("network"));
  const result = await worker.dispatchFetch(
    requestFor("/private-image", { destination: "image" }),
  );

  assert.equal(result.handled, false);
  assert.deepEqual(await worker.cacheStorage.keys(), []);
});

for (const path of ["/admin", "/admin/settings", "/api/settings", "/api/admin/settings"]) {
  test(`${path} bypasses service worker caching`, async () => {
    const worker = loadServiceWorker(async () => new Response("network"));
    const result = await worker.dispatchFetch(requestFor(path, { mode: "navigate" }));

    assert.equal(result.handled, false);
    assert.deepEqual(await worker.cacheStorage.keys(), []);
  });
}

test("non-GET requests bypass service worker caching", async () => {
  const worker = loadServiceWorker(async () => new Response("network"));
  const result = await worker.dispatchFetch(
    requestFor("/", { method: "POST", mode: "navigate" }),
  );

  assert.equal(result.handled, false);
  assert.deepEqual(await worker.cacheStorage.keys(), []);
});

test("requests with Authorization bypass service worker caching", async () => {
  const worker = loadServiceWorker(async () => new Response("network"));
  const result = await worker.dispatchFetch(
    requestFor("/", {
      headers: new Headers({ Authorization: "Bearer test-only" }),
      mode: "navigate",
    }),
  );

  assert.equal(result.handled, false);
  assert.deepEqual(await worker.cacheStorage.keys(), []);
});

for (const [label, headers] of [
  ["private/no-store", { "Cache-Control": "private, no-store" }],
  ["Vary Cookie", { Vary: "Cookie" }],
  ["Set-Cookie", { "Set-Cookie": "session=test-only" }],
]) {
  test(`${label} responses never overwrite the public offline shell`, async () => {
    const worker = loadServiceWorker(async () => new Response("private shell", { headers }));
    const cache = await worker.cacheStorage.open("app-big-v2");
    await cache.put("/", new Response("public shell"));

    const result = await worker.dispatchFetch(requestFor("/", { mode: "navigate" }));

    assert.equal(await result.response.text(), "private shell");
    assert.equal(await (await cache.match("/")).text(), "public shell");
  });
}

test("activate removes only old app-big caches and claims clients", async () => {
  const worker = loadServiceWorker(async () => new Response("network"));
  for (const name of ["app-big-v0", "app-big-v1", "app-big-v2", "OneSignal", "other-app-v1"]) {
    await worker.cacheStorage.open(name);
  }

  await worker.dispatchLifecycle("activate");

  assert.deepEqual((await worker.cacheStorage.keys()).sort(), [
    "OneSignal",
    "app-big-v2",
    "other-app-v1",
  ]);
  assert.equal(worker.calls.claim, 1);
});

test("install keeps precache, skipWaiting and the existing production registration", async () => {
  const worker = loadServiceWorker(async () => new Response("network"));
  await worker.dispatchLifecycle("install");

  const cache = await worker.cacheStorage.open("app-big-v2");
  assert.ok(await cache.match("/"));
  assert.ok(await cache.match("/manifest.webmanifest"));
  assert.equal(worker.calls.skipWaiting, 1);

  const registerSource = readFileSync("components/service-worker-register.tsx", "utf8");
  const layoutSource = readFileSync("app/layout.tsx", "utf8");
  assert.match(registerSource, /process\.env\.NODE_ENV === "production"/);
  assert.match(registerSource, /navigator\.serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(layoutSource, /<ServiceWorkerRegister\s*\/>/);
});
