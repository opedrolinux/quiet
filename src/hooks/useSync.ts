import { useCallback, useEffect, useRef, useState } from "react";
import { runSync as runSyncEngine, type SyncDeps } from "../../shared/engine";
import {
  normaliseUrl,
  pollSignIn,
  signOutDevice,
  startSignIn,
  whoami,
} from "../../shared/api";
import { acceptNote, dirtyNotes, getNote, getSetting, markPushed, setSetting } from "../lib/db";

/**
 * Keeps this device's notes level with the server.
 *
 * Sync is never allowed to be the reason the app misbehaves. Every failure path
 * ends in "carry on offline": an unreachable server, an expired token and a
 * malformed reply all leave the local database untouched and the editor usable.
 * The app worked with no account at all for two versions and still must.
 */

const POLL_SIGNIN_MS = 2_000;
/*
 * The receiving device sets the latency, not the sending one: a change is only
 * seen when the other end next asks for it. Against a server on your own
 * machine a round trip costs about 200ms, so a sweep this frequent is cheap
 * and it is what makes an edit land on the other screen while you are still
 * looking at it.
 */
const PERIODIC_MS = 2_000;

const KEY_URL = "sync.url";

/*
 * There is exactly one address this is ever going to be for a local setup, and
 * leaving the box empty invited typing the wrong one: 1420 is the Vite dev
 * server the app's own window is served from, it answers, and it returns 404
 * to every sync call. An address that is right by default cannot be mistyped.
 */
const DEFAULT_URL = "http://localhost:8787";
const KEY_TOKEN = "sync.token";
const KEY_EMAIL = "sync.email";
const KEY_SEQ = "sync.seq";

/** SQLite, in the shape the shared sync engine asks for. */
const deps: SyncDeps = {
  getSeq: async () => Number((await getSetting(KEY_SEQ)) ?? 0) || 0,
  setSeq: (seq) => setSetting(KEY_SEQ, String(seq)),
  dirty: dirtyNotes,
  store: { get: getNote, accept: acceptNote, markPushed },
};

export type SyncState = {
  /** Where the server is. Empty means sync is switched off entirely. */
  url: string;
  /** Signed-in address, or null. */
  email: string | null;
  status: "off" | "idle" | "syncing" | "offline" | "error";
  detail: string;
  /** Set while waiting for a magic link to be opened. */
  pending: { requestId: string; code: string } | null;
  lastSyncedAt: number | null;
};

/*
 * The app's own origin is never the sync server -- in dev that is the Vite
 * server on 1420, which answers every request with a 404 and makes the setup
 * look broken rather than misaddressed. Treat that as unset so it corrects
 * itself instead of needing to be found and retyped.
 */
function usableUrl(saved: string | null | undefined): string {
  const url = (saved ?? "").trim();
  if (!url) return DEFAULT_URL;
  try {
    if (new URL(url).origin === window.location.origin) return DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
  return url;
}

export function useSync(onRemoteChange: (changedIds: string[]) => void) {
  const [state, setState] = useState<SyncState>({
    url: "",
    email: null,
    status: "off",
    detail: "",
    pending: null,
    lastSyncedAt: null,
  });

  // Read in the sync path, which must not depend on a render having happened.
  const url = useRef("");
  const token = useRef<string | null>(null);
  const running = useRef(false);
  const changeHandler = useRef(onRemoteChange);
  changeHandler.current = onRemoteChange;

  const patch = (next: Partial<SyncState>) => setState((s) => ({ ...s, ...next }));

  /* --- the sync itself -------------------------------------------------- */

  const runSync = useCallback(async (): Promise<void> => {
    if (running.current) return; // one exchange at a time, or pushes race
    if (!url.current || !token.current) return;
    running.current = true;
    patch({ status: "syncing", detail: "" });

    try {
      const outcome = await runSyncEngine(url.current, token.current, deps);

      if (!outcome.ok) {
        if (outcome.kind === "unauthorized") {
          // The device was revoked, or the server database was reset. Drop the
          // token rather than retrying with it forever.
          await setSetting(KEY_TOKEN, "");
          token.current = null;
          patch({ status: "off", email: null, detail: "signed out by the server" });
        } else {
          patch({
            status: outcome.kind === "offline" ? "offline" : "error",
            detail: outcome.detail,
          });
        }
        return;
      }

      if (outcome.changed.length) changeHandler.current(outcome.changed);
      patch({ status: "idle", detail: "", lastSyncedAt: Date.now() });
    } finally {
      running.current = false;
    }
  }, []);

  /* --- boot ------------------------------------------------------------- */

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const stored = await getSetting(KEY_URL);
      const savedUrl = usableUrl(stored);
      // Write the correction back, so the settings box shows what is actually
      // in use rather than the address that was ignored.
      if (savedUrl !== stored) await setSetting(KEY_URL, savedUrl);
      const savedToken = (await getSetting(KEY_TOKEN)) || null;
      const savedEmail = (await getSetting(KEY_EMAIL)) || null;
      url.current = savedUrl;
      token.current = savedToken;
      patch({
        url: savedUrl,
        email: savedToken ? savedEmail : null,
        status: savedToken ? "idle" : "off",
      });
      if (savedToken) void runSync();
    })();
  }, [runSync]);

  /* --- triggers --------------------------------------------------------- */

  useEffect(() => {
    // Summoning the window is the moment you most want to be looking at what
    // the other device wrote.
    const onFocus = () => void runSync();
    // Leaving is as important as arriving. Esc and Ctrl+H already flush and
    // push, but walking away with the mouse used to push nothing, so the note
    // sat here until the sweep caught it.
    const onBlur = () => void runSync();
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    const timer = window.setInterval(() => void runSync(), PERIODIC_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.clearInterval(timer);
    };
  }, [runSync]);

  /* --- account ---------------------------------------------------------- */

  const setUrl = useCallback(async (next: string) => {
    const clean = normaliseUrl(next);
    url.current = clean;
    await setSetting(KEY_URL, clean);
    patch({ url: clean, status: token.current ? "idle" : "off", detail: "" });
  }, []);

  const pollTimer = useRef<number | null>(null);
  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    pollTimer.current = null;
  };

  const signIn = useCallback(
    async (email: string) => {
      if (!url.current) {
        patch({ status: "error", detail: "set the server address first" });
        return;
      }
      patch({ status: "syncing", detail: "sending the link…" });
      const res = await startSignIn(url.current, email);
      if (!res.ok) {
        patch({ status: res.error.kind === "offline" ? "offline" : "error", detail: res.error.detail });
        return;
      }

      const { request_id, code, expires_at } = res.value;
      patch({ pending: { requestId: request_id, code }, status: "idle", detail: "waiting for the link" });

      stopPolling();
      pollTimer.current = window.setInterval(async () => {
        if (Date.now() > expires_at) {
          stopPolling();
          patch({ pending: null, status: "error", detail: "the link expired" });
          return;
        }
        const poll = await pollSignIn(url.current, request_id);
        if (!poll.ok) return; // transient; keep waiting
        if (poll.value.status === "expired") {
          stopPolling();
          patch({ pending: null, status: "error", detail: "the link expired" });
          return;
        }
        if (poll.value.status !== "approved") return;

        stopPolling();
        token.current = poll.value.device_token;
        await setSetting(KEY_TOKEN, poll.value.device_token);
        await setSetting(KEY_EMAIL, poll.value.email);
        // A brand new device has seen nothing, so it must pull from the start.
        await setSetting(KEY_SEQ, "0");
        patch({ pending: null, email: poll.value.email, status: "idle", detail: "" });
        void runSync();
      }, POLL_SIGNIN_MS);
    },
    [runSync],
  );

  const cancelSignIn = useCallback(() => {
    stopPolling();
    patch({ pending: null, status: token.current ? "idle" : "off", detail: "" });
  }, []);

  const signOut = useCallback(async () => {
    stopPolling();
    const had = token.current;
    token.current = null;
    await setSetting(KEY_TOKEN, "");
    await setSetting(KEY_EMAIL, "");
    // The cursor is meaningless against a different account, and leaving it set
    // would make the next sign-in skip everything already on the server.
    await setSetting(KEY_SEQ, "0");
    patch({ email: null, status: "off", pending: null, detail: "" });
    // Best-effort: the local device is signed out either way.
    if (had && url.current) void signOutDevice(url.current, had);
  }, []);

  /** Used by settings to check an address before signing in against it. */
  const testConnection = useCallback(async () => {
    if (!token.current) return;
    const res = await whoami(url.current, token.current);
    if (res.ok) patch({ email: res.value.email, status: "idle", detail: "" });
  }, []);

  useEffect(() => stopPolling, []);

  return { state, signIn, cancelSignIn, signOut, setUrl, syncNow: runSync, testConnection };
}
