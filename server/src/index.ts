import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import {
  authenticate,
  publicUrl,
  requestSignIn,
  signInStatus,
  signOut,
  sweepExpired,
  verify,
} from "./auth.ts";
import { sync } from "./sync.ts";
import { readJson, send, type Reply } from "./http.ts";

/**
 * The Quiet sync server.
 *
 * No dependencies and no build step: Node 24 runs TypeScript directly and ships
 * `node:sqlite`, so this starts with `node server/src/index.ts` on a machine
 * that has nothing installed but Node. That is deliberate — it has to be easy
 * to leave running on the same desktop as the app.
 */

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
/** Built PWA, served to the phone. Absent during desktop-only development. */
const WEB_ROOT = resolve(process.env.QUIET_WEB_ROOT ?? "mobile/dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    if (method === "OPTIONS") return send(res, { status: 204 });

    if (path === "/health") {
      return send(res, { status: 200, json: { ok: true } });
    }

    if (path === "/auth/request" && method === "POST") {
      return send(res, await requestSignIn(await readJson(req)));
    }
    if (path === "/auth/verify" && method === "GET") {
      return send(res, verify(url.searchParams.get("token")));
    }
    if (path === "/auth/status" && method === "GET") {
      return send(res, signInStatus(url.searchParams.get("request_id")));
    }

    // Everything past here needs a device token.
    if (path === "/auth/me" || path === "/auth/signout" || path === "/sync") {
      const session = authenticate(req.headers.authorization);
      if (!session) return send(res, { status: 401, json: { error: "not signed in" } });

      if (path === "/auth/me") {
        return send(res, { status: 200, json: { email: session.email } });
      }
      if (path === "/auth/signout" && method === "POST") {
        return send(res, signOut(session));
      }
      if (path === "/sync" && method === "POST") {
        return send(res, sync(session, await readJson(req)));
      }
      return send(res, { status: 405, json: { error: "method not allowed" } });
    }

    const stat = serveStatic(path);
    if (stat) {
      res.writeHead(200, {
        "content-type": MIME[extname(stat).toLowerCase()] ?? "application/octet-stream",
        // The service worker must never be served from cache, or a deployed fix
        // can never reach a phone that already installed the app.
        "cache-control": stat.endsWith("sw.js") ? "no-cache" : "no-cache",
      });
      createReadStream(stat).pipe(res);
      return;
    }

    send(res, { status: 404, json: { error: "not found" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${method} ${path}]`, message);
    const reply: Reply =
      message === "body too large"
        ? { status: 413, json: { error: message } }
        : { status: 500, json: { error: "server error" } };
    send(res, reply);
  }
});

/**
 * Resolve a request path inside WEB_ROOT, or null.
 *
 * The `startsWith` check is the whole point: without it `/../../.ssh/id_rsa`
 * resolves straight out of the web root and the server hands it over.
 */
function serveStatic(path: string): string | null {
  if (!existsSync(WEB_ROOT)) return null;
  const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, "");
  const file = resolve(WEB_ROOT, rel);
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + sep)) return null;

  if (existsSync(file) && statSync(file).isFile()) return file;
  // Single-page app: unknown paths fall back to the shell.
  const index = join(WEB_ROOT, "index.html");
  return existsSync(index) ? index : null;
}

// Expired sign-in attempts are worthless and hold an email address; drop them.
setInterval(sweepExpired, 10 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Quiet sync server on http://${HOST}:${PORT}`);
  console.log(`Magic links will point at ${publicUrl()}`);
  if (!process.env.QUIET_PUBLIC_URL) {
    console.log(
      "Set QUIET_PUBLIC_URL to the address your phone can reach, or the emailed\n" +
        "link will point at localhost and only work on this machine.",
    );
  }
  if (existsSync(WEB_ROOT)) console.log(`Serving the PWA from ${WEB_ROOT}`);
});
