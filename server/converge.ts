/**
 * Convergence test: two devices, one server, no React.
 *
 * The simulated device below is deliberately thin: it supplies storage and
 * nothing else, and hands the actual exchange to `runSync` from
 * shared/engine.ts — the same function the desktop app and the phone call. So
 * this exercises the shipping logic rather than a re-implementation of it that
 * could quietly disagree.
 *
 *   node server/converge.ts [base-url]
 */
import { readFileSync } from "node:fs";
import { runSync } from "../shared/engine.ts";
import { newNote, type LocalStore } from "../shared/sync.ts";
import type { LocalNote, Note } from "../shared/types.ts";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const MAIL_LOG = process.env.QUIET_MAIL_LOG ?? "server/data/magic-links.txt";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function signIn(email: string): Promise<string> {
  const req = await api("/auth/request", { method: "POST", body: JSON.stringify({ email }) });
  const log = readFileSync(MAIL_LOG, "utf8");
  const links = [...log.matchAll(/\/auth\/verify\?token=([^\s]+)/g)];
  await fetch(`${BASE}/auth/verify?token=${links[links.length - 1][1]}`);
  const status = await api(`/auth/status?request_id=${req.request_id}`);
  return status.device_token;
}

/** A device: a bag of notes, a cursor, and the shared merge logic. */
class Device {
  readonly notes = new Map<string, LocalNote>();
  seq = 0;

  name: string;
  token: string;

  // Plain assignment, not constructor parameter properties: Node strips types
  // rather than compiling them, so `constructor(private x: T)` is a syntax
  // error here. Same reason there are no enums or namespaces anywhere in the
  // server.
  constructor(name: string, token: string) {
    this.name = name;
    this.token = token;
  }

  store: LocalStore = {
    get: async (id) => this.notes.get(id),
    accept: async (note, server_seq) => {
      this.notes.set(note.id, { ...note, dirty: false, server_seq });
    },
    markPushed: async (id, updated_at, server_seq) => {
      const n = this.notes.get(id);
      // Same guard as the real store: a keystroke that landed mid-request must
      // not be marked as saved.
      if (n && n.updated_at === updated_at) {
        this.notes.set(id, { ...n, dirty: false, server_seq });
      }
    },
  };

  create(body: string, at = Date.now()): string {
    const note = { ...newNote(at), body };
    this.notes.set(note.id, { ...note, dirty: true, server_seq: 0 });
    return note.id;
  }

  edit(id: string, body: string, at: number): void {
    const n = this.notes.get(id)!;
    this.notes.set(id, { ...n, body, updated_at: at, dirty: true });
  }

  remove(id: string, at: number): void {
    const n = this.notes.get(id)!;
    this.notes.set(id, { ...n, deleted_at: at, updated_at: at, dirty: true });
  }

  async sync(): Promise<void> {
    // The real loop, from shared/engine.ts — the same code the desktop app and
    // the phone run. Only the storage underneath it is simulated.
    const outcome = await runSync(BASE, this.token, {
      getSeq: async () => this.seq,
      setSeq: async (seq) => {
        this.seq = seq;
      },
      dirty: async () =>
        [...this.notes.values()]
          .filter((n) => n.dirty)
          .map(({ id, body, created_at, updated_at, deleted_at }): Note => ({
            id,
            body,
            created_at,
            updated_at,
            deleted_at,
          })),
      store: this.store,
    });
    if (!outcome.ok) throw new Error(`${this.name}: sync failed — ${outcome.detail}`);
  }

  /** What the user would actually see in the switcher. */
  visible(): LocalNote[] {
    return [...this.notes.values()]
      .filter((n) => n.deleted_at === null)
      .sort((a, b) => b.updated_at - a.updated_at);
  }

  get dirtyCount(): number {
    return [...this.notes.values()].filter((n) => n.dirty).length;
  }

  body(id: string): string | undefined {
    return this.notes.get(id)?.body;
  }
}

const t0 = Date.now();
const email = `converge-${t0}@example.com`;
console.log(`\nconvergence test against ${BASE}\n`);

const desktop = new Device("desktop", await signIn(email));
const phone = new Device("phone", await signIn(email));

// --- a note made on one device reaches the other -------------------------
const lecture = desktop.create("LECTURE 4\n\nrouting tables", t0);
desktop.create("SHOPPING\n\nmilk", t0 + 1);
await desktop.sync();
await phone.sync();

check("phone received both notes", phone.visible().length === 2, `${phone.visible().length}`);
check("body arrived intact", phone.body(lecture) === "LECTURE 4\n\nrouting tables");

// --- pushes settle, rather than repeating forever ------------------------
check("desktop has nothing left to push", desktop.dirtyCount === 0, `${desktop.dirtyCount} dirty`);
await desktop.sync();
await desktop.sync();
check("still nothing after two more syncs", desktop.dirtyCount === 0, `${desktop.dirtyCount} dirty`);

// --- both edit the same note while offline -------------------------------
desktop.edit(lecture, "edited on desktop", t0 + 1000);
phone.edit(lecture, "edited on phone", t0 + 2000); // later, so the phone wins

await desktop.sync(); // desktop pushes first and briefly wins
await phone.sync(); // phone pushes newer, takes it
await desktop.sync(); // desktop learns it lost

check("later edit wins on the phone", phone.body(lecture) === "edited on phone", phone.body(lecture));
check("desktop converged to the same text", desktop.body(lecture) === "edited on phone", desktop.body(lecture));
check("no dirty rows left anywhere", desktop.dirtyCount === 0 && phone.dirtyCount === 0);

// --- deletion propagates and stays deleted -------------------------------
phone.remove(lecture, t0 + 3000);
await phone.sync();
await desktop.sync();
check("delete reached the desktop", desktop.visible().length === 1, `${desktop.visible().length} visible`);

// The resurrection test: a tombstone must survive repeated exchanges.
await desktop.sync();
await phone.sync();
await desktop.sync();
check("deleted note stays deleted", desktop.visible().length === 1, `${desktop.visible().length} visible`);
check("phone agrees", phone.visible().length === 1, `${phone.visible().length} visible`);

// --- a fresh device catches up from nothing ------------------------------
const laptop = new Device("laptop", await signIn(email));
await laptop.sync();
check("new device sees the surviving note", laptop.visible().length === 1, `${laptop.visible().length}`);
check(
  "new device does not see the deleted one",
  laptop.visible().every((n) => n.id !== lecture),
);

// --- offline edits queue up and land later -------------------------------
const offline = laptop.visible()[0].id;
laptop.edit(offline, "written with no server", t0 + 5000);
check("edit is queued", laptop.dirtyCount === 1);
await laptop.sync();
await desktop.sync();
check("queued edit reached the desktop", desktop.body(offline) === "written with no server", desktop.body(offline));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
