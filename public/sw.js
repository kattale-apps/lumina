/* Solar Switch service worker: keeps the app shell available without a connection.
 *
 * It caches pages and static assets only. It never touches Convex (other
 * origin) and holds no customer data: that lives in IndexedDB, written by the
 * app itself. Bump VERSION to drop old caches on the next visit.
 */
const VERSION = "solar-switch-v1";
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const FALLBACK = "/offline.html";
const FIELD = "/dashboard/field";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.addAll([FALLBACK]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function remember(cacheName, request, response) {
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Built assets are content-hashed, so a cached copy is always correct.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => remember(STATIC, request, res)))
    );
    return;
  }

  // Pages: prefer the network so people get new releases; fall back to what was seen last.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => remember(PAGES, request, res))
        .catch(async () => {
          const cache = await caches.open(PAGES);
          return (
            (await cache.match(request)) ||
            (await cache.match(FIELD)) ||
            (await cache.match(FALLBACK)) ||
            Response.error()
          );
        })
    );
    return;
  }

  // Page data requests and small files: serve the cached copy at once, refresh in the background.
  event.respondWith(
    caches.open(PAGES).then(async (cache) => {
      const hit = await cache.match(request);
      const refresh = fetch(request)
        .then((res) => remember(PAGES, request, res))
        .catch(() => hit || Response.error());
      return hit || refresh;
    })
  );
});
