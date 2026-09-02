/**
 * The wire format and the note shape, shared by all three programs.
 *
 * The desktop app, the phone PWA and the server each keep their own copy of the
 * notes in their own kind of database, but they have to agree exactly on what a
 * note is and what a sync exchange looks like. Defining it once here is what
 * stops the three drifting apart — the same reasoning as `deriveTitle`, one
 * level up.
 */

/** A note as it exists on a client. */
export type Note = {
  /** UUID, minted by whichever client created the note. Never an integer: two
   *  offline devices would both pick the same next id and collide on sync. */
  id: string;
  body: string;
  created_at: number;
  updated_at: number;
  /** Soft delete. A row that simply vanished would be indistinguishable from
   *  one this device has not seen yet, and the next pull would resurrect it. */
  deleted_at: number | null;
};

/** A note plus the bookkeeping only the local database cares about. */
export type LocalNote = Note & {
  /** Edited here and not yet acknowledged by the server. */
  dirty: boolean;
  /** The server's counter value when it last confirmed this row. */
  server_seq: number;
};

/** What a client sends up: everything it has changed since the last exchange. */
export type PushNote = Note;

export type SyncRequest = {
  /** The highest server_seq this client has already seen. */
  since: number;
  notes: PushNote[];
};

export type SyncResponse = {
  /** Rows the server has that this client does not, plus the authoritative
   *  version of anything it just pushed that lost a conflict. */
  notes: (Note & { server_seq: number })[];
  /** The client's new cursor. */
  seq: number;
};

export type AuthRequestResponse = {
  request_id: string;
  /** Shown in the app so the user can match it against the email — proof they
   *  are approving the sign-in they actually started, not one someone else did. */
  code: string;
  expires_at: number;
};

export type AuthStatusResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; device_token: string; email: string };
