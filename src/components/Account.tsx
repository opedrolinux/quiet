import { useState } from "react";
import type { SyncState } from "../hooks/useSync";

type Props = {
  state: SyncState;
  onSetUrl: (url: string) => void;
  onSignIn: (email: string) => void;
  onCancel: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
};

const STATUS_LABEL: Record<SyncState["status"], string> = {
  off: "not syncing",
  idle: "synced",
  syncing: "syncing…",
  offline: "server unreachable",
  error: "sync problem",
};

/**
 * Sign-in, inside the settings popover.
 *
 * This is the only part of Quiet that asks the user for anything, and it earns
 * its place by staying out of sight: an app that has never been signed in shows
 * one input, and a signed-in one shows a single line of text. There is no
 * account screen, because there is no screen.
 */
export function Account({ state, onSetUrl, onSignIn, onCancel, onSignOut, onSyncNow }: Props) {
  const [url, setUrl] = useState(state.url);
  const [email, setEmail] = useState("");

  const urlChanged = url.trim() !== state.url;

  return (
    <div className="account">
      <div className="account-head">
        <span>Sync</span>
        <span className={"account-dot " + state.status} title={state.detail || undefined} />
      </div>

      {state.email ? (
        <>
          <div className="account-line" title={state.email}>
            {state.email}
          </div>
          <div className="account-status">{state.detail || STATUS_LABEL[state.status]}</div>
          {/* The sweep is two seconds away at worst, so this is not here out of
              necessity — it is here so that when you are waiting on a note from
              the other device you have something to press instead of guessing
              whether the app is doing anything. */}
          <div className="account-row">
            <button
              className="account-btn"
              disabled={state.status === "syncing"}
              onMouseDown={onSyncNow}
            >
              {state.status === "syncing" ? "Syncing…" : "Sync now"}
            </button>
            <button className="account-btn subtle" onMouseDown={onSignOut}>
              Sign out
            </button>
          </div>
        </>
      ) : state.pending ? (
        <>
          <div className="account-status">Open the link in your email.</div>
          {/* Shown so the user can tell their own sign-in from one somebody
              else triggered for the same address. */}
          <div className="account-code">{state.pending.code}</div>
          <button className="account-btn" onMouseDown={onCancel}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <input
            className="account-input"
            type="url"
            inputMode="url"
            placeholder="http://localhost:8787"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => urlChanged && onSetUrl(url)}
            spellCheck={false}
          />
          <input
            className="account-input"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              // Enter submits; stop it before the global handler sees it.
              if (e.key !== "Enter") return;
              e.preventDefault();
              e.stopPropagation();
              if (urlChanged) onSetUrl(url);
              if (email.trim()) onSignIn(email.trim());
            }}
            spellCheck={false}
            autoComplete="email"
          />
          <button
            className="account-btn"
            disabled={!email.trim()}
            onMouseDown={() => {
              if (urlChanged) onSetUrl(url);
              if (email.trim()) onSignIn(email.trim());
            }}
          >
            Send link
          </button>
          {state.detail && <div className="account-status">{state.detail}</div>}
        </>
      )}
    </div>
  );
}
