import { useCallback, useEffect, useRef, useState } from "react";
import { pollSignIn, startSignIn } from "../../shared/api";
import { runSync, type SyncDeps } from "../../shared/engine";
import {
  acceptNote,
  clearNotes,
  dirtyNotes,
  getNote,
  getSetting,
  markPushed,
  setSetting,
} from "./store";

/**
 * The phone's half of sync.
 *
 * Shorter than the desktop's because the PWA is served *by* the sync server, so
 * there is no address to configure — the API is same-origin, and there is one
 * less thing for the user to get wrong on a phone keyboard.
 */

/** Same origin as the page: the server that served this app is the server. */
const BASE = typeof location !== "undefined" ? location.origin : "";

const POLL_SIGNIN_MS = 2_000;
const PERIODIC_MS = 60_000;

const KEY_TOKEN = "sync.token";
const KEY_EMAIL = "sync.email";
const KEY_SEQ = "sync.seq";

const deps: SyncDeps = {
  getSeq: async () => Number((await getSetting(KEY_SEQ)) ?? 0) || 0,
  setSeq: (seq) => setSetting(KEY_SEQ, String(seq)),
  dirty: dirtyNotes,
  store: { get: getNote, accept: acceptNote, markPushed },
};

export type PhoneSync = {
  ready: boolean;
  email: string | null;
  status: "off" | "idle" | "syncing" | "offline" | "error";
  detail: string;
  pending: { requestId: string; code: string } | null;
};

export function useSync(onRemoteChange: () => void) {
  const [state, setState] = useState<PhoneSync>({
    ready: false,
    email: null,
    status: "off",
    detail: "",
    pending: null,
  });

  const token = useRef<string | null>(null);
  const running = useRef(false);
  const onChange = useRef(onRemoteChange);
  onChange.current = onRemoteChange;

  const patch = (next: Partial<PhoneSync>) => setState((s) => ({ ...s, ...next }));

  const sync = useCallback(async () => {
    if (running.current || !token.current) return;
    running.current = true;
    patch({ status: "syncing", detail: "" });
    try {
      const outcome = await runSync(BASE, token.current, deps);
      if (!outcome.ok) {
        if (outcome.kind === "unauthorized") {
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
      if (outcome.changed.length) onChange.current();
      patch({ status: "idle", detail: "" });
    } finally {
      running.current = false;
    }
  }, []);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      const savedToken = (await getSetting(KEY_TOKEN)) || null;
      const savedEmail = (await getSetting(KEY_EMAIL)) || null;
      token.current = savedToken;
      patch({
        ready: true,
        email: savedToken ? savedEmail : null,
        status: savedToken ? "idle" : "off",
      });
      if (savedToken) void sync();
    })();
  }, [sync]);

  useEffect(() => {
    // Coming back to the app is exactly when you want what the desktop wrote.
    // `visibilitychange` rather than `focus`: on iOS a PWA resumed from the app
    // switcher does not reliably fire a focus event.
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = window.setInterval(() => void sync(), PERIODIC_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.clearInterval(timer);
    };
  }, [sync]);

  const pollTimer = useRef<number | null>(null);
  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    pollTimer.current = null;
  };
  useEffect(() => stopPolling, []);

  const signIn = useCallback(
    async (email: string) => {
      patch({ status: "syncing", detail: "sending the link…" });
      const res = await startSignIn(BASE, email);
      if (!res.ok) {
        patch({
          status: res.error.kind === "offline" ? "offline" : "error",
          detail: res.error.detail,
        });
        return;
      }

      const { request_id, code, expires_at } = res.value;
      patch({ pending: { requestId: request_id, code }, status: "idle", detail: "" });

      stopPolling();
      pollTimer.current = window.setInterval(async () => {
        if (Date.now() > expires_at) {
          stopPolling();
          patch({ pending: null, status: "error", detail: "that link expired" });
          return;
        }
        const poll = await pollSignIn(BASE, request_id);
        if (!poll.ok) return; // transient; keep waiting
        if (poll.value.status === "expired") {
          stopPolling();
          patch({ pending: null, status: "error", detail: "that link expired" });
          return;
        }
        if (poll.value.status !== "approved") return;

        stopPolling();
        token.current = poll.value.device_token;
        await setSetting(KEY_TOKEN, poll.value.device_token);
        await setSetting(KEY_EMAIL, poll.value.email);
        await setSetting(KEY_SEQ, "0");
        patch({ pending: null, email: poll.value.email, status: "idle", detail: "" });
        void sync();
      }, POLL_SIGNIN_MS);
    },
    [sync],
  );

  const cancelSignIn = useCallback(() => {
    stopPolling();
    patch({ pending: null, status: "off", detail: "" });
  }, []);

  const signOut = useCallback(async () => {
    stopPolling();
    token.current = null;
    await setSetting(KEY_TOKEN, "");
    await setSetting(KEY_EMAIL, "");
    await setSetting(KEY_SEQ, "0");
    // The notes belong to the account. Leaving them on a signed-out phone would
    // hand them to whoever signs in next.
    await clearNotes();
    patch({ email: null, status: "off", pending: null, detail: "" });
    onChange.current();
  }, []);

  return { state, sync, signIn, cancelSignIn, signOut };
}
