# Quiet sync server

Accounts and note sync for the desktop app and the phone. **No dependencies and
no build step** — Node 24 runs TypeScript directly and ships `node:sqlite`, so
this starts on any machine that has Node and nothing else:

    pnpm server            # node server/src/index.ts

It listens on `0.0.0.0:8787` and keeps everything in `server/data/`.

## Signing in

There are no passwords. The app asks for a sign-in and shows a six-digit code;
an email arrives with a link; opening the link approves the request and the app,
which has been polling, collects a device token.

The code is **not** a second secret — the link holds the only secret. It is
shown so you can confirm the email in front of you belongs to the sign-in you
just started, rather than one somebody else triggered for your address.

**Email is optional.** With no `RESEND_API_KEY` set, the link is printed to the
console and appended to `server/data/magic-links.txt`. For a server running on
your own desktop and serving only you, that is a perfectly good way to sign in
and it means the whole thing works with no account anywhere.

## Configuration

| Variable | Default | |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `0.0.0.0` | |
| `QUIET_PUBLIC_URL` | `http://localhost:$PORT` | **Set this.** The address in the emailed link — if it says localhost, the link only works on the server's own machine |
| `QUIET_DB` | `server/data/quiet-server.db` | |
| `QUIET_WEB_ROOT` | `mobile/dist` | Built PWA, served to the phone when present |
| `RESEND_API_KEY` | — | Real email via Resend's HTTP API |
| `QUIET_MAIL_FROM` | `Quiet <onboarding@resend.dev>` | |

## Reaching it from the phone

iOS will not install a PWA over plain HTTP — service workers need a secure
context, so `http://192.168.1.x:8787` gets you a bookmark rather than an offline
app. Three ways round it:

- **Tailscale.** `tailscale cert` issues a real certificate for your machine's
  tailnet name. Nothing is exposed to the internet, the phone needs no
  certificate installed, and it keeps working off your home wifi.
- **mkcert.** Generate a local CA, install the profile on the iPhone, trust it.
  Pure LAN, but the phone needs the certificate and the PC needs a stable name.
- **Neither**, if you are only testing desktop-to-server, which is plain HTTP.

## API

| | | |
|---|---|---|
| `POST` | `/auth/request` | `{email}` → `{request_id, code, expires_at}` |
| `GET` | `/auth/verify?token=` | Opened from the email. Approves the request |
| `GET` | `/auth/status?request_id=` | `pending` / `expired` / `approved` + device token |
| `GET` | `/auth/me` | Bearer. `{email}` |
| `POST` | `/auth/signout` | Bearer. Forgets this device |
| `POST` | `/sync` | Bearer. `{since, notes[]}` → `{notes[], seq, more}` |

`/sync` pushes and pulls in one exchange, so a client learns whether each push
won or lost without a second question.

## How sync decides

Last-write-wins per note on `updated_at`, ties going to the incumbent. That is
the right trade for one person's own devices: a real merge (CRDT, OT) costs an
order of magnitude more machinery to solve a problem you only have when you edit
*the same note* on *two devices* while *both* are offline. The honest cost is
that when that does happen, the older version's edits are lost rather than
merged. The rules live in `shared/sync.ts`, as pure functions both sides run.

Clients page through pulls by `seq`, the server's own write counter — never by
timestamp. Two devices' clocks disagree, and a note written on a slow clock
would otherwise be skipped forever.

Deletes are tombstones. A row that simply vanished is indistinguishable from one
a device has not seen yet, and the next pull would resurrect it.

## Checking it works

    pnpm server                    # in one terminal
    node server/smoke.ts           # in another

Signs in twice, pushes a note, pulls it back on a second device, forces a
conflict, checks another account sees none of it, and confirms tombstones and
input validation.
