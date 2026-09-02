# Quiet on a phone

An installable web app. No Mac, no Apple Developer account, no App Store
review — you open a URL in Safari, add it to the Home Screen, and it becomes a
real icon that opens fullscreen with no browser chrome and works offline.

    pnpm build:mobile      # into mobile/dist, which the sync server serves
    pnpm dev:mobile        # vite on :1421, for working on it

## Why it is not the desktop app made smaller

Everything that defines Quiet on Windows — no chrome, always on top, summoned
over a video with a hotkey — either does not exist on iOS or means nothing
there. There are no overlay windows and no global shortcuts on a phone. What
carries across is the part that was never about the window: your notes, and the
rule that the first line is the title.

So the title is its own field here rather than a styled first line. A phone has
autocorrect, a virtual keyboard and a real text cursor, and a plain `<textarea>`
handles all three properly where an editor drawing its own caret does not. On
the wire the note is unchanged — title, newline, rest — so `deriveTitle` gives
the desktop and the phone the same answer.

## Getting it onto the iPhone

The app is served by the sync server, so the phone needs to reach that server
over **HTTPS**. This is not optional: service workers require a secure context,
and without one iOS gives you a bookmark rather than an installable app.

**Tailscale** is the least painful route. It is free for personal use, nothing
is exposed to the internet, the phone needs no certificate installed, and it
keeps working when you are not on home wifi:

    tailscale cert your-machine.your-tailnet.ts.net
    # then serve the app behind that certificate, and:
    QUIET_PUBLIC_URL=https://your-machine.your-tailnet.ts.net pnpm server

**mkcert** works too if you want pure LAN — generate a local CA, install the
profile on the iPhone and trust it under Settings → General → VPN & Device
Management, then Certificate Trust Settings. More steps, and it stops working
away from home.

Then on the phone: open the URL in **Safari** (not Chrome — only Safari can
install to the Home Screen), tap Share, tap *Add to Home Screen*.

`QUIET_PUBLIC_URL` matters. It is the address baked into the emailed sign-in
link, and if it still says `localhost` the link will only work on the machine
running the server.

## What it does and does not do

Notes are kept in IndexedDB, not localStorage — asynchronous, far larger, and
it stores objects rather than strings. The app works with no signal and syncs
when it can: on launch, when you switch back to it, when the network returns,
and once a minute.

iOS may evict that storage if the app goes unused for a long stretch. That is
survivable rather than fatal: everything also lives on the server, and a
signed-in app refills itself on the next sync. It is why the device token is
worth keeping even when the notes are gone.

No background sync and no push notifications — iOS gives an installed web app
neither in any form worth relying on. The app syncs when it is open. For a
notes app you deliberately open to read or write, that is the whole of it.

## If you later want a real App Store app

Expo's EAS Build compiles iOS on their Macs, so you still would not need one —
but installing on a physical iPhone needs signing credentials, which means an
Apple Developer account at $99/year. The server, the accounts and the sync
protocol would all be unchanged; only this folder would be rewritten in React
Native.
