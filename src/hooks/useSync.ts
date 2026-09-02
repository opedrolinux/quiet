import { useCallback, useEffect, useRef, useState } from "react";
import { applyIncoming, type LocalStore } from "../../shared/sync";
import {
  normaliseUrl,
  pollSignIn,
  pushPull,
  signOutDevice,
  startSignIn,
  whoami,
} from "../lib/api";
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
const PERIODIC_MS = 30_000;

/** The local database, in the shape shared/sync.ts asks for. */
const store: LocalStore = {
  get: getNote,
  accept: acceptNote,
  markPushed,
};

const KEY_URL = "sync.url";
const KEY_TOKEN = "sync.token";
const KEY_EMAIL = "sync.email";
const KEY_SEQ = "sync.seq";

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
      // `more` means the server had a full page waiting; go straight back for
      // the rest rather than waiting for the next trigger.
      for (let page = 0; page < 20; page++) {
        const since = Number((await getSetting(KEY_SEQ)) ?? 0) || 0;
        const outgoing = await dirtyNotes();
        const res = await pushPull(url.current, token.current, since, outgoing);

        if (!res.ok) {
          if (res.error.kind === "unauthorized") {
            // The device was revoked, or the server database was reset. Drop
            // the token rather than retrying with it forever.
            await setSetting(KEY_TOKEN, "");
            token.current = null;
            patch({ status: "off", email: null, detail: "signed out by the server" });
          } else {
            patch({
              status: res.error.kind === "offline" ? "offline" : "error",
              detail: res.error.detail,
            });
          }
          return;
        }

        const changed = await applyIncoming(store, res.value.notes);
        await setSetting(KEY_SEQ, String(res.value.seq));
        if (changed.length) changeHandler.current(changed);

        patch({ status: "idle", detail: "", lastSyncedAt: Date.now() });
        if (!res.value.more) return;
      }
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
      const savedUrl = (await getSetting(KEY_URL)) ?? "";
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
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void runSync(), PERIODIC_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
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
