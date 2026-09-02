/**
 * End-to-end check of the sync server: sign in, push a note, pull it back on a
 * second device, and prove a conflict resolves the way it is supposed to.
 *
 * Run against a server started with QUIET_MAIL_LOG pointing somewhere
 * disposable, since it reads the magic link straight out of that file:
 *
 *   node server/smoke.ts [base-url]
 */
import { readFileSync } from "node:fs";
import { uuid } from "../shared/sync.ts";
import type { SyncResponse } from "../shared/types.ts";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const MAIL_LOG = process.env.QUIET_MAIL_LOG ?? "server/data/magic-links.txt";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

async function api(path: string, init: RequestInit = {}): Promise<[number, any]> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  try {
    return [res.status, text ? JSON.parse(text) : null];
  } catch {
    return [res.status, text];
  }
}

async function signIn(email: string): Promise<string> {
  const [, req] = await api("/auth/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });

  // The link is written to the mail log when no email provider is configured.
  const log = readFileSync(MAIL_LOG, "utf8");
  const links = [...log.matchAll(/\/auth\/verify\?token=([^\s]+)/g)];
  const token = links[links.length - 1][1];

  const verified = await fetch(`${BASE}/auth/verify?token=${token}`);
  check("magic link accepted", verified.status === 200, `status ${verified.status}`);

  const [, status] = await api(`/auth/status?request_id=${req.request_id}`);
  check("device token issued", status.status === "approved", JSON.stringify(status).slice(0, 80));
  return status.device_token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

const now = Date.now();
const email = `smoke-${now}@example.com`;

console.log(`\nsmoke test against ${BASE} as ${email}\n`);

const [health] = await api("/health");
check("server is up", health === 200, `status ${health}`);
if (health !== 200) {
  console.error("\nserver not reachable — start it with `pnpm server`\n");
  process.exit(1);
}

// --- auth ---------------------------------------------------------------
const deviceA = await signIn(email);
const [meStatus, me] = await api("/auth/me", { headers: auth(deviceA) });
check("token identifies the user", meStatus === 200 && me.email === email, me?.email);

const [unauth] = await api("/sync", { method: "POST", body: "{}" });
check("sync rejects an unauthenticated caller", unauth === 401, `status ${unauth}`);

const [badToken] = await api("/sync", {
  method: "POST",
  body: "{}",
  headers: auth("not-a-real-token"),
});
check("sync rejects a bogus token", badToken === 401, `status ${badToken}`);

// --- push and pull ------------------------------------------------------
const noteId = uuid();
const [pushStatus, pushed] = (await api("/sync", {
  method: "POST",
  headers: auth(deviceA),
  body: JSON.stringify({
    since: 0,
    notes: [
      { id: noteId, body: "LEARNING\n\nswitches", created_at: now, updated_at: now, deleted_at: null },
    ],
  }),
})) as [number, SyncResponse];
check("push accepted", pushStatus === 200, `status ${pushStatus}`);
check("push echoes the note back with a seq", pushed.notes.length === 1 && pushed.notes[0].server_seq > 0);

// A second device on the same account, starting from nothing.
const deviceB = await signIn(email);
const [, pulled] = (await api("/sync", {
  method: "POST",
  headers: auth(deviceB),
  body: JSON.stringify({ since: 0, notes: [] }),
})) as [number, SyncResponse];
const seen = pulled.notes.find((n) => n.id === noteId);
check("second device pulls the note", !!seen, seen ? JSON.stringify(seen.body) : "missing");
check("body survived the round trip", seen?.body === "LEARNING\n\nswitches");

// --- conflict -----------------------------------------------------------
// Device B writes newer, device A writes older. B must win, and A must be told.
await api("/sync", {
  method: "POST",
  headers: auth(deviceB),
  body: JSON.stringify({
    since: pulled.seq,
    notes: [{ id: noteId, body: "newer from B", created_at: now, updated_at: now + 5000, deleted_at: null }],
  }),
});
const [, loser] = (await api("/sync", {
  method: "POST",
  headers: auth(deviceA),
  body: JSON.stringify({
    since: pushed.seq,
    notes: [{ id: noteId, body: "older from A", created_at: now, updated_at: now + 1000, deleted_at: null }],
  }),
})) as [number, SyncResponse];
const resolved = loser.notes.find((n) => n.id === noteId);
check("newer write wins the conflict", resolved?.body === "newer from B", resolved?.body);
check("loser is told the authoritative version", !!resolved);

// --- isolation ----------------------------------------------------------
const strangerToken = await signIn(`stranger-${now}@example.com`);
const [, stranger] = (await api("/sync", {
  method: "POST",
  headers: auth(strangerToken),
  body: JSON.stringify({ since: 0, notes: [] }),
})) as [number, SyncResponse];
check("another account sees none of it", stranger.notes.length === 0, `${stranger.notes.length} notes`);

// --- deletion -----------------------------------------------------------
await api("/sync", {
  method: "POST",
  headers: auth(deviceB),
  body: JSON.stringify({
    since: 0,
    notes: [{ id: noteId, body: "newer from B", created_at: now, updated_at: now + 9000, deleted_at: now + 9000 }],
  }),
});
const [, afterDelete] = (await api("/sync", {
  method: "POST",
  headers: auth(deviceA),
  body: JSON.stringify({ since: 0, notes: [] }),
})) as [number, SyncResponse];
const tombstone = afterDelete.notes.find((n) => n.id === noteId);
check("deletion propagates as a tombstone", tombstone?.deleted_at !== null && tombstone?.deleted_at !== undefined);

// --- validation ---------------------------------------------------------
const [malformed] = await api("/sync", {
  method: "POST",
  headers: auth(deviceA),
  body: JSON.stringify({ since: 0, notes: [{ id: 42, body: "wrong types" }] }),
});
check("malformed notes are refused", malformed === 400, `status ${malformed}`);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
