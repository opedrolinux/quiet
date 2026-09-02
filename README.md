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
| `Esc` | Hide; focus returns to whatever was underneath |
| `Ctrl+↑` / `Ctrl+↓` | Previous / next note |
| `Ctrl+N` | New note |
| `Ctrl+T` | Pin the note list open |
| `Ctrl+Shift+D` | Delete the current note (press twice to confirm) |
| `Ctrl+,` | Settings |
| `Ctrl+=` / `Ctrl+-` | Text size |
| `Alt` + drag | Move the window (there is no title bar) |

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

## Design notes

**The first line is the title.** There is no title field and no title column
in the database — `deriveTitle()` in `src/lib/title.ts` reads the first
non-empty line, and both the big text at the top of a note and its name in the
list come from that one function, so they cannot disagree.

**Dark glass, bright text.** Seven mockup rounds converged on this. Every
attempt at lighter or more transparent glass washed the text out over a bright
video, so the opacity slider has a floor (`MIN_GLASS_ALPHA`) rather than
running to zero.

**The note list costs zero width.** It is not a column. Opening it grows the
OS window on its *left* edge — width up, x down by the same amount — so the
editor keeps its exact screen position and the text never reflows.
