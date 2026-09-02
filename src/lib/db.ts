import Database from "@tauri-apps/plugin-sql";
import { inTauri } from "./window";

export type Note = {
  id: number;
  body: string;
  created_at: number;
  updated_at: number;
};

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

function lsRead(): Note[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as Note[];
  } catch {
    return [];
  }
}

function lsWrite(notes: Note[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(notes));
  } catch {
    /* private window, blocked storage — losing a dev-only draft is fine */
  }
}

export async function listNotes(): Promise<Note[]> {
  if (!inTauri) return lsRead().sort((a, b) => b.updated_at - a.updated_at);
  const d = await db();
  return d.select<Note[]>(
    "SELECT id, body, created_at, updated_at FROM notes ORDER BY updated_at DESC",
  );
}

export async function createNote(): Promise<number> {
  const now = Date.now();
  if (!inTauri) {
    const rows = lsRead();
    const id = rows.reduce((m, n) => Math.max(m, n.id), 0) + 1;
    rows.push({ id, body: "", created_at: now, updated_at: now });
    lsWrite(rows);
    return id;
  }
  const d = await db();
  const res = await d.execute(
    "INSERT INTO notes (body, created_at, updated_at) VALUES ('', $1, $2)",
    [now, now],
  );
  return res.lastInsertId as number;
}

export async function saveNote(id: number, body: string): Promise<void> {
  if (!inTauri) {
    const rows = lsRead().map((n) =>
      n.id === id ? { ...n, body, updated_at: Date.now() } : n,
    );
    lsWrite(rows);
    return;
  }
  const d = await db();
  await d.execute("UPDATE notes SET body = $1, updated_at = $2 WHERE id = $3", [
    body,
    Date.now(),
    id,
  ]);
}

export async function deleteNote(id: number): Promise<void> {
  if (!inTauri) {
    lsWrite(lsRead().filter((n) => n.id !== id));
    return;
  }
  const d = await db();
  await d.execute("DELETE FROM notes WHERE id = $1", [id]);
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
