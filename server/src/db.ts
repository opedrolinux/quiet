import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The server's store. SQLite, like both clients.
 *
 * `node:sqlite` ships with Node 24, so this whole server has no dependencies to
 * install and nothing to compile — which matters when it is meant to run on the
 * same desktop as the app it serves.
 */

export const DB_PATH = process.env.QUIET_DB ?? "server/data/quiet-server.db";

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL lets a read run while a write is in flight, which is what keeps a sync
// from blocking on a magic-link verification landing at the same moment.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  -- One row per sign-in attempt. Holds the secret from the emailed link and the
  -- short code shown in the app, so the two can be matched.
  CREATE TABLE IF NOT EXISTS auth_requests (
    id           TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    code         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    approved_at  INTEGER,
    -- Handed to the polling client exactly once, then blanked.
    device_token TEXT
  );

  -- One row per signed-in device. The token itself is never stored.
  CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id         TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    -- Position in this server's own write order. Clients page through pulls by
    -- seq rather than by timestamp, because two devices' clocks disagree and a
    -- note written on a slow clock would otherwise be skipped forever.
    seq        INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_notes_seq ON notes (user_id, seq);

  CREATE TABLE IF NOT EXISTS counters (
    name  TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  INSERT INTO counters (name, value) VALUES ('seq', 0)
    ON CONFLICT(name) DO NOTHING;
`);

const bumpSeq = db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'seq'");
const readSeq = db.prepare("SELECT value FROM counters WHERE name = 'seq'");

/** The next write position. Monotonic for the life of the database. */
export function nextSeq(): number {
  bumpSeq.run();
  return (readSeq.get() as { value: number }).value;
}

export function currentSeq(): number {
  return (readSeq.get() as { value: number }).value;
}
