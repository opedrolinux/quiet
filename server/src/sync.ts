import { db, currentSeq, nextSeq } from "./db.ts";
import { acceptsPush } from "../../shared/sync.ts";
import type { Note } from "../../shared/types.ts";
import type { Session } from "./auth.ts";
import type { Reply } from "./http.ts";

/**
 * Push and pull in one exchange.
 *
 * Doing both in a single round trip is not just fewer requests: it means a
 * client's own writes come straight back with the authoritative seq attached,
 * so it learns whether each push won or lost without a second question.
 */

/** Rows per pull. A client that hits this is told to come straight back. */
const PAGE = 500;

type StoredNote = Note & { seq: number };

function validNote(v: unknown): v is Note {
  if (typeof v !== "object" || v === null) return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    n.id.length > 0 &&
    n.id.length <= 64 &&
    typeof n.body === "string" &&
    typeof n.created_at === "number" &&
    Number.isFinite(n.created_at) &&
    typeof n.updated_at === "number" &&
    Number.isFinite(n.updated_at) &&
    (n.deleted_at === null || (typeof n.deleted_at === "number" && Number.isFinite(n.deleted_at)))
  );
}

const selectOne = db.prepare(
  "SELECT updated_at FROM notes WHERE user_id = ? AND id = ?",
);

const upsert = db.prepare(
  `INSERT INTO notes (id, user_id, body, created_at, updated_at, deleted_at, seq)
   VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(user_id, id) DO UPDATE SET
     body = excluded.body,
     created_at = excluded.created_at,
     updated_at = excluded.updated_at,
     deleted_at = excluded.deleted_at,
     seq = excluded.seq`,
);

const selectPage = db.prepare(
  `SELECT id, body, created_at, updated_at, deleted_at, seq
     FROM notes WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ${PAGE}`,
);

export function sync(session: Session, body: unknown): Reply {
  const payload = body as { since?: unknown; notes?: unknown } | undefined;
  const since =
    typeof payload?.since === "number" && Number.isFinite(payload.since) && payload.since >= 0
      ? payload.since
      : 0;
  const incoming = Array.isArray(payload?.notes) ? payload.notes : [];

  if (incoming.length > PAGE) {
    return { status: 413, json: { error: `push at most ${PAGE} notes at a time` } };
  }
  if (!incoming.every(validNote)) {
    return { status: 400, json: { error: "malformed note in payload" } };
  }

  const pushed = incoming as Note[];
  const touched = new Set<string>();

  // One transaction for the whole push: a client that loses its connection
  // halfway through should find the server unchanged, not half-updated.
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const note of pushed) {
      touched.add(note.id);
      const existing = selectOne.get(session.userId, note.id) as
        | { updated_at: number }
        | undefined;
      if (!acceptsPush(existing, note)) continue;
      upsert.run(
        note.id,
        session.userId,
        note.body,
        note.created_at,
        note.updated_at,
        note.deleted_at,
        nextSeq(),
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  const page = selectPage.all(session.userId, since) as StoredNote[];
  const cursor = page.length ? page[page.length - 1].seq : Math.min(since, currentSeq());

  // A push that lost its conflict leaves the winning row at a seq the client has
  // already passed, so the page above would not carry it. Without this the
  // client keeps its stale copy, keeps pushing it, and keeps losing — forever.
  const seen = new Set(page.map((n) => n.id));
  const stragglers: StoredNote[] = [];
  for (const id of touched) {
    if (seen.has(id)) continue;
    const row = db
      .prepare(
        `SELECT id, body, created_at, updated_at, deleted_at, seq
           FROM notes WHERE user_id = ? AND id = ?`,
      )
      .get(session.userId, id) as StoredNote | undefined;
    if (row) stragglers.push(row);
  }

  const notes = [...page, ...stragglers].map((n) => ({
    id: n.id,
    body: n.body,
    created_at: n.created_at,
    updated_at: n.updated_at,
    deleted_at: n.deleted_at,
    server_seq: n.seq,
  }));

  return {
    status: 200,
    json: { notes, seq: cursor, more: page.length === PAGE },
  };
}
