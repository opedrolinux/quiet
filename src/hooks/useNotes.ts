import { useCallback, useEffect, useRef, useState } from "react";
import {
  createNote,
  deleteNote,
  listNotes,
  saveNote,
  type LocalNote,
} from "../lib/db";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Owns the note list, which note is active, and persistence.
 *
 * There is no save button anywhere in the app, so every path out of the editor
 * has to flush: switching notes, hiding the window, and closing it.
 */
export function useNotes() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** Bumped when a sync replaced the active note's text; see `reload`. */
  const [rev, setRev] = useState(0);

  // Kept in refs so the flush path never depends on a stale render.
  const pending = useRef<{ id: string; body: string } | null>(null);
  const timer = useRef<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    await saveNote(p.id, p.body);
  }, []);

  // StrictMode invokes effects twice in dev; without this guard the very first
  // launch seeds two empty notes instead of one.
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      let rows = await listNotes();
      if (rows.length === 0) {
        await createNote();
        rows = await listNotes();
      }
      setNotes(rows);
      setActiveId(rows[0].id);
      setReady(true);
    })();
  }, []);

  // Losing unsaved keystrokes on quit would be unforgivable in a notes app.
  useEffect(() => {
    const onLeave = () => void flush();
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [flush]);

  const edit = useCallback((body: string) => {
    const id = activeIdRef.current;
    if (id === null) return;

    // Update in place rather than re-sorting: reordering the list under the
    // user's cursor while they type is disorienting. Order settles on reload.
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, body, updated_at: Date.now() } : n,
      ),
    );

    pending.current = { id, body };
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  const select = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      await flush();
      setActiveId(id);
    },
    [flush],
  );

  const cycle = useCallback(
    async (delta: 1 | -1) => {
      if (notes.length < 2) return;
      const i = notes.findIndex((n) => n.id === activeIdRef.current);
      const next = notes[(i + delta + notes.length) % notes.length];
      await select(next.id);
    },
    [notes, select],
  );

  const create = useCallback(async () => {
    await flush();
    const id = await createNote();
    setNotes(await listNotes());
    setActiveId(id);
  }, [flush]);

  const remove = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null || notes.length < 2) return;
    pending.current = null;
    await deleteNote(id);
    const rows = await listNotes();
    setNotes(rows);
    setActiveId(rows[0].id);
  }, [notes.length]);

  /**
   * Re-read after a sync landed remote changes.
   *
   * `rev` is the delicate part. The editor deliberately only replaces its
   * document when the note id changes, so that a re-render never yanks text out
   * from under the caret. That also means a remote edit to the note you are
   * looking at would be invisible until you switched away and back — so `rev`
   * is bumped to say "this one really did change underneath you", and only when
   * there is nothing unsent locally that would be thrown away.
   */
  const reload = useCallback(
    async (changedIds: string[] = []) => {
      const rows = await listNotes();

      // Every note deleted on another device: keep the app usable rather than
      // showing an empty editor with no note behind it.
      if (rows.length === 0) {
        const id = await createNote();
        setNotes(await listNotes());
        setActiveId(id);
        return;
      }

      setNotes(rows);
      const active = activeIdRef.current;
      if (!active) return;

      if (!rows.some((n) => n.id === active)) {
        setActiveId(rows[0].id); // deleted elsewhere
        return;
      }
      if (changedIds.includes(active) && pending.current?.id !== active) {
        setRev((r) => r + 1);
      }
    },
    [],
  );

  const active = notes.find((n) => n.id === activeId) ?? null;

  return { notes, active, activeId, ready, rev, edit, select, cycle, create, remove, flush, reload };
}
