use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

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
    vec![Migration {
        version: 1,
        description: "create notes and settings",
        // No title column: the title is always derived from the first line of
        // the body, so storing it separately could only ever drift.
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
    }]
}

pub fn run() {
    let summon_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);

    tauri::Builder::default()
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
