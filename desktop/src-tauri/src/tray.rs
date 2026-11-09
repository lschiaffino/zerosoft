//! Ícono de la barra de menú (Mac) o de la bandeja (Windows) y su menú; menú de la app en Mac.

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::config::paste_last_shortcut;
use crate::dictation::{self, shortcut_label};
use crate::state::{now_ms, AppState};
use crate::strings::{fill, t};

const TRAY_ID: &str = "main";

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let st = app.state::<AppState>();
    let l = st.locale;
    let (mode, shortcut) = {
        let s = st.settings.lock().unwrap();
        (s.mode.clone(), s.shortcut.clone())
    };
    let pending = st.pending.list(now_ms()).len();
    let recording = dictation::is_recording(app);
    let key = shortcut_label(&shortcut);
    let hint = if mode == "toggle" { None } else { Some(fill(&t(l, "dictateHint"), &[("key", &key)])) };
    let (voice_off, rec_off) = {
        let d = st.disabled_apps.lock().unwrap();
        (d.iter().any(|a| a == "voice"), d.iter().any(|a| a == "rec"))
    };
    let recording_meeting = st.recording.lock().unwrap().is_some() && !rec_off;
    let mut b = MenuBuilder::new(app).item(&MenuItem::with_id(app, "open", t(l, "open"), true, None::<&str>)?);
    if recording_meeting {
        b = b
            .item(&MenuItem::with_id(app, "rec-open", t(l, "recOpenItem"), true, None::<&str>)?)
            .item(&MenuItem::with_id(app, "rec-stop", t(l, "recStopItem"), true, None::<&str>)?);
    }
    b = b.separator();
    // El dictado es de la app Voice: si el workspace la apagó, sus ítems no salen.
    if !voice_off {
        b = b.item(&MenuItem::with_id(app, "dictate", if recording { t(l, "dictateStop") } else { t(l, "dictateStart") }, true, None::<&str>)?);
        if let Some(h) = hint {
            b = b.item(&MenuItem::with_id(app, "hint", h, false, None::<&str>)?);
        }
        let last = paste_last_shortcut(if cfg!(target_os = "macos") { "macos" } else { "windows" });
        b = b.item(&MenuItem::with_id(app, "paste-last", format!("{}  ({})", t(l, "pasteLastItem"), shortcut_label(last)), true, None::<&str>)?);
        if pending > 0 {
            b = b.item(&MenuItem::with_id(app, "retry", fill(&t(l, "retryPendingItem"), &[("n", &pending.to_string())]), true, None::<&str>)?);
        }
        b = b.item(&MenuItem::with_id(app, "history", t(l, "historyItem"), true, None::<&str>)?).separator();
    }
    if let Some(v) = st.update_ready.lock().unwrap().clone() {
        b = b.item(&MenuItem::with_id(app, "restart-update", format!("{} ({v})", t(l, "restartToUpdate")), true, None::<&str>)?);
    }
    b.item(&MenuItem::with_id(app, "settings", t(l, "settings"), true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "check-updates", t(l, "checkUpdates"), true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "sign-out", t(l, "signOut"), true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "quit", t(l, "quit"), true, None::<&str>)?)
        .build()
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => crate::show_main(app),
        "rec-open" => crate::indicator::open(app),
        "rec-stop" => crate::indicator::stop(app),
        "dictate" => {
            if dictation::is_recording(app) {
                dictation::stop(app);
            } else {
                dictation::start(app, true);
            }
        }
        "paste-last" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { dictation::paste_last(&app).await });
        }
        "retry" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { dictation::retry_all(&app).await });
        }
        "history" => crate::commands::open_settings_window(app, Some("history")),
        "settings" => crate::commands::open_settings_window(app, None),
        "check-updates" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { crate::updater::check(&app, true).await });
        }
        "restart-update" => crate::updater::restart_to_update(app),
        "sign-out" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                crate::auth::sign_out(&app).await;
                crate::load_app_path(&app, "/app");
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = if cfg!(target_os = "macos") {
        Image::from_bytes(include_bytes!("../icons/trayTemplate@2x.png"))?
    } else {
        Image::from_bytes(include_bytes!("../icons/tray-win.png"))?
    };
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("zerosoft")
        .menu(&menu(app)?)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, ev| on_menu(app, ev.id().as_ref()))
        .on_tray_icon_event(|tray, ev| {
            // Windows: clic en el ícono abre la ventana (el menú va con clic derecho).
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                if !cfg!(target_os = "macos") {
                    crate::show_main(tray.app_handle());
                }
            }
        })
        .build(app)?;
    Ok(())
}

pub fn rebuild(app: &AppHandle) {
    let app2 = app.clone();
    // El menú se arma en el hilo principal.
    let _ = app.run_on_main_thread(move || {
        if let (Some(tray), Ok(m)) = (app2.tray_by_id(TRAY_ID), menu(&app2)) {
            let _ = tray.set_menu(Some(m));
        }
    });
}

/// Menú de la app en Mac (y de la ventana en Windows): Ajustes, edición, ir atrás/adelante.
pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let l = app.state::<AppState>().locale;
    let settings = MenuItem::with_id(app, "settings", t(l, "settings"), true, Some("CmdOrCtrl+,"))?;
    let app_sub = SubmenuBuilder::new(app, "zerosoft")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?)
        .item(&MenuItem::with_id(app, "back", "Back", true, Some(if cfg!(target_os = "macos") { "Cmd+[" } else { "Alt+Left" }))?)
        .item(&MenuItem::with_id(app, "forward", "Forward", true, Some(if cfg!(target_os = "macos") { "Cmd+]" } else { "Alt+Right" }))?)
        .separator()
        .fullscreen()
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().close_window().build()?;
    MenuBuilder::new(app).items(&[&app_sub, &edit, &view, &window]).build()
}

pub fn on_app_menu(app: &AppHandle, id: &str) {
    let Some(win) = app.get_webview_window("main") else { return };
    match id {
        "settings" => crate::commands::open_settings_window(app, None),
        "reload" => {
            let _ = win.eval("location.reload()");
        }
        "back" => {
            let _ = win.eval("history.back()");
        }
        "forward" => {
            let _ = win.eval("history.forward()");
        }
        _ => {}
    }
}
