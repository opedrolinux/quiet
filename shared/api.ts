import type {
  AuthRequestResponse,
  AuthStatusResponse,
  Note,
  SyncResponse,
} from "./types.ts";

/**
 * Talking to the sync server.
 *
 * Every call can fail — the server lives on your own desktop and may simply not
 * be running — so none of these throw for the caller to remember to catch. They
 * return a result or null, because a notes app that is unreachable should be a
 * notes app that quietly keeps working offline, not one that shows an error.
 */

/** Long enough for a cold server, short enough not to hang a sync forever. */
const TIMEOUT_MS = 10_000;

export type ApiError = { kind: "offline" | "unauthorized" | "server"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
/*
 * "Failed to fetch" is what the browser says and it tells the user nothing:
 * the same three words cover a stopped server, a typo in the address and a
 * flat wifi. By far the most common cause here is that the server is simply
 * not running, and that has a specific remedy worth naming.
 */
function describeNetworkFailure(err: unknown, base: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === "AbortError") return "the server did not answer in time";

  let local = false;
  try {
    const host = new URL(base).hostname;
    local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return raw;
  }
  if (!/fetch|network|connect|refused/i.test(raw)) return raw;
  return local
    ? "server not running — start it with: pnpm server"
    : "cannot reach the server at " + base;
}

const fail = (kind: ApiError["kind"], detail: string): Result<never> => ({
  ok: false,
  error: { kind, detail },
});

/** Trailing slashes make `${url}/sync` into `${url}//sync`, which 404s. */
export const normaliseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

async function call<T>(
  url: string,
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Result<T>> {
  const base = normaliseUrl(url);
  if (!base) return fail("offline", "no server address configured");

  const { token, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(base + path, {
      ...rest,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.headers ?? {}),
      },
    });

    if (res.status === 401) return fail("unauthorized", "this device is signed out");
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return fail("server", (body as { error?: string })?.error ?? `HTTP ${res.status}`);
    }
    return ok(body as T);
  } catch (err) {
    // Unreachable, DNS failure, TLS rejection, timeout — all the same to us.
    return fail("offline", describeNetworkFailure(err, base));
  } finally {
    clearTimeout(timer);
  }
}

export function startSignIn(url: string, email: string): Promise<Result<AuthRequestResponse>> {
  return call<AuthRequestResponse>(url, "/auth/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function pollSignIn(url: string, requestId: string): Promise<Result<AuthStatusResponse>> {
  return call<AuthStatusResponse>(
    url,
    `/auth/status?request_id=${encodeURIComponent(requestId)}`,
  );
}

export function whoami(url: string, token: string): Promise<Result<{ email: string }>> {
  return call<{ email: string }>(url, "/auth/me", { token });
}

export function signOutDevice(url: string, token: string): Promise<Result<null>> {
  return call<null>(url, "/auth/signout", { method: "POST", token });
}

export function pushPull(
  url: string,
  token: string,
  since: number,
  notes: Note[],
): Promise<Result<SyncResponse & { more?: boolean }>> {
  return call<SyncResponse & { more?: boolean }>(url, "/sync", {
    method: "POST",
    token,
    body: JSON.stringify({ since, notes }),
  });
}
