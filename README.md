# Quiet

A notes app for studying: it floats over the course video you're watching,
costs one keystroke to enter and one to leave, and shows nothing on screen
except your text.

The design target is in `design/` — `01-resting.png` (how it looks while you
write) and `02-switcher.png` (the note list open).

## Keys

| Key | |
|---|---|
| `Ctrl+Alt+N` | Summon from anywhere, caret lands in the text |
| `Esc` | Give the keyboard back to the app underneath, note stays visible |
| `Ctrl+H` | Hide the window entirely (it keeps running in the tray) |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next note |
| `Ctrl+1` … `Ctrl+9` | Jump straight to a note |
| `Ctrl+N` | New note |
| `Ctrl+T` | Pin the note list open |
| `Ctrl+Shift+D` | Delete the current note (press twice to confirm) |
| `Ctrl+,` | Settings |
| `Ctrl+=` / `Ctrl+-` | Text size |
| `Alt` + drag | Move the window (there is no title bar) |

`Esc` and `Ctrl+H` are the two ways out and they are not the same. `Esc` leaves
the note on screen and only stops typing into it, which is what you want with a
video playing behind it. `Ctrl+H` puts it away.

## Running it

Needs Rust and the Visual Studio C++ build tools:

    winget install Rustlang.Rustup
    winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Then:

    pnpm install
    pnpm tauri dev      # run
    pnpm tauri build    # installer in src-tauri/target/release/bundle

`pnpm dev` alone opens the UI in a browser with notes kept in localStorage.
Useful for working on the design without the Rust toolchain; the real app
always uses SQLite.

The app icon is generated, not drawn: `node scripts/make-icon.mjs` writes
`src-tauri/icons/source.png`, and `pnpm tauri icon src-tauri/icons/source.png`
expands it into the platform sizes.

## Design notes

**The first line is the title.** There is no title field and no title column
in the database — `deriveTitle()` in `src/lib/title.ts` reads the first
non-empty line, and both the big text at the top of a note and its name in the
list come from that one function, so they cannot disagree.

**Dark glass, bright text.** Seven mockup rounds converged on this. Every
attempt at lighter or more transparent glass washed the text out over a bright
video, so the opacity slider has a floor (`MIN_GLASS_ALPHA`) rather than
running to zero.

**The note list costs zero width.** It is not a column — closed, it is zero
pixels wide. Opening it widens the OS window on its right edge, and the editor
keeps its exact width throughout, so the text never reflows.

**The panel slides in CSS, not in JavaScript.** `--switcher-w` is registered
with `@property` so it can be transitioned like any other length, and the OS
window is resized exactly twice per toggle. The first version drove both from
`requestAnimationFrame`, one resize per frame; a transparent acrylic window
cannot keep up with that, and the result popped and juddered. During the slide
the glass is sized from `--app-base`, a width measured *before* the resize, so
it does not matter which frame the resize actually lands on.

**Esc cannot just hide.** A window can't un-focus itself, so Quiet records the
foreground window before it steals focus and hands it back with
`SetForegroundWindow`. Windows blocks that from a background process unless the
calling thread is attached to the foreground thread, hence the
`AttachThreadInput` pair in `back_focus`. If it is refused anyway, `Esc` falls
back to hiding, so it always does something.

**Both exits fire on keyup.** Acting on keydown transfers focus while the key
is still held, and the *keyup* then lands in the other window — a fullscreen
video would take the `Esc` as its own and leave fullscreen.
