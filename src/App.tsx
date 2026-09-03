import { useCallback, useEffect, useRef, useState } from "react";
import { Account } from "./components/Account";
import { Editor, focusEditor } from "./components/Editor";
import { Settings } from "./components/Settings";
import { Switcher } from "./components/Switcher";
import { useHotkeys } from "./hooks/useHotkeys";
import { useNotes } from "./hooks/useNotes";
import { useSettings } from "./hooks/useSettings";
import { getSetting, setSetting } from "./lib/db";
import { backFocus, hideWindow, startDrag, startResize } from "./lib/window";
import { useSwitcherPanel } from "./hooks/useSwitcherPanel";
import { useSync } from "./hooks/useSync";

/** How long the switcher stays out after the last Ctrl+Arrow before retracting. */
const RETRACT_MS = 1000;

/** Quiet spell after the last keystroke before the note is pushed. */
const POST_EDIT_SYNC_MS = 800;

export default function App() {
  const notes = useNotes();
  const { settings, update } = useSettings();

  // Sync hands back the ids it changed so the editor can be told when the note
  // currently on screen was rewritten from another device.
  const reloadRef = useRef(notes.reload);
  reloadRef.current = notes.reload;
  const sync = useSync(useCallback((ids: string[]) => void reloadRef.current(ids), []));

  const { mounted: switcherOpen, setOpen } = useSwitcherPanel();
  const [pinned, setPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hint, setHint] = useState(false);
  const [armed, setArmed] = useState(false);

  const armedRef = useRef(false);
  armedRef.current = armed;
  const armTimer = useRef<number | null>(null);

  const retract = useRef<number | null>(null);

  const peek = useCallback(() => {
    void setOpen(true);
    if (retract.current !== null) window.clearTimeout(retract.current);
    retract.current = window.setTimeout(() => {
      if (!pinnedRef.current) void setOpen(false);
    }, RETRACT_MS);
  }, [setOpen]);

  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;

  // Push shortly after typing stops. The periodic sweep would get there
  // eventually, but "eventually" is a bad promise to make about someone's
  // notes when they are about to pick up their phone.
  const syncSoon = useRef<number | null>(null);
  const onEdit = useCallback(
    (body: string) => {
      notes.edit(body);
      if (syncSoon.current !== null) window.clearTimeout(syncSoon.current);
      syncSoon.current = window.setTimeout(() => {
        void notes.flush().then(sync.syncNow);
      }, POST_EDIT_SYNC_MS);
    },
    [notes.edit, notes.flush, sync.syncNow],
  );

  useHotkeys({
    next: () => {
      void notes.cycle(1);
      peek();
    },
    prev: () => {
      void notes.cycle(-1);
      peek();
    },
    jump: (i) => {
      const target = notes.notes[i];
      if (!target) return;
      void notes.select(target.id);
      peek();
    },
    create: () => {
      void notes.create();
      peek();
    },
    toggleSwitcher: () => {
      const next = !pinnedRef.current;
      setPinned(next);
      void setOpen(next);
    },
    toggleSettings: () => setShowSettings((v) => !v),
    remove: () => {
      // Deletion is permanent — there is no trash. Rather than a modal, the
      // first press arms and the second confirms, which keeps the app free of
      // dialogs while still making it impossible to lose a note in one keystroke.
      if (armedRef.current) {
        if (armTimer.current !== null) window.clearTimeout(armTimer.current);
        setArmed(false);
        void notes.remove();
        return;
      }
      if (notes.notes.length < 2) return; // the last note is never deletable
      setArmed(true);
      armTimer.current = window.setTimeout(() => setArmed(false), 3000);
    },
    hide: () => {
      void notes.flush().then(() => {
        void sync.syncNow();
        return hideWindow();
      });
    },
    backFocus: () => {
      // Esc closes the settings popover first, if it is open.
      if (showSettings) {
        setShowSettings(false);
        return;
      }
      void notes.flush().then(() => {
        void sync.syncNow();
        return backFocus();
      });
    },
    bumpText: (d) => update({ bodySize: settings.bodySize + d }),
  });

  // Summoned by the global shortcut: put the caret straight back in the text.
  useEffect(() => {
    const onFocus = () => focusEditor();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // With no title bar there is no visual affordance for moving the window, so
  // say it once and never again.
  useEffect(() => {
    (async () => {
      if (await getSetting("seenHint")) return;
      setHint(true);
      window.setTimeout(() => {
        setHint(false);
        void setSetting("seenHint", "1");
      }, 6000);
    })();
  }, []);

  if (!notes.ready) return null;

  return (
    <>
      <div
        className="app"
        onMouseDown={(e) => {
          if (e.altKey) {
            e.preventDefault();
            void startDrag();
          }
        }}
      >
        {switcherOpen && (
          <Switcher
            notes={notes.notes}
            activeId={notes.activeId}
            onSelect={(id) => void notes.select(id)}
          />
        )}
        <Editor
          noteId={notes.activeId}
          body={notes.active?.body ?? ""}
          rev={notes.rev}
          onChange={onEdit}
        />
      </div>

      {(["n", "s", "e", "w", "se", "sw"] as const).map((d) => (
        <div
          key={d}
          className={"rz rz-" + d}
          onMouseDown={(e) => {
            e.preventDefault();
            void startResize(
              { n: "North", s: "South", e: "East", w: "West", se: "SouthEast", sw: "SouthWest" }[d],
            );
          }}
        />
      ))}

      {showSettings && (
        <Settings settings={settings} onChange={update}>
          <Account
            state={sync.state}
            onSetUrl={(url) => void sync.setUrl(url)}
            onSignIn={(email) => void sync.signIn(email)}
            onCancel={sync.cancelSignIn}
            onSignOut={() => void sync.signOut()}
            onSyncNow={() => void notes.flush().then(sync.syncNow)}
          />
        </Settings>
      )}
      {armed && (
        <div className="hint warn">Press Ctrl+Shift+D again to delete this note</div>
      )}
      {hint && !armed && (
        <div className="hint">
          Alt + drag to move &nbsp;·&nbsp; Ctrl+T notes &nbsp;·&nbsp; Ctrl+, settings
        </div>
      )}
    </>
  );
}
