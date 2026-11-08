//! zerosoft para escritorio (Tauri 2): la plataforma en una ventana nativa con el webview del
//! sistema (WKWebView en Mac, WebView2 en Windows) y lo que el navegador no puede, hecho en Rust:
//! dictado en cualquier app (atajo global, micrófono, HUD, pegado), avisos nativos, contador en el
//! dock, deep links zerosoft://, bandeja y actualizaciones firmadas.
//!
//! Seguridad: la página remota solo ve `window.zerosoftDesktop` (script de inicio que se activa
//! con el origen del servidor) y solo puede llamar a los comandos del puente (capabilities); cada
//! comando revisa además la ventana y el origen. Navegación estricta (nav.rs): Google va por el
//! navegador del sistema con PKCE (auth.rs); otros sitios, al navegador.

mod api;
mod audio;
mod auth;
mod badge;
mod clipboard;
mod commands;
mod config;
mod deeplink;
mod dictation;
mod hud;
mod nav;
mod platform;
mod retry;
mod state;
mod strings;
mod tray;
mod updater;

use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::ipc::CapabilityBuilder;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

use state::{AppState, Dictation, Phase};

static START: OnceLock<Instant> = OnceLock::new();
static FIRST_LOAD: AtomicBool = AtomicBool::new(false);

fn elapsed_ms() -> u128 {
    START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0)
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Carga una página de la app (path ya validado) en la ventana principal.
pub fn load_app_path(app: &AppHandle, path: &str) {
    let Some(w) = app.get_webview_window("main") else { return };
    if let Ok(u) = url::Url::parse(&format!("{}{}", api::server(app), path)) {
        let _ = w.navigate(u);
    }
}

/// El servidor configurado puede usar el puente (zerosoft.ai y localhost ya están en
/// capabilities/remote.json; un servidor propio se suma acá).
pub fn allow_server(app: &AppHandle) {
    let server = api::server(app);
    if server == config::DEFAULT_SERVER || server.starts_with("http://localhost") {
        return;
    }
    let mut cap = CapabilityBuilder::new(format!("remote-{}", server.replace([':', '/', '.'], "-"))).remote(format!("{server}/*")).window("main");
    for p in ["allow-desktop-info", "allow-desktop-start-login", "allow-desktop-open-settings", "allow-desktop-notify"] {
        cap = cap.permission(p);
    }
    let _ = app.add_capability(cap);
}

fn bridge_script(server: &str, version: &str) -> String {
    let platform = if cfg!(target_os = "macos") { "darwin" } else { "win32" };
    let server = serde_json::to_string(server).unwrap_or_default();
    let version = serde_json::to_string(version).unwrap_or_default();
    format!(
        r#"(function () {{
  if (location.origin !== {server}) return;
  var inv = function (cmd, args) {{
    var i = window.__TAURI_INTERNALS__;
    return i ? i.invoke(cmd, args || {{}}) : Promise.reject(new Error('ipc'));
  }};
  var bridge = Object.freeze({{
    version: {version},
    platform: '{platform}',
    systemAudio: false,
    dictation: true,
    startLogin: function () {{ inv('desktop_start_login'); }},
    openSettings: function () {{ inv('desktop_open_settings'); }},
    notify: function (title, body) {{ return inv('desktop_notify', {{ title: String(title), body: body == null ? null : String(body) }}); }}
  }});
  Object.defineProperty(window, 'zerosoftDesktop', {{ value: bridge }});
  // window.Notification → aviso nativo (con la ventana sin foco; con foco la página ya lo muestra).
  function N(title, opts) {{ if (!document.hasFocus()) bridge.notify(title, opts && opts.body); }}
  N.permission = 'granted';
  N.requestPermission = function (cb) {{ if (cb) cb('granted'); return Promise.resolve('granted'); }};
  N.prototype.close = function () {{}};
  N.prototype.addEventListener = function () {{}};
  try {{ Object.defineProperty(window, 'Notification', {{ value: N, configurable: true, writable: true }}); }} catch (e) {{}}
}})();"#
    )
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let server = api::server(app);
    let start = url::Url::parse(&format!("{server}/app")).map_err(|e| tauri::Error::Anyhow(e.into()))?;
    let nav_app = app.clone();
    let new_win_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start))
        .title("zerosoft")
        .inner_size(1280.0, 820.0)
        .min_inner_size(400.0, 500.0)
        .initialization_script(bridge_script(&server, &app.package_info().version.to_string()))
        .on_navigation(move |u| route(&nav_app, u))
        .on_new_window(move |u, _| {
            // Links con target=_blank: adentro si son de la app, si no al navegador.
            if route(&new_win_app, &u) {
                let app = new_win_app.clone();
                let _ = app.clone().run_on_main_thread(move || {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.navigate(u);
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_page_load(|w, payload| {
            if payload.event() == PageLoadEvent::Finished && !FIRST_LOAD.swap(true, std::sync::atomic::Ordering::Relaxed) {
                eprintln!("zs-timing first_page_loaded_ms={}", elapsed_ms());
                let _ = w;
            }
        })
        .build()?;
    eprintln!("zs-timing main_window_created_ms={}", elapsed_ms());
    Ok(())
}

/// true = navegar adentro. El resto lo maneja acá (navegador del sistema o login).
fn route(app: &AppHandle, u: &url::Url) -> bool {
    match nav::classify(u, &api::server(app)) {
        nav::Nav::Allow => true,
        nav::Nav::GoogleLogin => {
            auth::begin_login(app);
            false
        }
        nav::Nav::External => {
            let _ = app.opener().open_url(u.as_str(), None::<&str>);
            false
        }
        nav::Nav::Block => false,
    }
}

fn handle_deep_link(app: &AppHandle, raw: &str) {
    match deeplink::parse(raw) {
        Some(deeplink::DeepLink::Auth { code, state }) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let ok = auth::complete_login(&app, &code, &state).await;
                show_main(&app);
                if ok {
                    load_app_path(&app, "/app");
                    commands::refresh_settings(&app);
                    badge::poll(&app).await;
                }
            });
        }
        Some(deeplink::DeepLink::Open { path }) => {
            load_app_path(app, &path);
            show_main(app);
        }
        None => {}
    }
}

pub fn run() {
    START.get_or_init(Instant::now);
    tauri::Builder::default()
        // Primero: una segunda instancia (y en Windows, el deep link) vuelve a la primera.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::new().with_denylist(&["hud", "settings"]).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            commands::desktop_info,
            commands::desktop_start_login,
            commands::desktop_open_settings,
            commands::desktop_notify,
            commands::settings_get,
            commands::settings_save,
            commands::permission_ask,
            commands::voice_get,
            commands::voice_save,
            commands::dictionary_list,
            commands::dictionary_add,
            commands::dictionary_delete,
            commands::history_list,
            commands::history_copy,
            commands::history_paste,
            commands::pending_retry,
            commands::pending_discard,
            commands::account_sign_in,
            commands::account_sign_out,
            commands::open_voice,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let platform = if cfg!(target_os = "macos") { "macos" } else { "windows" };
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            // ZEROSOFT_SERVER solo en desarrollo (la app publicada siempre usa lo guardado).
            let env_server = if cfg!(debug_assertions) { std::env::var("ZEROSOFT_SERVER").ok() } else { None };
            let settings = config::load(&config_dir, platform, env_server.as_deref());
            app.manage(AppState {
                settings: Mutex::new(settings),
                config_dir,
                pending: retry::PendingStore::new(data_dir.join("pending")),
                dictation: Mutex::new(Dictation { phase: Phase::Idle, capture: None, hands_free: false, pressed_at: None, source_app: String::new(), generation: 0 }),
                locale: strings::system_locale(),
                last_text: Mutex::new(String::new()),
                last_latency_ms: Mutex::new(None),
                http: api::client(),
                auth: Mutex::new(None),
                shortcut_taken: AtomicBool::new(false),
                badge_since: Mutex::new(None),
                update_ready: Mutex::new(None),
            });
            allow_server(&handle);
            app.set_menu(tray::app_menu(&handle)?)?;
            app.on_menu_event(|app, ev| tray::on_app_menu(app, ev.id().as_ref()));
            create_main_window(&handle)?;
            tray::create(&handle)?;
            // El HUD se crea escondido: la primera vez que aparece ya está cargado.
            hud::create(&handle)?;
            dictation::register_shortcuts(&handle, None);
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let dl = handle.clone();
            app.deep_link().on_open_url(move |ev| {
                for u in ev.urls() {
                    handle_deep_link(&dl, u.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for u in urls {
                    handle_deep_link(&handle, u.as_str());
                }
            }
            badge::start(&handle);
            updater::start(&handle);
            if !handle.state::<AppState>().settings.lock().unwrap().onboarded {
                commands::open_settings_window(&handle, Some("start"));
            }
            Ok(())
        })
        .on_window_event(|w, ev| match ev {
            // Cerrar la ventana principal la esconde: el dictado y los avisos siguen en la bandeja.
            WindowEvent::CloseRequested { api, .. } if w.label() == "main" => {
                api.prevent_close();
                let _ = w.hide();
            }
            WindowEvent::Focused(true) if w.label() == "main" => {
                let app = w.app_handle().clone();
                tauri::async_runtime::spawn(async move { badge::poll(&app).await });
            }
            WindowEvent::Focused(true) if w.label() == "settings" => commands::refresh_settings(w.app_handle()),
            WindowEvent::Destroyed if w.label() == "settings" => {
                let app = w.app_handle();
                let st = app.state::<AppState>();
                let mut s = st.settings.lock().unwrap();
                if !s.onboarded {
                    s.onboarded = true;
                    let _ = config::save(&st.config_dir, &s);
                }
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("zerosoft desktop")
        .run(|app, ev| {
            // Mac: clic en el ícono del dock con la ventana escondida.
            #[cfg(target_os = "macos")]
            if let RunEvent::Reopen { .. } = ev {
                show_main(app);
            }
            let _ = (app, &ev);
        });
}
