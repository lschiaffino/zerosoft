//! zerosoft para escritorio (Tauri 2): la plataforma en una ventana nativa con el webview del
//! sistema (WKWebView en Mac, WebView2 en Windows) y lo que el navegador no puede, hecho en Rust:
//! dictado en cualquier app (atajo global, micrófono, HUD, pegado), avisos nativos, contador en el
//! dock, deep links zerosoft://, bandeja y actualizaciones firmadas.
//!
//! Seguridad: la página remota solo ve `window.zerosoftDesktop` (script de inicio que se activa
//! con el origen del servidor) y solo puede llamar a los comandos del puente (capabilities); cada
//! comando revisa además la ventana y el origen. Navegación estricta (nav.rs): Google va por el
//! navegador del sistema con PKCE (auth.rs); conectar una cuenta (OAuth de una integración) abre
//! su ruta de inicio en el navegador; otros sitios, al navegador.

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
mod indicator;
mod nav;
mod platform;
mod rec_overlay;
mod retry;
mod session;
mod state;
mod system_audio;
mod strings;
mod tabs;
mod tray;
mod updater;

use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

use state::{AppState, Dictation, Phase};

static START: OnceLock<Instant> = OnceLock::new();
static FIRST_LOAD: AtomicBool = AtomicBool::new(false);

fn elapsed_ms() -> u128 {
    START.get().map(|s| s.elapsed().as_millis()).unwrap_or(0)
}

/// Trae adelante la última ventana de la app con foco.
pub fn show_main(app: &AppHandle) {
    tabs::show_last(app);
}

/// Carga una página de la app (path ya validado) en la pestaña de adelante.
pub fn load_app_path(app: &AppHandle, path: &str) {
    let (a, p) = (app.clone(), path.to_string());
    let _ = app.run_on_main_thread(move || tabs::navigate_active(&a, &p));
}

pub(crate) fn first_load_timing() {
    if !FIRST_LOAD.swap(true, std::sync::atomic::Ordering::Relaxed) {
        eprintln!("zs-timing first_page_loaded_ms={}", elapsed_ms());
    }
}

/// El servidor configurado puede usar el puente (zerosoft.ai y localhost ya están en
/// capabilities/remote.json; un servidor propio se suma acá).
pub fn allow_server(app: &AppHandle) {
    let server = api::server(app);
    if server == config::DEFAULT_SERVER || server.starts_with("http://localhost") {
        return;
    }
    let mut cap = CapabilityBuilder::new(format!("remote-{}", server.replace([':', '/', '.'], "-"))).remote(format!("{server}/*")).webview("tab-*");
    for p in [
        "allow-desktop-info",
        "allow-desktop-start-login",
        "allow-desktop-open-settings",
        "allow-desktop-notify",
        "allow-desktop-recording",
        "allow-desktop-tabs",
        "allow-desktop-system-audio-start",
        "allow-desktop-system-audio-read",
        "allow-desktop-system-audio-stop",
        "allow-desktop-rec-overlay",
        "allow-desktop-rec-level",
    ] {
        cap = cap.permission(p);
    }
    let _ = app.add_capability(cap);
}

pub(crate) fn bridge_script(server: &str, version: &str) -> String {
    let platform = if cfg!(target_os = "macos") { "darwin" } else { "win32" };
    let server = serde_json::to_string(server).unwrap_or_default();
    let version = serde_json::to_string(version).unwrap_or_default();
    let system_audio = cfg!(target_os = "macos");
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
    systemAudio: {system_audio},
    dictation: true,
    recordingIndicator: true,
    startLogin: function () {{ inv('desktop_start_login'); }},
    openSettings: function () {{ inv('desktop_open_settings'); }},
    // Una reunión empezó o terminó de grabarse: el indicador flotante (indicator.rs).
    recording: function (s) {{
      s = s || {{}};
      return inv('desktop_recording', {{ active: !!s.active, startedAt: typeof s.startedAt === 'number' ? s.startedAt : null, path: typeof s.path === 'string' ? s.path : null }});
    }},
    // Audio del sistema (ScreenCaptureKit en Mac): start devuelve ok | denied | unsupported | failed;
    // read devuelve PCM de 16 bits, 16 kHz, mono, en base64 (lo acumulado desde la lectura anterior).
    systemAudioStart: function () {{ return inv('desktop_system_audio_start'); }},
    systemAudioRead: function () {{ return inv('desktop_system_audio_read'); }},
    systemAudioStop: function () {{ return inv('desktop_system_audio_stop'); }},
    // Rec: barra flotante y burbuja de la cámara mientras se graba (rec_overlay.rs).
    recOverlay: function (s) {{
      s = s || {{}};
      return inv('desktop_rec_overlay', {{ active: !!s.active, phase: typeof s.phase === 'string' ? s.phase : null, elapsedMs: typeof s.elapsedMs === 'number' ? s.elapsedMs : null, mic: typeof s.mic === 'string' ? s.mic : null, camera: typeof s.camera === 'string' ? s.camera : null }});
    }},
    recLevel: function (l) {{ return inv('desktop_rec_level', {{ level: Number(l) || 0 }}); }},
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
  // Pestañas (tabs.rs): título y ruta para la tira; ⌘-clic, clic del medio y clic derecho en links.
  var tabs = function (a) {{ inv('desktop_tabs', a).catch(function () {{}}); }};
  var mac = '{platform}' === 'darwin';
  var last = '';
  var report = function () {{
    var p = location.pathname + location.search + location.hash;
    // Título de la pestaña: el de la página; si es el genérico del sitio, el h1 (el registro abierto).
    var t = document.title || '';
    if (/^zerosoft(\s*[·|]|$)/i.test(t.trim())) {{
      var h = document.querySelector('main h1') || document.querySelector('h1');
      t = h ? (h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    }}
    var k = p + '\n' + t;
    if (k === last) return;
    last = k;
    tabs({{ action: 'state', path: p, title: t }});
  }};
  var soon = function () {{ if (!soon.t) soon.t = setTimeout(function () {{ soon.t = 0; report(); }}, 150); }};
  ['pushState', 'replaceState'].forEach(function (m) {{
    var orig = history[m];
    history[m] = function () {{ var r = orig.apply(this, arguments); soon(); return r; }};
  }});
  addEventListener('popstate', soon);
  addEventListener('hashchange', soon);
  var watch = function () {{
    soon();
    try {{ new MutationObserver(soon).observe(document.documentElement, {{ childList: true, subtree: true, characterData: true }}); }} catch (e) {{}}
  }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
  var linkPath = function (t) {{
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (!a || a.hasAttribute('download')) return null;
    try {{
      var u = new URL(a.getAttribute('href'), location.href);
      return u.origin === location.origin ? u.pathname + u.search + u.hash : null;
    }} catch (e) {{ return null; }}
  }};
  document.addEventListener('click', function (e) {{
    if (e.button !== 0 || !(mac ? e.metaKey : e.ctrlKey)) return;
    var p = linkPath(e.target);
    if (!p) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // ⌘-clic: atrás (o ventana, según Ajustes); ⌘⇧: pestaña adelante; ⌘⌥: ventana nueva.
    tabs({{ action: e.altKey ? 'open-window' : e.shiftKey ? 'open-tab' : 'open', path: p }});
  }}, true);
  document.addEventListener('mousedown', function (e) {{ if (e.button === 1 && linkPath(e.target)) e.preventDefault(); }}, true);
  document.addEventListener('auxclick', function (e) {{
    if (e.button !== 1) return;
    var p = linkPath(e.target);
    if (!p) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    tabs({{ action: 'open', path: p }});
  }}, true);
  // Clic derecho en un link: el menú de la app, si la página no puso uno propio.
  addEventListener('contextmenu', function (e) {{
    if (e.defaultPrevented) return;
    var p = linkPath(e.target);
    if (!p) return;
    e.preventDefault();
    tabs({{ action: 'menu', path: p }});
  }});
  // ⌘1…⌘9 y ⌘⇧[ / ⌘⇧] (⌃Tab va por el menú).
  document.addEventListener('keydown', function (e) {{
    if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey) return;
    if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {{
      e.preventDefault();
      tabs({{ action: 'select', n: Number(e.code.slice(5)) }});
    }} else if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {{
      e.preventDefault();
      tabs({{ action: e.code === 'BracketLeft' ? 'prev' : 'next' }});
    }}
  }}, true);
}})();"#
    )
}

/// Una navegación propia que se dejó pasar: si lo que sigue es el redirect al consentimiento de
/// un proveedor, esta es la ruta de inicio (nav::connect_start).
pub(crate) fn remember_nav(app: &AppHandle, u: &url::Url) {
    if matches!(u.scheme(), "http" | "https") {
        *app.state::<AppState>().last_nav.lock().unwrap() = Some((u.clone(), Instant::now()));
    }
}

/// Conectar una cuenta (nav::Nav::Connect): Google y otros proveedores no dejan hacer OAuth en un
/// webview, y el callback valida el state contra una cookie que pone la ruta de inicio. Por eso se
/// abre en el navegador del sistema la ruta de inicio del servidor (no la URL del proveedor): todo
/// el recorrido pasa ahí. Sin ruta de inicio conocida (el state vive en el servidor, como en
/// Social) se abre la URL del proveedor, como cualquier link externo.
pub(crate) fn open_connect(app: &AppHandle, provider: &url::Url) {
    let last = app.state::<AppState>().last_nav.lock().unwrap().take();
    let start = nav::connect_start(last.as_ref().map(|(u, at)| (u, at.elapsed())), &api::server(app));
    let _ = app.opener().open_url(start.as_deref().unwrap_or(provider.as_str()), None::<&str>);
}

/// true = navegar adentro. El resto lo maneja acá (navegador del sistema o login).
pub(crate) fn route(app: &AppHandle, u: &url::Url) -> bool {
    match nav::classify(u, &api::server(app)) {
        nav::Nav::Allow => {
            remember_nav(app, u);
            true
        }
        nav::Nav::GoogleLogin => {
            auth::begin_login(app);
            false
        }
        nav::Nav::Connect => {
            open_connect(app, u);
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
                    tabs::reload_all(&app);
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
        .plugin(tauri_plugin_window_state::Builder::new().with_filter(|l| l == session::MAIN).build())
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
            commands::desktop_recording,
            commands::desktop_system_audio_start,
            commands::desktop_system_audio_read,
            commands::desktop_system_audio_stop,
            rec_overlay::desktop_rec_overlay,
            rec_overlay::desktop_rec_level,
            rec_overlay::rec_overlay_state,
            rec_overlay::rec_overlay_action,
            commands::indicator_state,
            commands::indicator_action,
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
            tabs::tabs_ready,
            tabs::tabs_action,
            tabs::desktop_tabs,
            tabs::tabs_prefs_get,
            tabs::tabs_prefs_save,
            commands::settings_nav,
            commands::settings_open_web,
            commands::update_check,
            commands::update_restart,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let platform = if cfg!(target_os = "macos") { "macos" } else { "windows" };
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            // ZEROSOFT_SERVER solo en desarrollo (la app publicada siempre usa lo guardado).
            let env_server = if cfg!(debug_assertions) { std::env::var("ZEROSOFT_SERVER").ok() } else { None };
            let settings = config::load(&config_dir, platform, env_server.as_deref());
            let tabs_dir = config_dir.clone();
            app.manage(AppState {
                settings: Mutex::new(settings),
                config_dir,
                pending: retry::PendingStore::new(data_dir.join("pending")),
                dictation: Mutex::new(Dictation { phase: Phase::Idle, capture: None, hands_free: false, pressed_at: None, source_app: String::new(), generation: 0 }),
                locale: strings::system_locale(),
                last_text: Mutex::new(String::new()),
                last_latency: Mutex::new(None),
                recording: Mutex::new(None),
                http: api::client(),
                auth: Mutex::new(None),
                last_nav: Mutex::new(None),
                shortcut_taken: AtomicBool::new(false),
                badge_since: Mutex::new(None),
                disabled_apps: Mutex::new(Vec::new()),
                update_ready: Mutex::new(None),
                update: Mutex::new(state::UpdateInfo::default()),
            });
            allow_server(&handle);
            app.set_menu(tray::app_menu(&handle)?)?;
            app.on_menu_event(|app, ev| tray::on_app_menu(app, ev.id().as_ref()));
            tabs::init(&handle, tabs_dir)?;
            eprintln!("zs-timing main_window_created_ms={}", elapsed_ms());
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
            // Cerrar la última ventana la esconde: el dictado y los avisos siguen en la bandeja.
            WindowEvent::CloseRequested { api, .. } if tabs::is_app_window(w.label()) => {
                if tabs::on_close_requested(w.app_handle(), w.label()) {
                    api.prevent_close();
                }
            }
            WindowEvent::Destroyed if tabs::is_app_window(w.label()) => tabs::on_destroyed(w.app_handle(), w.label()),
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } if tabs::is_app_window(w.label()) => {
                tabs::layout(w.app_handle(), w.label());
                tabs::remember_bounds(w.app_handle(), w.label());
            }
            WindowEvent::Moved(_) if tabs::is_app_window(w.label()) => tabs::remember_bounds(w.app_handle(), w.label()),
            WindowEvent::Focused(focused) if tabs::is_app_window(w.label()) => {
                tabs::on_focus(w.app_handle(), w.label(), *focused);
                indicator::update(w.app_handle());
                if *focused {
                    let app = w.app_handle().clone();
                    tauri::async_runtime::spawn(async move { badge::poll(&app).await });
                }
            }
            WindowEvent::Focused(true) if w.label() == "settings" => commands::refresh_settings(w.app_handle()),
            // El indicador se arrastró: se recuerda dónde (en coordenadas lógicas).
            WindowEvent::Moved(p) if w.label() == indicator::LABEL => {
                let scale = w.scale_factor().unwrap_or(1.0);
                indicator::moved(w.app_handle(), p.x as f64 / scale, p.y as f64 / scale);
            }
            // La barra o la burbuja de Rec se arrastraron: se recuerda dónde, mientras la app está abierta.
            WindowEvent::Moved(p) if w.label() == rec_overlay::BAR || w.label() == rec_overlay::BUBBLE => {
                let scale = w.scale_factor().unwrap_or(1.0);
                rec_overlay::moved(w.label(), p.x as f64 / scale, p.y as f64 / scale);
            }
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
