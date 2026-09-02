import type { LocalNote, Note } from "./types.ts";

/**
 * The reconciliation rules, as pure functions.
 *
 * Both clients and the server run the same comparison, so it lives here rather
 * than being written out three times slightly differently. Keeping it free of
 * database calls also means it can be reasoned about — and tested — without a
 * server, a phone, or a network.
 *
 * The policy is last-write-wins per note, on `updated_at`. That is the right
 * trade for one person's own devices: a real merge (CRDT, operational
 * transform) costs an order of magnitude more machinery to solve a problem you
 * only have if you edit the *same note* on *two devices* while *both* are
 * offline. The honest cost of LWW is that when that does happen, the older
 * version's edits are lost rather than merged.
 */

/** RFC 4122 v4, from the platform CSPRNG. */
export function uuid(): string {
  // Read through globalThis so the fallback below stays reachable: referencing
  // `crypto` directly lets TypeScript prove randomUUID always exists and narrow
  // the rest of the function to unreachable code.
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();

  // Older WebViews and iOS Safari before 15.4 have getRandomValues but not
  // randomUUID.
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ServerNote = Note & { server_seq: number };

export type MergeDecision =
  /** Take the server's copy. */
  | { action: "accept"; note: ServerNote }
  /** Ours is newer and still unsent; leave it alone and let the push carry it. */
  | { action: "keep-local" }
  /** Same content on both sides; only the cursor moves. */
  | { action: "cursor-only"; server_seq: number };

/**
 * Decide what to do with one note the server just handed us.
 *
 * The `dirty` check is the part that matters. Without it, a pull that happens
 * between a local edit and its push would overwrite what the user just typed
 * with the server's older copy — the edit would visibly disappear from under
 * the cursor.
 */
export function mergeIncoming(
  local: LocalNote | undefined,
  incoming: ServerNote,
): MergeDecision {
  if (!local) return { action: "accept", note: incoming };

  // A local edit that has not been pushed yet outranks anything older.
  if (local.dirty && local.updated_at > incoming.updated_at) {
    return { action: "keep-local" };
  }

  if (
    local.body === incoming.body &&
    local.updated_at === incoming.updated_at &&
    local.deleted_at === incoming.deleted_at
  ) {
    return { action: "cursor-only", server_seq: incoming.server_seq };
  }

  return { action: "accept", note: incoming };
}

/**
 * Decide whether a pushed note should replace what the server holds.
 *
 * Ties go to the incumbent: if two devices genuinely write in the same
 * millisecond there is no basis to prefer either, and refusing the change
 * keeps the server's answer stable no matter what order the pushes arrive in.
 */
export function acceptsPush(
  existing: Pick<Note, "updated_at"> | undefined,
  incoming: Pick<Note, "updated_at">,
): boolean {
  if (!existing) return true;
  return incoming.updated_at > existing.updated_at;
}

/** A blank note, ready to be inserted locally. */
export function newNote(now = Date.now()): Note {
  return { id: uuid(), body: "", created_at: now, updated_at: now, deleted_at: null };
}

/**
 * The three operations a client's local store has to provide for a sync.
 *
 * Narrow on purpose: the desktop implements it over SQLite, the phone over
 * IndexedDB, and the convergence test over a plain Map — and because all three
 * drive `applyIncoming` below, the test exercises the code that actually ships
 * rather than a transcription of it.
 */
export type LocalStore = {
  get(id: string): Promise<LocalNote | undefined>;
  /** Overwrite with the server's version and mark it settled. */
  accept(note: Note, serverSeq: number): Promise<void>;
  /** Clear the dirty flag, but only if the note has not been typed into since. */
  markPushed(id: string, updatedAt: number, serverSeq: number): Promise<void>;
};

/**
 * Fold one page of server rows into a local store.
 *
 * Returns the ids whose content actually changed, so a client can tell the
 * difference between "the server had news" and "the server confirmed what I
 * already knew" — only the former should disturb what is on screen.
 */
export async function applyIncoming(
  store: LocalStore,
  incoming: ServerNote[],
): Promise<string[]> {
  const changed: string[] = [];
  for (const note of incoming) {
    const local = await store.get(note.id);
    const decision = mergeIncoming(local, note);
    if (decision.action === "accept") {
      await store.accept(decision.note, note.server_seq);
      changed.push(note.id);
    } else if (decision.action === "cursor-only") {
      // Our own push, coming back. Settling it here is what stops the note
      // being pushed again on every single sync, forever.
      await store.markPushed(note.id, note.updated_at, decision.server_seq);
    }
    // "keep-local": ours is newer and unsent; the next push carries it.
  }
  return changed;
}
