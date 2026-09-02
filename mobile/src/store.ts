import { newNote } from "../../shared/sync";
import type { LocalNote, Note } from "../../shared/types";

/**
 * The phone's local copy, in IndexedDB.
 *
 * Not localStorage: it is synchronous (so it janks the editor on every
 * keystroke), capped around 5 MB, and stores strings only. IndexedDB is
 * asynchronous, far larger, and stores objects — and the whole point of the
 * phone app is that it keeps working in a lecture hall with no signal.
 *
 * iOS can evict this if the app goes unused for a long stretch. That is
 * survivable rather than fatal: everything here also lives on the server, and a
 * signed-in app refills itself on the next sync. It is the reason the device
 * token is worth keeping even when the notes are gone.
 */

const DB_NAME = "quiet";
const VERSION = 1;
const NOTES = "notes";
const SETTINGS = "settings";

let handle: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES)) {
        db.createObjectStore(NOTES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return handle;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

const allNotes = () => run<LocalNote[]>(NOTES, "readonly", (s) => s.getAll());
const put = (note: LocalNote) => run<void>(NOTES, "readwrite", (s) => s.put(note));

/** Newest first, tombstones excluded — the list the user actually sees. */
export async function listNotes(): Promise<LocalNote[]> {
  const rows = await allNotes();
  return rows.filter((n) => n.deleted_at === null).sort((a, b) => b.updated_at - a.updated_at);
}

export function getNote(id: string): Promise<LocalNote | undefined> {
  return run<LocalNote | undefined>(NOTES, "readonly", (s) => s.get(id));
}

export async function createNote(): Promise<string> {
  const note = newNote();
  await put({ ...note, dirty: true, server_seq: 0 });
  return note.id;
}

export async function saveNote(id: string, body: string): Promise<void> {
  const existing = await getNote(id);
  if (!existing) return;
  await put({ ...existing, body, updated_at: Date.now(), dirty: true });
}

/** Soft delete, for the same reason as on the desktop: see shared/types.ts. */
export async function deleteNote(id: string): Promise<void> {
  const existing = await getNote(id);
  if (!existing) return;
  const now = Date.now();
  await put({ ...existing, deleted_at: now, updated_at: now, dirty: true });
}

export async function dirtyNotes(): Promise<Note[]> {
  const rows = await allNotes();
  return rows
    .filter((n) => n.dirty)
    .map(({ id, body, created_at, updated_at, deleted_at }) => ({
      id,
      body,
      created_at,
      updated_at,
      deleted_at,
    }));
}

export async function acceptNote(note: Note, serverSeq: number): Promise<void> {
  await put({ ...note, dirty: false, server_seq: serverSeq });
}

export async function markPushed(
  id: string,
  updatedAt: number,
  serverSeq: number,
): Promise<void> {
  const existing = await getNote(id);
  // Typed into since the push left: leave it dirty so the next sync carries it.
  if (!existing || existing.updated_at !== updatedAt) return;
  await put({ ...existing, dirty: false, server_seq: serverSeq });
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await run<{ key: string; value: string } | undefined>(
    SETTINGS,
    "readonly",
    (s) => s.get(key),
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await run<void>(SETTINGS, "readwrite", (s) => s.put({ key, value }));
}

/** Used when signing out: the notes belong to the account, not the device. */
export async function clearNotes(): Promise<void> {
  await run<void>(NOTES, "readwrite", (s) => s.clear());
}
