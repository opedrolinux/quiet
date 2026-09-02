import Database from "@tauri-apps/plugin-sql";
import type { LocalNote, Note } from "../../shared/types";
import { newNote, uuid } from "../../shared/sync";
import { inTauri } from "./window";

export type { LocalNote, Note };

let handle: Promise<Database> | null = null;

/** Schema lives in the Rust migrations; this only opens the file. */
function db(): Promise<Database> {
  if (!handle) handle = Database.load("sqlite:quiet.db");
  return handle;
}

/*
 * Browser fallback.
 *
 * Running `pnpm dev` and opening localhost has no Tauri runtime and therefore
 * no SQLite. Rather than crash, the app falls back to localStorage so the
 * design can be worked on without the Rust toolchain. Never used in the real
 * app: `inTauri` is false only in a plain browser tab.
 */
const LS_KEY = "quiet.notes";

function lsRead(): LocalNote[] {
  try {
    const rows = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as LocalNote[];
    // v2 stored integer ids; give anything left over a real one rather than
    // throwing away the dev database.
    return rows.map((n) =>
      typeof n.id === "string" ? n : { ...n, id: uuid(), dirty: true, server_seq: 0 },
    );
  } catch {
    return [];
  }
}

function lsWrite(notes: LocalNote[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(notes));
  } catch {
    /* private window, blocked storage — losing a dev-only draft is fine */
  }
}

/** SQLite has no boolean; the column is an integer and comes back as one. */
type Row = Omit<LocalNote, "dirty"> & { dirty: number };
const fromRow = (r: Row): LocalNote => ({ ...r, dirty: r.dirty !== 0 });

/** Deleted notes stay in the table forever, so every read has to exclude them. */
export async function listNotes(): Promise<LocalNote[]> {
  if (!inTauri) {
    return lsRead()
      .filter((n) => n.deleted_at === null)
      .sort((a, b) => b.updated_at - a.updated_at);
  }
  const d = await db();
  const rows = await d.select<Row[]>(
    `SELECT id, body, created_at, updated_at, deleted_at, dirty, server_seq
       FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC`,
  );
  return rows.map(fromRow);
}

export async function createNote(): Promise<string> {
  const note = newNote();
  if (!inTauri) {
    lsWrite([...lsRead(), { ...note, dirty: true, server_seq: 0 }]);
    return note.id;
  }
  const d = await db();
  await d.execute(
    `INSERT INTO notes (id, body, created_at, updated_at, deleted_at, dirty, server_seq)
     VALUES ($1, '', $2, $3, NULL, 1, 0)`,
    [note.id, note.created_at, note.updated_at],
  );
  return note.id;
}

export async function saveNote(id: string, body: string): Promise<void> {
  const now = Date.now();
  if (!inTauri) {
    lsWrite(
      lsRead().map((n) => (n.id === id ? { ...n, body, updated_at: now, dirty: true } : n)),
    );
    return;
  }
  const d = await db();
  await d.execute(
    "UPDATE notes SET body = $1, updated_at = $2, dirty = 1 WHERE id = $3",
    [body, now, id],
  );
}

/**
 * Soft delete — the row stays, tombstoned.
 *
 * Actually removing it would make the note reappear on the next pull: the
 * server would offer a row this device has no record of, which is exactly what
 * a never-seen note looks like.
 */
export async function deleteNote(id: string): Promise<void> {
  const now = Date.now();
  if (!inTauri) {
    lsWrite(
      lsRead().map((n) =>
        n.id === id ? { ...n, deleted_at: now, updated_at: now, dirty: true } : n,
      ),
    );
    return;
  }
  const d = await db();
  await d.execute(
    "UPDATE notes SET deleted_at = $1, updated_at = $1, dirty = 1 WHERE id = $2",
    [now, id],
  );
}

/* --- sync support ------------------------------------------------------ */

/** Everything edited here since the server last acknowledged it. */
export async function dirtyNotes(): Promise<Note[]> {
  if (!inTauri) return lsRead().filter((n) => n.dirty);
  const d = await db();
  return d.select<Note[]>(
    `SELECT id, body, created_at, updated_at, deleted_at
       FROM notes WHERE dirty = 1`,
  );
}

/** One note by id, tombstones included — the merge needs to see those. */
export async function getNote(id: string): Promise<LocalNote | undefined> {
  if (!inTauri) return lsRead().find((n) => n.id === id);
  const d = await db();
  const rows = await d.select<Row[]>(
    `SELECT id, body, created_at, updated_at, deleted_at, dirty, server_seq
       FROM notes WHERE id = $1`,
    [id],
  );
  return rows.length ? fromRow(rows[0]) : undefined;
}

/** Write the server's version over ours and mark it settled. */
export async function acceptNote(note: Note, serverSeq: number): Promise<void> {
  if (!inTauri) {
    const rows = lsRead();
    const next: LocalNote = { ...note, dirty: false, server_seq: serverSeq };
    const i = rows.findIndex((n) => n.id === note.id);
    if (i === -1) rows.push(next);
    else rows[i] = next;
    lsWrite(rows);
    return;
  }
  const d = await db();
  await d.execute(
    `INSERT INTO notes (id, body, created_at, updated_at, deleted_at, dirty, server_seq)
     VALUES ($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT(id) DO UPDATE SET
       body = $2, created_at = $3, updated_at = $4, deleted_at = $5,
       dirty = 0, server_seq = $6`,
    [note.id, note.body, note.created_at, note.updated_at, note.deleted_at, serverSeq],
  );
}

/**
 * Clear the dirty flag after a successful push — but only if the note has not
 * been typed into since. Comparing `updated_at` is what prevents a keystroke
 * landing mid-request from being silently marked as saved and never sent.
 */
export async function markPushed(id: string, updatedAt: number, serverSeq: number): Promise<void> {
  if (!inTauri) {
    lsWrite(
      lsRead().map((n) =>
        n.id === id && n.updated_at === updatedAt
          ? { ...n, dirty: false, server_seq: serverSeq }
          : n,
      ),
    );
    return;
  }
  const d = await db();
  await d.execute(
    "UPDATE notes SET dirty = 0, server_seq = $1 WHERE id = $2 AND updated_at = $3",
    [serverSeq, id, updatedAt],
  );
}

export async function getSetting(key: string): Promise<string | null> {
  if (!inTauri) return localStorage.getItem("quiet.set." + key);
  const d = await db();
  const rows = await d.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (!inTauri) {
    try {
      localStorage.setItem("quiet.set." + key, value);
    } catch {
      /* see lsWrite */
    }
    return;
  }
  const d = await db();
  await d.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}
