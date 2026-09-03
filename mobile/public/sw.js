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

const CACHE = "quiet-shell-v2";

// Everything the shell needs that is not written into the HTML.
const EXTRAS = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

/*
 * Caching index.html without its script and stylesheet is worse than caching
 * nothing: the navigation succeeds, the assets 404, and you get a white screen
 * with no error to explain it. Vite hashes those filenames at build time, so
 * the worker cannot list them here — it reads them out of the shell it has
 * just fetched, which also means a new build heals the cache by itself.
 */
function assetsIn(html) {
  return [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+/g) ?? [])];
}

async function precache() {
  const res = await fetch("/index.html", { cache: "reload" });
  if (!res.ok) throw new Error("shell unavailable: " + res.status);

  const cache = await caches.open(CACHE);
  const html = await res.clone().text();
  await cache.put("/index.html", res);

  // Individually, so one missing icon cannot fail the whole install the way
  // cache.addAll would.
  await Promise.allSettled(
    [...assetsIn(html), ...EXTRAS].map(async (url) => {
      const r = await fetch(url, { cache: "reload" });
      if (r.ok) await cache.put(url, r);
    }),
  );
}

/* Is the cached shell actually runnable, or is it HTML pointing at assets we
 * do not have? Only the first is worth serving. */
async function shellIsUsable(cache) {
  const shell = await cache.match("/index.html");
  if (!shell) return null;
  const assets = assetsIn(await shell.clone().text());
  for (const url of assets) if (!(await cache.match(url))) return null;
  return shell;
}

const OFFLINE_PAGE = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quiet</title>
<style>html{color-scheme:dark}body{margin:0;height:100vh;display:grid;place-content:center;
gap:10px;text-align:center;background:#121214;color:#8d8d8a;
font:15px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif}
b{color:#f2f2f0;font-size:17px;font-weight:600}</style>
<b>Quiet can't reach the server</b>
<div>Start it with <code>pnpm server</code>, then reload.</div>`;

const offlineResponse = () =>
  new Response(OFFLINE_PAGE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });

self.addEventListener("install", (event) => {
  event.waitUntil(precache().catch(() => {}));
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
          // Both clones must be taken now: once the response is returned the
          // browser starts reading its body and it can no longer be cloned.
          const forCache = res.clone();
          const forParse = res.clone();
          // Re-derive the asset list from the page we just served, so a rebuild
          // is cached complete before the next time there is no signal.
          event.waitUntil(
            forParse
              .text()
              .then((html) =>
                caches.open(CACHE).then((c) =>
                  Promise.allSettled(
                    assetsIn(html).map((u) =>
                      c.match(u).then((hit) => (hit ? null : fetch(u).then((r) => r.ok && c.put(u, r)))),
                    ),
                  ).then(() => c.put("/index.html", forCache)),
                ),
              )
              .catch(() => {}),
          );
          return res;
        })
        .catch(() =>
          caches
            .open(CACHE)
            .then(shellIsUsable)
            .then((shell) => shell ?? offlineResponse()),
        ),
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
