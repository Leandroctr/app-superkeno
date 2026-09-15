const CACHE_PREFIX = "app-big-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const OFFLINE_FALLBACK_URL = "/";
const PRECACHE_URLS = [OFFLINE_FALLBACK_URL, "/manifest.webmanifest"];

function isPrivatePath(pathname) {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/")
  );
}

function hasAuthorizationHeader(request) {
  return request.headers.has("authorization");
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function isStaticAssetRequest(url) {
  return (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/_next/static/")
  );
}

function isSafeToCache(response) {
  if (!response.ok || response.redirected) {
    return false;
  }

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() || "";
  const vary = response.headers.get("vary")?.toLowerCase() || "";

  return (
    !cacheControl.includes("no-store") &&
    !cacheControl.includes("private") &&
    !response.headers.has("set-cookie") &&
    !vary.split(",").some((value) => {
      const header = value.trim();
      return header === "*" || header === "cookie" || header === "authorization";
    })
  );
}

async function networkFirstNavigation(request, url) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const networkResponse = await fetch(request);

    if (
      url.pathname === OFFLINE_FALLBACK_URL &&
      url.search === "" &&
      isSafeToCache(networkResponse)
    ) {
      await cache.put(OFFLINE_FALLBACK_URL, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    const offlineFallback = cachedResponse || (await cache.match(OFFLINE_FALLBACK_URL));

    if (offlineFallback) {
      return offlineFallback;
    }

    throw error;
  }
}

async function cacheFirstStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);

  if (isSafeToCache(networkResponse)) {
    await cache.put(request, networkResponse.clone());
  }

  return networkResponse;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || hasAuthorizationHeader(request)) {
    return;
  }

  if (!request.url.startsWith("http")) {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivatePath(url.pathname)) {
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  if (isStaticAssetRequest(url)) {
    event.respondWith(cacheFirstStaticAsset(request));
  }
});
