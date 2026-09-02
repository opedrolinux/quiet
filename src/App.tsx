import { useCallback, useEffect, useRef, useState } from "react";
import { Editor, focusEditor } from "./components/Editor";
import { Settings } from "./components/Settings";
import { Switcher } from "./components/Switcher";
import { useHotkeys } from "./hooks/useHotkeys";
import { useNotes } from "./hooks/useNotes";
import { useSettings } from "./hooks/useSettings";
import { getSetting, setSetting } from "./lib/db";
import { SWITCHER_W, hideWindow, startDrag, startResize, widenLeft } from "./lib/window";

/** How long the switcher stays out after the last Ctrl+Arrow before retracting. */
const RETRACT_MS = 1000;

export default function App() {
  const notes = useNotes();
  const { settings, update } = useSettings();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hint, setHint] = useState(false);
  const [armed, setArmed] = useState(false);

  const armedRef = useRef(false);
  armedRef.current = armed;
  const armTimer = useRef<number | null>(null);

  const openRef = useRef(false);
  const retract = useRef<number | null>(null);

  // The window grows and shrinks on its left edge to match, so the editor's
  // position on screen never changes.
  const setOpen = useCallback(async (next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    setSwitcherOpen(next);
    await widenLeft(next ? SWITCHER_W : -SWITCHER_W);
  }, []);

  const peek = useCallback(() => {
    void setOpen(true);
    if (retract.current !== null) window.clearTimeout(retract.current);
    retract.current = window.setTimeout(() => {
      if (!pinnedRef.current) void setOpen(false);
    }, RETRACT_MS);
  }, [setOpen]);

  const pinnedRef = useRef(false);
  pinnedRef.current = pinned;

  useHotkeys({
    next: () => {
      void notes.cycle(1);
      peek();
    },
    prev: () => {
      void notes.cycle(-1);
      peek();
    },
    create: () => void notes.create(),
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
      if (showSettings) {
        setShowSettings(false);
        return;
      }
      void notes.flush().then(hideWindow);
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
          onChange={notes.edit}
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

      {showSettings && <Settings settings={settings} onChange={update} />}
      {armed && (
        <div className="hint warn">Press Ctrl+Shift+D again to delete this note</div>
      )}
      {hint && !armed && (
        <div className="hint">Alt + drag to move &nbsp;·&nbsp; Ctrl + , for settings</div>
      )}
    </>
  );
}
