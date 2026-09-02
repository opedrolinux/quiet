/*
 * Service worker for the Quiet PWA.
 *
 * Two jobs. It is what makes iOS treat this as an installable app rather than a
 * bookmark, and it keeps the app shell available with no signal — which is the
 * whole point of taking notes in a lecture hall.
 *
 * It deliberately does NOT cache API traffic. A stale note served from a cache
 * would be worse than no note at all: the app would show yesterday's text and
 * have no way to know it was wrong.
 */

const CACHE = "quiet-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html"])));
  // Take over straight away rather than waiting for every tab to close, so a
  // deployed fix reaches the phone on the next launch instead of eventually.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Sync and sign-in must always hit the network.
  if (url.pathname.startsWith("/sync") || url.pathname.startsWith("/auth")) return;

  // Navigations: fresh if possible, cached shell if not. The other way round
  // would pin the app at whatever version first installed.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Assets carry a content hash in the filename, so a cache hit is always the
  // right answer and a miss is worth storing.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
