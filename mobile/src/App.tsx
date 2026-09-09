import { useCallback, useEffect, useRef, useState } from "react";
import { deriveTitle } from "../../shared/title";
import type { LocalNote } from "../../shared/types";
import { createNote, deleteNote, listNotes, saveNote } from "./store";
import { useSync } from "./useSync";

const SAVE_DEBOUNCE_MS = 400;
const SYNC_AFTER_MS = 800;

/**
 * Quiet on a phone.
 *
 * Deliberately not the desktop app made smaller. Everything that defines Quiet
 * on Windows — no chrome, always on top, summoned over a video with a hotkey —
 * either does not exist on iOS or means nothing there. What carries across is
 * the part that was never about the window: your notes, and the rule that the
 * first line is the title.
 *
 * So the title is its own field here rather than a styled first line. A phone
 * has a real text cursor, autocorrect and a virtual keyboard, and a plain
 * <textarea> handles all three properly where an editor that draws its own
 * caret does not. The body on the wire is unchanged — title, newline, rest —
 * so `deriveTitle` still gives the desktop and the phone the same answer.
 */

function splitBody(body: string): [title: string, rest: string] {
  const i = body.indexOf("\n");
  return i === -1 ? [body, ""] : [body.slice(0, i), body.slice(i + 1)];
}

const joinBody = (title: string, rest: string) => (rest === "" ? title : `${title}\n${rest}`);

export default function App() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => setNotes(await listNotes()), []);
  const sync = useSync(useCallback(() => void refresh(), [refresh]));

  useEffect(() => {
    void refresh().then(() => setLoaded(true));
  }, [refresh]);

  if (!sync.state.ready || !loaded) return null;
  if (!sync.state.email) return <SignIn sync={sync} />;

  if (openId) {
    const note = notes.find((n) => n.id === openId);
    if (!note) {
      // Deleted from another device while it was open.
      setOpenId(null);
      return null;
    }
    return (
      <NoteView
        key={note.id}
        note={note}
        onBack={() => {
          setOpenId(null);
          void refresh();
        }}
        onChanged={refresh}
        onSyncSoon={sync.sync}
        onDelete={async () => {
          await deleteNote(note.id);
          setOpenId(null);
          await refresh();
          void sync.sync();
        }}
      />
    );
  }

  return (
    <NoteList
      notes={notes}
      sync={sync}
      onOpen={setOpenId}
      onNew={async () => {
        const id = await createNote();
        await refresh();
        setOpenId(id);
      }}
    />
  );
}

/* --- sign in ------------------------------------------------------------ */

function SignIn({ sync }: { sync: ReturnType<typeof useSync> }) {
  const [email, setEmail] = useState("");
  const { pending, status, detail } = sync.state;

  return (
    <div className="centred">
      <div className="brand">
        <span className="brand-dot" />
        Quiet
      </div>

      {pending ? (
        <>
          <p className="lead">Open the link in your email.</p>
          {/* Shown so you can tell your own sign-in from one somebody else
              started for your address. */}
          <div className="code">{pending.code}</div>
          <p className="muted">Waiting… this page will notice by itself.</p>
          <button className="btn ghost" onClick={sync.cancelSignIn}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <p className="lead">Sign in to reach your notes.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) void sync.signIn(email.trim());
            }}
          >
            <input
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="btn" type="submit" disabled={!email.trim() || status === "syncing"}>
              {status === "syncing" ? "Sending…" : "Send link"}
            </button>
          </form>
          {detail && <p className="muted">{detail}</p>}
        </>
      )}
    </div>
  );
}

/* --- list --------------------------------------------------------------- */

function NoteList({
  notes,
  sync,
  onOpen,
  onNew,
}: {
  notes: LocalNote[];
  sync: ReturnType<typeof useSync>;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const [showAccount, setShowAccount] = useState(false);

  return (
    <div className="screen">
      <header className="bar">
        <div className="brand">
          <span className={"brand-dot " + sync.state.status} />
          Quiet
        </div>
        <div className="bar-actions">
          {/* On a phone the sweep can be behind a locked screen or a suspended
              tab, so the one thing worth being able to do by hand is ask. */}
          <button
            className="icon"
            onClick={() => void sync.sync()}
            disabled={sync.state.status === "syncing"}
            aria-label="Sync now"
          >
            ⟳
          </button>
          <button className="icon" onClick={() => setShowAccount((v) => !v)} aria-label="Account">
            ···
          </button>
        </div>
      </header>

      {showAccount && (
        <div className="account">
          <div className="account-email">{sync.state.email}</div>
          <div className="muted">{sync.state.detail || statusLabel(sync.state.status)}</div>
          <button className="btn ghost" onClick={() => void sync.signOut()}>
            Sign out
          </button>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="empty">No notes yet.</p>
      ) : (
        <ul className="list">
          {notes.map((n) => {
            const [, rest] = splitBody(n.body);
            return (
              <li key={n.id}>
                <button className="row" onClick={() => onOpen(n.id)}>
                  <span className="row-title">{deriveTitle(n.body)}</span>
                  {/* One line of context, so a list of notes called "Untitled"
                      is still navigable. */}
                  <span className="row-preview">{rest.trim().split("\n")[0] || "—"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button className="fab" onClick={onNew} aria-label="New note">
        +
      </button>
    </div>
  );
}

function statusLabel(status: string): string {
  return (
    {
      off: "not syncing",
      idle: "synced",
      syncing: "syncing…",
      offline: "no connection to the server",
      error: "sync problem",
    }[status] ?? ""
  );
}

/* --- one note ----------------------------------------------------------- */

function NoteView({
  note,
  onBack,
  onChanged,
  onSyncSoon,
  onDelete,
}: {
  note: LocalNote;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onSyncSoon: () => void;
  onDelete: () => void;
}) {
  const initial = splitBody(note.body);
  const [title, setTitle] = useState(initial[0]);
  const [rest, setRest] = useState(initial[1]);
  const [confirming, setConfirming] = useState(false);

  const saveTimer = useRef<number | null>(null);
  const syncTimer = useRef<number | null>(null);
  /* True between a keystroke and the save that records it. */
  const unsaved = useRef(false);

  /*
   * Adopt a version that arrived from another device.
   *
   * Without this the open editor keeps whatever it held when it was opened,
   * and the next keystroke saves that stale text over the top -- it carries
   * the later timestamp, so last-write-wins hands it the argument and the
   * other device's work disappears. The guard is the point: never overwrite
   * something typed here and not yet saved.
   */
  useEffect(() => {
    if (unsaved.current) return;
    const [t, r] = splitBody(note.body);
    setTitle(t);
    setRest(r);
  }, [note.body]);

  const queue = useCallback(
    (nextTitle: string, nextRest: string) => {
      unsaved.current = true;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void saveNote(note.id, joinBody(nextTitle, nextRest)).then(() => {
          // Cleared before the refresh, so that if a remote version won the
          // merge in the meantime, the effect above is free to adopt it.
          unsaved.current = false;
          return onChanged();
        });
      }, SAVE_DEBOUNCE_MS);

      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(onSyncSoon, SYNC_AFTER_MS);
    },
    [note.id, onChanged, onSyncSoon],
  );

  // Leaving the screen must not lose the last few keystrokes.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, []);

  const flushAndBack = () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    void saveNote(note.id, joinBody(title, rest)).then(() => {
      unsaved.current = false;
      onSyncSoon();
      onBack();
    });
  };

  return (
    <div className="screen">
      <header className="bar">
        <button className="icon" onClick={flushAndBack} aria-label="Back">
          ‹
        </button>
        <button
          className={"icon" + (confirming ? " danger" : "")}
          onClick={() => (confirming ? onDelete() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? "Delete?" : "Delete"}
        </button>
      </header>

      <input
        className="title-field"
        value={title}
        placeholder="Title"
        // The title is one line by definition; a newline here would silently
        // become a second line of the note.
        onChange={(e) => {
          const v = e.target.value.replace(/\n/g, " ");
          setTitle(v);
          queue(v, rest);
        }}
      />
      <textarea
        className="body-field"
        value={rest}
        placeholder="…"
        onChange={(e) => {
          setRest(e.target.value);
          queue(title, e.target.value);
        }}
      />
    </div>
  );
}
