use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

/// The window that had focus immediately before Quiet was summoned.
///
/// Captured before showing our own window, because once we take focus the
/// information is gone. This is what lets Esc hand the keyboard back without
/// hiding the note.
#[derive(Default)]
struct PrevFocus(Mutex<isize>);

#[cfg(target_os = "windows")]
fn foreground_window() -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe { GetForegroundWindow() as isize }
}

#[cfg(not(target_os = "windows"))]
fn foreground_window() -> isize {
    0
}

/// Return the keyboard to the app that had it, leaving our window visible.
///
/// Windows refuses SetForegroundWindow from a process that does not own the
/// foreground, unless the calling thread is attached to the current foreground
/// thread — hence the AttachThreadInput dance. Without it this silently does
/// nothing about half the time.
#[tauri::command]
fn back_focus(prev: State<'_, PrevFocus>) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
            SetForegroundWindow, GW_HWNDNEXT,
        };

        let stored = *prev.0.lock().unwrap();
        let mut target = stored as HWND;

        unsafe {
            // The remembered window may have been closed since. Fall back to
            // the next visible window below ours in the Z-order.
            if target.is_null() || IsWindow(target) == 0 || IsWindowVisible(target) == 0 {
                let mut h = GetWindow(GetForegroundWindow(), GW_HWNDNEXT);
                while !h.is_null() {
                    if IsWindowVisible(h) != 0 {
                        break;
                    }
                    h = GetWindow(h, GW_HWNDNEXT);
                }
                target = h;
            }
            if target.is_null() {
                return false;
            }

            let fg = GetForegroundWindow();
            let fg_thread = GetWindowThreadProcessId(fg, std::ptr::null_mut());
            let this_thread = GetCurrentThreadId();
            let attached =
                fg_thread != this_thread && AttachThreadInput(this_thread, fg_thread, 1) != 0;

            let ok = SetForegroundWindow(target) != 0;

            if attached {
                AttachThreadInput(this_thread, fg_thread, 0);
            }
            return ok;
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = prev;
        false
    }
}

/// Bring the note window back and put the caret in it.
///
/// `set_focus` matters as much as `show`: the whole promise of the app is that
/// one keystroke gets you typing, without an alt-tab hunt.
fn summon(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create notes and settings",
            // No title column: the title is always derived from the first line
            // of the body, so storing it separately could only ever drift.
            sql: "CREATE TABLE IF NOT EXISTS notes (
                id         INTEGER PRIMARY KEY,
                body       TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
              );
              CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "uuid note ids and sync bookkeeping",
            // Autoincrement ids cannot survive sync: two devices offline both
            // mint the same next id for different notes and collide the moment
            // they meet. Ids become client-generated UUIDs instead, minted here
            // for the notes that already exist.
            //
            // deleted_at rather than DELETE, because a row that simply vanishes
            // is indistinguishable from one this device has not seen yet — the
            // deletion would be undone by the next pull.
            //
            // dirty marks local edits not yet acknowledged by the server, and
            // server_seq is the server's own monotonic counter, which is what
            // pulls page through. Wall clocks are for conflict resolution only;
            // they are never trusted for ordering.
            sql: "CREATE TABLE notes_v2 (
                id         TEXT PRIMARY KEY,
                body       TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER,
                dirty      INTEGER NOT NULL DEFAULT 1,
                server_seq INTEGER NOT NULL DEFAULT 0
              );
              INSERT INTO notes_v2 (id, body, created_at, updated_at)
                SELECT lower(
                         hex(randomblob(4)) || '-' ||
                         hex(randomblob(2)) || '-4' ||
                         substr(hex(randomblob(2)), 2) || '-' ||
                         substr('89ab', abs(random()) % 4 + 1, 1) ||
                         substr(hex(randomblob(2)), 2) || '-' ||
                         hex(randomblob(6))
                       ),
                       body, created_at, updated_at
                FROM notes;
              DROP TABLE notes;
              ALTER TABLE notes_v2 RENAME TO notes;
              CREATE INDEX idx_notes_updated ON notes (updated_at DESC);
              CREATE INDEX idx_notes_dirty ON notes (dirty) WHERE dirty = 1;",
            kind: MigrationKind::Up,
        },
    ]
}

pub fn run() {
    let summon_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);

    tauri::Builder::default()
        .manage(PrevFocus::default())
        .invoke_handler(tauri::generate_handler![back_focus])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:quiet.db", migrations())
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    // Fire on press only, or the window toggles twice per tap.
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &summon_shortcut {
                        // Capture the outgoing foreground window BEFORE we
                        // steal focus, or Esc has nothing to hand back to.
                        if let Some(state) = app.try_state::<PrevFocus>() {
                            *state.0.lock().unwrap() = foreground_window();
                        }
                        if let Some(w) = app.get_webview_window("main") {
                            summon(&w);
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let window = app.get_webview_window("main").expect("main window");

            // Windows 11 acrylic. The webview itself is transparent, so this is
            // what actually produces the frosted glass in design/01-resting.png.
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                // Must stay in step with --glass in theme.css, or the native
                // blur and the webview's own tint read as two different colours.
                if let Err(e) = apply_acrylic(&window, Some((18, 18, 20, 125))) {
                    eprintln!("acrylic unavailable, falling back to plain transparency: {e}");
                }
            }

            // Registration fails if something else already owns the combination.
            // Say so loudly rather than leaving the app silently unsummonable.
            if let Err(e) = app.global_shortcut().register(summon_shortcut) {
                eprintln!("could not register Ctrl+Alt+N: {e}");
            }

            // The app has no taskbar entry, so the tray is the only way back in
            // if the shortcut is taken.
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Quiet — Ctrl+Alt+N")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            summon(&w);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides instead of quitting: the point is that it is always
            // one keystroke away. Quit lives in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Quiet");
}
