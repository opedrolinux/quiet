import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db.ts";
import { sendMagicLink } from "./mail.ts";
import type { Reply } from "./http.ts";

/**
 * Passwordless sign-in.
 *
 * The flow is the one a desktop app actually needs. The app asks for a sign-in,
 * gets back a request id and a short code it displays; the email carries a link
 * holding the real secret. Clicking the link — on any device — approves the
 * request, and the app, which has been polling, picks up its device token.
 *
 * The code is not a second secret; it is shown so the user can check that the
 * email in front of them belongs to the sign-in *they* started, rather than one
 * an attacker triggered for the same address hoping they would click through.
 */

const TTL_MS = 15 * 60 * 1000;
/** Sign-in attempts allowed per address per window, before we stop emailing. */
const THROTTLE_MAX = 5;
const THROTTLE_MS = 10 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
const uuid = () => crypto.randomUUID();

/** Normalised so Foo@Example.com and foo@example.com are one account. */
function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // Deliberately loose: the address only has to survive being emailed, and the
  // link arriving is the real proof it exists.
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }
  return email;
}

export function publicUrl(): string {
  return (process.env.QUIET_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(
    /\/$/,
    "",
  );
}

export async function requestSignIn(body: unknown): Promise<Reply> {
  const email = normaliseEmail((body as { email?: unknown })?.email);
  if (!email) return { status: 400, json: { error: "a valid email is required" } };

  const now = Date.now();
  const recent = db
    .prepare("SELECT COUNT(*) AS n FROM auth_requests WHERE email = ? AND created_at > ?")
    .get(email, now - THROTTLE_MS) as { n: number };
  if (recent.n >= THROTTLE_MAX) {
    return { status: 429, json: { error: "too many sign-in attempts, wait a few minutes" } };
  }

  const id = uuid();
  const token = secret();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = now + TTL_MS;

  db.prepare(
    `INSERT INTO auth_requests (id, email, code, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, email, code, sha256(token), now, expiresAt);

  await sendMagicLink({
    to: email,
    link: `${publicUrl()}/auth/verify?token=${encodeURIComponent(token)}`,
    code,
    expiresAt,
  });

  return { status: 200, json: { request_id: id, code, expires_at: expiresAt } };
}

/** Hit by the browser when the emailed link is opened. */
export function verify(token: string | null): Reply {
  if (!token) return { status: 400, html: page("Something is missing", "That link is incomplete.") };

  const row = db
    .prepare(
      `SELECT id, email, expires_at, approved_at FROM auth_requests WHERE token_hash = ?`,
    )
    .get(sha256(token)) as
    | { id: string; email: string; expires_at: number; approved_at: number | null }
    | undefined;

  if (!row) return { status: 404, html: page("Not a valid link", "Start the sign-in again.") };
  if (row.approved_at) {
    return { status: 200, html: page("Already approved", "You can close this tab.") };
  }
  if (row.expires_at < Date.now()) {
    return { status: 410, html: page("This link expired", "Start the sign-in again from the app.") };
  }

  const now = Date.now();
  let user = db.prepare("SELECT id FROM users WHERE email = ?").get(row.email) as
    | { id: string }
    | undefined;
  if (!user) {
    user = { id: uuid() };
    db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)").run(
      user.id,
      row.email,
      now,
    );
  }

  const deviceToken = secret();
  db.prepare(
    `INSERT INTO devices (id, user_id, token_hash, name, created_at, last_seen)
     VALUES (?, ?, ?, '', ?, ?)`,
  ).run(uuid(), user.id, sha256(deviceToken), now, now);

  // Parked here for the polling app to collect, then wiped on first read.
  db.prepare("UPDATE auth_requests SET approved_at = ?, device_token = ? WHERE id = ?").run(
    now,
    deviceToken,
    row.id,
  );

  return { status: 200, html: page("Signed in", "You can close this tab and go back to Quiet.") };
}

/** Polled by the app while it waits for the link to be clicked. */
export function signInStatus(requestId: string | null): Reply {
  if (!requestId) return { status: 400, json: { error: "request_id is required" } };

  const row = db
    .prepare(
      `SELECT id, email, expires_at, approved_at, device_token
         FROM auth_requests WHERE id = ?`,
    )
    .get(requestId) as
    | {
        id: string;
        email: string;
        expires_at: number;
        approved_at: number | null;
        device_token: string | null;
      }
    | undefined;

  if (!row) return { status: 404, json: { error: "no such request" } };

  if (row.approved_at && row.device_token) {
    // One-shot: a token left lying in the table is a token that can be stolen
    // from it later.
    db.prepare("UPDATE auth_requests SET device_token = NULL WHERE id = ?").run(row.id);
    return {
      status: 200,
      json: { status: "approved", device_token: row.device_token, email: row.email },
    };
  }
  if (row.approved_at) return { status: 200, json: { status: "expired" } };
  if (row.expires_at < Date.now()) return { status: 200, json: { status: "expired" } };
  return { status: 200, json: { status: "pending" } };
}

export type Session = { userId: string; deviceId: string; email: string };

/** Resolve `Authorization: Bearer <token>` to a user, or null. */
export function authenticate(header: string | undefined): Session | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT d.id AS deviceId, d.user_id AS userId, d.token_hash AS hash, u.email AS email
         FROM devices d JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = ?`,
    )
    .get(sha256(token)) as
    | { deviceId: string; userId: string; hash: string; email: string }
    | undefined;
  if (!row) return null;

  // The lookup above already matched on the hash; this compares it again in
  // constant time so the code does not depend on SQLite's comparison timing.
  const a = Buffer.from(row.hash);
  const b = Buffer.from(sha256(token));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  db.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").run(Date.now(), row.deviceId);
  return { userId: row.userId, deviceId: row.deviceId, email: row.email };
}

export function signOut(session: Session): Reply {
  db.prepare("DELETE FROM devices WHERE id = ?").run(session.deviceId);
  return { status: 204 };
}

/** Deletes expired sign-in attempts. Called on a timer from index.ts. */
export function sweepExpired(): void {
  db.prepare("DELETE FROM auth_requests WHERE expires_at < ?").run(Date.now() - TTL_MS);
}

function page(title: string, detail: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Quiet</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#121214; color:#f2f2f0;
         font:400 15px/1.6 "Segoe UI", system-ui, sans-serif }
  main { text-align:center; padding:32px }
  h1 { font-size:26px; font-weight:700; color:#3b6fd4; margin:0 0 8px }
  p { margin:0; color:#8d8d8a }
</style>
<main><h1>${title}</h1><p>${detail}</p></main>`;
}
