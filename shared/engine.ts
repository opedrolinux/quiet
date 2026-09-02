import { pushPull } from "./api.ts";
import { applyIncoming, type LocalStore } from "./sync.ts";
import type { Note } from "./types.ts";

/*
 * Note the explicit .ts extensions: Vite does not need them, but Node resolves
 * modules by exact filename, and these files are imported by both.
 */

/**
 * One complete exchange with the server, for any client.
 *
 * The desktop keeps its notes in SQLite, the phone in IndexedDB and the tests
 * in a Map, but the *order of operations* — read cursor, gather unsent, push and
 * pull together, fold in the reply, advance the cursor, repeat while there is
 * more — must be identical on all of them. Writing it once is the only way to
 * be sure it is: two hand-maintained copies of a sync loop drift, and the
 * symptom is a note that quietly stops arriving on one device.
 *
 * Everything specific to a client is passed in.
 */

export type SyncDeps = {
  getSeq: () => Promise<number>;
  setSeq: (seq: number) => Promise<void>;
  /** Notes edited locally and not yet acknowledged. */
  dirty: () => Promise<Note[]>;
  store: LocalStore;
};

export type SyncOutcome =
  | { ok: true; changed: string[] }
  | { ok: false; kind: "offline" | "unauthorized" | "server"; detail: string };

/** Guards against a server that keeps claiming there is more. */
const MAX_PAGES = 20;

export async function runSync(
  url: string,
  token: string,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const changed: string[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    // Re-read both each round: a page can take a while, and the user may have
    // typed since.
    const since = await deps.getSeq();
    const outgoing = await deps.dirty();

    const res = await pushPull(url, token, since, outgoing);
    if (!res.ok) {
      return { ok: false, kind: res.error.kind, detail: res.error.detail };
    }

    changed.push(...(await applyIncoming(deps.store, res.value.notes)));
    await deps.setSeq(res.value.seq);

    // The server had a full page waiting; go straight back rather than leaving
    // the rest until the next trigger.
    if (!res.value.more) break;
  }

  return { ok: true, changed };
}
