//! Comandos de la ventana de Ajustes (archivo local) y del puente de la página remota.
//! Cada comando revisa quién lo llama además de los permisos de capabilities/: Ajustes solo desde
//! la ventana "settings"; el puente solo desde una pestaña ("tab-<id>", tabs.rs) con el origen del servidor.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::api;
use crate::config::{self, SHORTCUTS};
use crate::dictation::{self, shortcut_label};
use crate::platform::{self, PermissionStatus};
use crate::retry::PendingMeta;
use crate::state::{now_ms, AppState};
use crate::strings;

pub(crate) type CmdResult<T> = Result<T, String>;

/// Solo la página local de la ventana de Ajustes (no una ruta del servidor cargada ahí).
pub(crate) fn from_settings(w: &WebviewWindow) -> CmdResult<()> {
    if w.label() == "settings" && w.url().map(|u| crate::nav::is_local(&u)).unwrap_or(false) {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

pub(crate) fn from_app(app: &AppHandle, w: &tauri::Webview) -> CmdResult<()> {
    let server = api::server(app);
    let ok = crate::tabs::tab_id(w.label()).is_some() && w.url().map(|u| crate::nav::classify(&u, &server) == crate::nav::Nav::Allow).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    signed_in: bool,
    email: String,
    name: String,
    offline: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    id: String,
    label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    locale: &'static str,
    platform: &'static str,
    version: String,
    server: String,
    mode: String,
    shortcut: String,
    shortcuts: Vec<Shortcut>,
    shortcut_taken: bool,
    paste_last_shortcut: String,
    restore_clipboard: bool,
    open_at_login: bool,
    onboarded: bool,
    recording_indicator: bool,
    send_app_name: bool,
    keep_failed_dictations: bool,
    allow_system_audio: bool,
    permissions: Value,
    /// Qué decir de Accesibilidad si falta (accessibility_hint).
    accessibility_hint: &'static str,
    /// "adhoc" | "stable" | "unknown" (Mac).
    signature: &'static str,
    account: Account,
    pending: Vec<PendingMeta>,
    last_latency: Option<dictation::Latency>,
    updates: &'static str,
    /// Lo último del feed de actualizaciones y la versión lista para instalar al reiniciar.
    update: crate::state::UpdateInfo,
    update_ready: Option<String>,
    strings: serde_json::Map<String, Value>,
}

async fn account(app: &AppHandle) -> Account {
    // La misma ruta que el contador del dock (getCurrentUser): 401 = sin sesión.
    let res = api::get(app, "/api/desktop/badge").await;
    match res.status {
        None => Account { signed_in: false, email: String::new(), name: String::new(), offline: true },
        Some(200) => {
            let email = res.body.as_ref().and_then(|b| b.pointer("/user/email")).and_then(Value::as_str).unwrap_or("").to_string();
            let name = res.body.as_ref().and_then(|b| b.pointer("/user/name")).and_then(Value::as_str).unwrap_or("").to_string();
            Account { signed_in: !email.is_empty(), email, name, offline: false }
        }
        Some(_) => Account { signed_in: false, email: String::new(), name: String::new(), offline: false },
    }
}

async fn view(app: &AppHandle) -> SettingsView {
    let account = account(app).await;
    let st = app.state::<AppState>();
    let s = st.settings.lock().unwrap().clone();
    let mut list: Vec<String> = SHORTCUTS.iter().map(|x| x.to_string()).collect();
    if !list.contains(&s.shortcut) {
        list.push(s.shortcut.clone());
    }
    let mac = cfg!(target_os = "macos");
    let last_latency = *st.last_latency.lock().unwrap();
    let version = app.package_info().version.to_string();
    let accessibility = platform::accessibility_status();
    let granted = accessibility != PermissionStatus::Denied;
    // Se anota con qué versión se vio permitida: si después de actualizar ya no, es la build vieja.
    if granted && mac && s.accessibility_seen_in != version {
        let mut cur = st.settings.lock().unwrap();
        cur.accessibility_seen_in = version.clone();
        let _ = config::save(&st.config_dir, &cur);
    }
    let signature = platform::signature_kind();
    let update = st.update.lock().unwrap().clone();
    let update_ready = st.update_ready.lock().unwrap().clone();
    SettingsView {
        locale: st.locale,
        platform: if mac { "darwin" } else { "win32" },
        version: version.clone(),
        server: s.server.clone(),
        mode: s.mode.clone(),
        shortcut: s.shortcut.clone(),
        shortcuts: list.into_iter().map(|id| Shortcut { label: shortcut_label(&id), id }).collect(),
        shortcut_taken: st.shortcut_taken.load(Ordering::Relaxed),
        paste_last_shortcut: shortcut_label(config::paste_last_shortcut(if mac { "macos" } else { "windows" })),
        restore_clipboard: s.restore_clipboard,
        open_at_login: app.autolaunch().is_enabled().unwrap_or(false),
        onboarded: s.onboarded,
        recording_indicator: s.recording_indicator,
        send_app_name: s.send_app_name,
        keep_failed_dictations: s.keep_failed_dictations,
        allow_system_audio: s.allow_system_audio,
        permissions: json!({
            "microphone": platform::microphone_status(),
            "accessibility": accessibility,
            "camera": platform::camera_status(),
            "screen": platform::screen_status(),
        }),
        accessibility_hint: accessibility_hint(granted, &s.accessibility_seen_in, &version, signature),
        signature,
        account,
        pending: st.pending.list(now_ms()),
        last_latency,
        updates: if cfg!(debug_assertions) { "dev" } else if crate::updater::enabled(app) { "auto" } else { "off" },
        update,
        update_ready,
        strings: strings::table(st.locale),
    }
}

/// Qué mostrar en el paso de Accesibilidad cuando falta:
/// - "updated": se vio permitida con otra versión. Con firma ad hoc macOS guarda el permiso para
///   la build vieja (la llave sigue prendida) y hay que borrarlo y darlo de nuevo.
/// - "adhoc": nunca se vio permitida y la firma es ad hoc: si la llave ya está prendida, es de
///   otra build (la misma receta).
/// - "off": falta prenderla.
pub fn accessibility_hint(granted: bool, seen_in: &str, version: &str, signature: &str) -> &'static str {
    if granted {
        "ok"
    } else if !seen_in.is_empty() && seen_in != version {
        "updated"
    } else if signature == "adhoc" {
        "adhoc"
    } else {
        "off"
    }
}

pub fn refresh_settings(app: &AppHandle) {
    let _ = app.emit_to("settings", "settings://refresh", ());
}

/// Hay algo nuevo en el registro de actividad (Ajustes › Privacidad y datos lo relee si está abierta).
pub fn refresh_privacy(app: &AppHandle) {
    let _ = app.emit_to("settings", "privacy://refresh", ());
}

/// Origen de las páginas locales de la app (Mac: tauri://localhost; Windows: http://tauri.localhost).
fn local_origin() -> &'static str {
    if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    }
}

/// User agent de la ventana de Ajustes: termina en zerosoft-settings/<versión>, que el servidor
/// reconoce (lib/settings-embed.ts) para armar sus secciones sin el chrome de la app.
pub fn settings_user_agent(version: &str) -> String {
    let base = if cfg!(target_os = "macos") {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    } else {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
    };
    format!("{base} zerosoft-settings/{version}")
}

/// En una sección web de la ventana de Ajustes, Esc (si la página no lo usó para cerrar algo)
/// cierra la ventana como en las secciones nativas: pide la ruta "close", que la app intercepta.
fn settings_remote_script(server: &str) -> String {
    let server = serde_json::to_string(server).unwrap_or_default();
    format!(
        r#"(function () {{
  if (location.origin !== {server}) return;
  document.addEventListener('keydown', function (e) {{
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
    location.assign('/app/settings/desktop/close');
  }});
}})();"#
    )
}

/// Navegación de la ventana de Ajustes (nav.rs, classify_settings): true = cargar adentro.
fn settings_route(app: &AppHandle, u: &url::Url) -> bool {
    use crate::nav::SettingsNav;
    match crate::nav::classify_settings(u, &api::server(app)) {
        SettingsNav::Local => true,
        SettingsNav::Web => {
            crate::remember_nav(app, u);
            true
        }
        SettingsNav::Native(tab) => {
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || {
                let Some(w) = app2.get_webview_window("settings") else { return };
                if tab == "close" {
                    let _ = w.close();
                } else if let Ok(local) = url::Url::parse(&format!("{}/settings.html#{tab}", local_origin())) {
                    let _ = w.navigate(local);
                }
            });
            false
        }
        SettingsNav::Main(path) => {
            crate::load_app_path(app, &path);
            crate::show_main(app);
            false
        }
        SettingsNav::GoogleLogin => {
            crate::auth::begin_login(app);
            false
        }
        SettingsNav::Connect => {
            crate::open_connect(app, u);
            false
        }
        SettingsNav::External => {
            let _ = app.opener().open_url(u.as_str(), None::<&str>);
            false
        }
        SettingsNav::Block => false,
    }
}

pub fn open_settings_window(app: &AppHandle, tab: Option<&str>) {
    if let Some(w) = app.get_webview_window("settings") {
        if let Some(t) = tab {
            // Si está mostrando una sección web, vuelve a la página local en esa sección.
            if w.url().map(|u| crate::nav::is_local(&u)).unwrap_or(false) {
                let _ = app.emit_to("settings", "settings://tab", t);
            } else if let Ok(local) = url::Url::parse(&format!("{}/settings.html#{t}", local_origin())) {
                let _ = w.navigate(local);
            }
        }
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let path = match tab {
        Some(t) => format!("settings.html#{t}"),
        None => "settings.html".into(),
    };
    let title = strings::t(app.state::<AppState>().locale, "settingsTitle");
    let version = app.package_info().version.to_string();
    let nav_app = app.clone();
    let win_app = app.clone();
    let _ = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(path.into()))
        .title(title)
        .inner_size(860.0, 640.0)
        .min_inner_size(380.0, 480.0)
        .center()
        .user_agent(&settings_user_agent(&version))
        .initialization_script(settings_remote_script(&api::server(app)))
        .on_navigation(move |u| settings_route(&nav_app, u))
        // Las secciones web de Ajustes no usan cámara, micrófono ni nada parecido: todo se niega
        // (sin esto, el webview lo daría solo).
        .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny)
        .on_new_window(move |u, _| {
            // target=_blank desde una sección web: afuera, o a la ventana principal.
            if settings_route(&win_app, &u) {
                crate::load_app_path(&win_app, u.path());
                crate::show_main(&win_app);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build();
}

// ---------- Ajustes ----------

#[tauri::command]
pub async fn settings_get(app: AppHandle, window: WebviewWindow) -> CmdResult<SettingsView> {
    from_settings(&window)?;
    Ok(view(&app).await)
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, window: WebviewWindow, input: Value) -> CmdResult<Value> {
    from_settings(&window)?;
    let st = app.state::<AppState>();
    let prev = st.settings.lock().unwrap().clone();
    let mut next = config::merge_input(&prev, &input);
    if let Some(raw) = input.get("server").and_then(Value::as_str) {
        match config::normalize_server(raw) {
            Some(s) => next.server = s,
            None => return Ok(json!({ "ok": false, "error": "server" })),
        }
    }
    if let Some(b) = input.get("openAtLogin").and_then(Value::as_bool) {
        let al = app.autolaunch();
        let _ = if b { al.enable() } else { al.disable() };
    }
    *st.settings.lock().unwrap() = next.clone();
    if config::save(&st.config_dir, &next).is_err() {
        return Ok(json!({ "ok": false }));
    }
    if next.shortcut != prev.shortcut {
        dictation::register_shortcuts(&app, Some(&prev.shortcut));
    }
    // Apagar "dejar capturar el audio de la computadora" corta la captura en curso.
    if prev.allow_system_audio && !next.allow_system_audio && crate::system_audio::running() {
        crate::system_audio::stop_because(crate::system_audio::Why::User);
    }
    if next.recording_indicator != prev.recording_indicator {
        crate::indicator::update(&app);
    }
    if next.server != prev.server {
        crate::allow_server(&app);
        crate::load_app_path(&app, "/app");
        crate::tabs::reload_all(&app);
    }
    crate::tray::rebuild(&app);
    Ok(json!({ "ok": true, "view": view(&app).await }))
}

#[tauri::command]
pub async fn permission_ask(app: AppHandle, window: WebviewWindow, kind: String) -> CmdResult<SettingsView> {
    from_settings(&window)?;
    match kind.as_str() {
        "microphone" => {
            if platform::microphone_status() == PermissionStatus::NotDetermined {
                // Abrir el micrófono un momento dispara el aviso del sistema.
                let opened = tauri::async_runtime::spawn_blocking(|| crate::audio::start().map(|c| c.finish()).is_ok()).await.unwrap_or(false);
                if opened {
                    use crate::privacy::{Event, Kind, Tag};
                    crate::privacy::record(&app, Event::new(Kind::MicStart).trigger(Tag::Settings));
                    crate::privacy::record(&app, Event::new(Kind::MicStop).duration(0));
                }
            } else {
                let _ = app.opener().open_url(platform::PANE_MIC, None::<&str>);
            }
        }
        "accessibility" => {
            if !platform::prompt_accessibility() {
                let _ = app.opener().open_url(platform::PANE_ACCESSIBILITY, None::<&str>);
            }
        }
        // La llave está prendida pero macOS no la reconoce (es de otra build): se borra la entrada
        // vieja, se pide de nuevo (macOS suma esta build, apagada) y se abre la lista para prenderla.
        "accessibility-reset" => {
            platform::reset_accessibility(&app.config().identifier);
            if !platform::prompt_accessibility() {
                let _ = app.opener().open_url(platform::PANE_ACCESSIBILITY, None::<&str>);
            }
        }
        "camera" => {
            if platform::camera_status() != PermissionStatus::Granted {
                let _ = app.opener().open_url(platform::PANE_CAMERA, None::<&str>);
            }
        }
        "screen" => {
            if !platform::request_screen() {
                let _ = app.opener().open_url(platform::PANE_SCREEN, None::<&str>);
            }
        }
        // Restablecer micrófono, cámara o pantalla: se borra la entrada de macOS y se abre su
        // lista; la app lo vuelve a pedir la próxima vez que lo use.
        k if k.starts_with("reset-") => {
            let kind = &k["reset-".len()..];
            let Some(service) = platform::tcc_service(kind) else { return Err("kind".into()) };
            platform::reset_permission(service, &app.config().identifier);
            let pane = match kind {
                "microphone" => platform::PANE_MIC,
                "camera" => platform::PANE_CAMERA,
                "screen" => platform::PANE_SCREEN,
                _ => platform::PANE_ACCESSIBILITY,
            };
            if kind != "accessibility" || !platform::prompt_accessibility() {
                let _ = app.opener().open_url(pane, None::<&str>);
            }
        }
        _ => return Err("kind".into()),
    }
    Ok(view(&app).await)
}

fn remote(res: &api::ApiResponse) -> Option<Value> {
    if res.status.is_some_and(|s| (200..300).contains(&s)) {
        res.body.clone()
    } else {
        None
    }
}

fn remote_err(res: &api::ApiResponse) -> Value {
    json!({ "ok": false, "error": api::remote_error(res.status) })
}

fn pick_voice(b: &Value) -> Option<Value> {
    let s = b.get("settings")?;
    s.get("styles")?;
    Some(json!({ "ok": true, "settings": {
        "language": s.get("language").cloned().unwrap_or(json!("auto")),
        "cleanupMode": s.get("cleanupMode").cloned().unwrap_or(json!("per_app")),
        "cleanupDepth": s.get("cleanupDepth").cloned().unwrap_or(json!("standard")),
        "aiCleanup": s.get("aiCleanup").cloned().unwrap_or(json!(true)),
        "styles": s.get("styles").cloned().unwrap_or(json!({})),
    }}))
}

#[tauri::command]
pub async fn voice_get(app: AppHandle, window: WebviewWindow) -> CmdResult<Value> {
    from_settings(&window)?;
    let res = api::get(&app, "/api/voice/settings").await;
    Ok(remote(&res).and_then(|b| pick_voice(&b)).unwrap_or_else(|| remote_err(&res)))
}

#[tauri::command]
pub async fn voice_save(app: AppHandle, window: WebviewWindow, patch: Value) -> CmdResult<Value> {
    from_settings(&window)?;
    // El servidor valida cada campo: acá solo se filtra la forma.
    let mut body = serde_json::Map::new();
    for k in ["language", "cleanupMode", "cleanupDepth", "aiCleanup", "styles"] {
        if let Some(v) = patch.get(k) {
            body.insert(k.into(), v.clone());
        }
    }
    let res = api::send_json(&app, reqwest::Method::PATCH, "/api/voice/settings", &Value::Object(body)).await;
    Ok(remote(&res).and_then(|b| pick_voice(&b)).unwrap_or_else(|| remote_err(&res)))
}

#[tauri::command]
pub async fn dictionary_list(app: AppHandle, window: WebviewWindow) -> CmdResult<Value> {
    from_settings(&window)?;
    let res = api::get(&app, "/api/voice/dictionary").await;
    Ok(match remote(&res).and_then(|b| b.get("entries").cloned()) {
        Some(Value::Array(entries)) => json!({ "ok": true, "entries": entries }),
        _ => remote_err(&res),
    })
}

#[tauri::command]
pub async fn dictionary_add(app: AppHandle, window: WebviewWindow, input: Value) -> CmdResult<Value> {
    from_settings(&window)?;
    let kind = if input.get("kind").and_then(Value::as_str) == Some("replace") { "replace" } else { "word" };
    let phrase: String = input.get("phrase").and_then(Value::as_str).unwrap_or("").trim().chars().take(100).collect();
    let mut body = json!({ "kind": kind, "phrase": phrase });
    if kind == "replace" {
        body["replacement"] = json!(input.get("replacement").and_then(Value::as_str).unwrap_or("").chars().take(2000).collect::<String>());
    }
    let res = api::send_json(&app, reqwest::Method::POST, "/api/voice/dictionary", &body).await;
    Ok(match remote(&res).and_then(|b| b.get("id").and_then(Value::as_str).map(String::from)) {
        Some(id) => json!({ "ok": true, "id": id }),
        None => remote_err(&res),
    })
}

#[tauri::command]
pub async fn dictionary_delete(app: AppHandle, window: WebviewWindow, id: String) -> CmdResult<Value> {
    from_settings(&window)?;
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("id".into());
    }
    let res = api::delete(&app, &format!("/api/voice/dictionary/{id}")).await;
    Ok(if remote(&res).is_some() { json!({ "ok": true, "deleted": true }) } else { remote_err(&res) })
}

#[tauri::command]
pub async fn history_list(app: AppHandle, window: WebviewWindow) -> CmdResult<Value> {
    from_settings(&window)?;
    let res = api::get(&app, "/api/voice/sessions?kind=dictation&limit=50").await;
    Ok(match remote(&res).and_then(|b| b.get("sessions").cloned()) {
        Some(Value::Array(items)) => json!({ "ok": true, "items": items }),
        _ => remote_err(&res),
    })
}

#[tauri::command]
pub fn history_copy(app: AppHandle, window: WebviewWindow, text: String) -> CmdResult<bool> {
    from_settings(&window)?;
    let text: String = text.chars().take(20_000).collect();
    let ok = arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).is_ok();
    if ok {
        use crate::privacy::{Event, Kind, Tag};
        crate::privacy::record(&app, Event::new(Kind::Paste).trigger(Tag::History).result(Tag::Copied));
    }
    Ok(ok)
}

#[tauri::command]
pub async fn history_paste(app: AppHandle, window: WebviewWindow, text: String) -> CmdResult<&'static str> {
    from_settings(&window)?;
    // Se esconde zerosoft para que el foco vuelva a la app anterior y ahí se pega.
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = app.hide();
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    let text: String = text.chars().take(20_000).collect();
    Ok(match dictation::insert_text(&app, &text, crate::privacy::Tag::History).await {
        crate::clipboard::How::Pasted => "pasted",
        crate::clipboard::How::Copied => "copied",
    })
}

#[tauri::command]
pub async fn pending_retry(app: AppHandle, window: WebviewWindow, id: String) -> CmdResult<Value> {
    from_settings(&window)?;
    let r = dictation::retry_pending(&app, &id).await;
    let v = view(&app).await;
    Ok(match r {
        Ok(text) => json!({ "ok": true, "text": text, "view": v }),
        Err(f) => json!({ "ok": false, "failure": f, "view": v }),
    })
}

#[tauri::command]
pub async fn pending_discard(app: AppHandle, window: WebviewWindow, id: String) -> CmdResult<SettingsView> {
    from_settings(&window)?;
    app.state::<AppState>().pending.remove(&id);
    crate::tray::rebuild(&app);
    Ok(view(&app).await)
}

#[tauri::command]
pub fn account_sign_in(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    from_settings(&window)?;
    crate::auth::begin_login(&app);
    Ok(())
}

#[tauri::command]
pub async fn account_sign_out(app: AppHandle, window: WebviewWindow) -> CmdResult<SettingsView> {
    from_settings(&window)?;
    crate::auth::sign_out(&app, crate::privacy::Tag::Settings).await;
    crate::load_app_path(&app, "/app");
    crate::tabs::reload_all(&app);
    Ok(view(&app).await)
}

#[tauri::command]
pub fn open_voice(app: AppHandle, window: WebviewWindow, which: String) -> CmdResult<()> {
    from_settings(&window)?;
    match which.as_str() {
        "download" => {
            let _ = app.opener().open_url(format!("{}/download", api::server(&app)), None::<&str>);
        }
        "settings" => crate::load_app_path(&app, "/app/voice/settings"),
        _ => crate::load_app_path(&app, "/app/voice/dictation"),
    }
    crate::show_main(&app);
    Ok(())
}

/// La nav de Ajustes de la persona (grupos, secciones y productos que tiene), del servidor.
#[tauri::command]
pub async fn settings_nav(app: AppHandle, window: WebviewWindow) -> CmdResult<Value> {
    from_settings(&window)?;
    let locale = app.state::<AppState>().locale;
    let res = api::get(&app, &format!("/api/settings/nav?locale={locale}&desktop=1")).await;
    Ok(match remote(&res).and_then(|b| b.get("groups").cloned()) {
        Some(Value::Array(groups)) => json!({ "ok": true, "groups": groups }),
        _ => remote_err(&res),
    })
}

/// Abre una sección web (ruta de ajustes del servidor) en la ventana de Ajustes.
#[tauri::command]
pub fn settings_open_web(app: AppHandle, window: WebviewWindow, path: String) -> CmdResult<()> {
    from_settings(&window)?;
    if !crate::nav::valid_settings_path(&path) {
        return Err("path".into());
    }
    let u = url::Url::parse(&format!("{}{}", api::server(&app), path)).map_err(|_| "path".to_string())?;
    window.navigate(u).map_err(|_| "navigate".to_string())
}

/// "Buscar actualizaciones" desde Ajustes: el estado llega con settings://refresh.
#[tauri::command]
pub async fn update_check(app: AppHandle, window: WebviewWindow) -> CmdResult<SettingsView> {
    from_settings(&window)?;
    let a = app.clone();
    tauri::async_runtime::spawn(async move { crate::updater::check(&a, false).await });
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    Ok(view(&app).await)
}

#[tauri::command]
pub fn update_restart(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    from_settings(&window)?;
    crate::updater::restart_to_update(&app);
    Ok(())
}

// ---------- Puente de la página (window.zerosoftDesktop) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    version: String,
    platform: &'static str,
    system_audio: bool,
    dictation: bool,
}

#[tauri::command]
pub fn desktop_info(app: AppHandle, window: tauri::Webview) -> CmdResult<DesktopInfo> {
    from_app(&app, &window)?;
    Ok(DesktopInfo {
        version: app.package_info().version.to_string(),
        platform: if cfg!(target_os = "macos") { "darwin" } else { "win32" },
        system_audio: cfg!(target_os = "macos"),
        dictation: !app.state::<AppState>().shortcut_taken.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn desktop_start_login(app: AppHandle, window: tauri::Webview) -> CmdResult<()> {
    from_app(&app, &window)?;
    crate::auth::begin_login(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_open_settings(app: AppHandle, window: tauri::Webview) -> CmdResult<()> {
    from_app(&app, &window)?;
    open_settings_window(&app, None);
    Ok(())
}

/// La página empezó o terminó de grabar una reunión (para el indicador flotante).
#[tauri::command]
pub fn desktop_recording(app: AppHandle, window: tauri::Webview, active: bool, started_at: Option<f64>, path: Option<String>) -> CmdResult<()> {
    from_app(&app, &window)?;
    let rec = if active {
        let path = path.unwrap_or_default();
        let now = now_ms();
        // Un inicio razonable (no en el futuro ni de hace más de un día); si no, ahora.
        let started = started_at.map(|v| v as u64).filter(|v| *v <= now && now - *v < 86_400_000).unwrap_or(now);
        Some(crate::state::Recording { started_at: started, path: if crate::indicator::valid_path(&path) { path } else { String::new() } })
    } else {
        None
    };
    let tab = crate::tabs::tab_id(window.label());
    crate::tabs::set_recording(&app, tab, rec.is_some());
    // Registro de actividad: cuándo la página avisó que empezó y terminó de grabar.
    {
        use crate::privacy::{Event, Kind, Tag};
        let st = app.state::<AppState>();
        let mut since = st.meeting_since.lock().unwrap();
        match (rec.is_some(), *since) {
            (true, None) => {
                *since = Some(now_ms());
                drop(since);
                crate::privacy::record(&app, Event::new(Kind::MeetingStart).trigger(Tag::Page));
            }
            (false, Some(t)) => {
                *since = None;
                drop(since);
                crate::privacy::record(&app, Event::new(Kind::MeetingStop).trigger(Tag::Page).duration(now_ms().saturating_sub(t)));
            }
            _ => {}
        }
    }
    crate::indicator::set_recording(&app, rec);
    Ok(())
}

// ---------- Indicador de grabación ----------

fn from_indicator(w: &WebviewWindow) -> CmdResult<()> {
    if w.label() == crate::indicator::LABEL {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorView {
    recording: Option<crate::state::Recording>,
    strings: serde_json::Map<String, Value>,
}

#[tauri::command]
pub fn indicator_state(app: AppHandle, window: WebviewWindow) -> CmdResult<IndicatorView> {
    from_indicator(&window)?;
    let st = app.state::<AppState>();
    Ok(IndicatorView { recording: crate::indicator::current(&app), strings: strings::table(st.locale) })
}

#[tauri::command]
pub fn indicator_action(app: AppHandle, window: WebviewWindow, action: String) -> CmdResult<()> {
    from_indicator(&window)?;
    match action.as_str() {
        "open" => crate::indicator::open(&app),
        "stop" => crate::indicator::stop(&app),
        "hide" => crate::indicator::dismiss(&app),
        "menu" => crate::indicator::menu(&app),
        "expand" => crate::indicator::expand(&app, true),
        "collapse" => crate::indicator::expand(&app, false),
        _ => return Err("action".into()),
    }
    Ok(())
}

/// Aviso nativo pedido por la página (shim de window.Notification). Solo con la ventana sin foco.
#[tauri::command]
pub fn desktop_notify(app: AppHandle, window: tauri::Webview, title: String, body: Option<String>) -> CmdResult<bool> {
    from_app(&app, &window)?;
    let title: String = title.chars().take(200).collect();
    let body: String = body.unwrap_or_default().chars().take(500).collect();
    Ok(app.notification().builder().title(title).body(body).show().is_ok())
}


/// Pestaña (etiqueta "tab-<id>") que empezó la captura del audio de la computadora en curso. Solo
/// ella la lee, la corta o la reinicia. Se borra cuando la captura termina (lib.rs).
static SYSTEM_AUDIO_OWNER: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn clear_system_audio_owner() {
    *SYSTEM_AUDIO_OWNER.lock().unwrap() = None;
}

fn is_system_audio_owner(label: &str) -> bool {
    SYSTEM_AUDIO_OWNER.lock().unwrap().as_deref() == Some(label)
}

/// La captura del audio de la computadora empieza solo desde la pestaña que la persona está usando
/// (adelante, en la ventana con el foco). Una captura en curso la reinicia solo la pestaña que la
/// empezó.
pub fn system_audio_start_allowed(tab_in_use: bool, already_running: bool, is_owner: bool) -> bool {
    if already_running {
        is_owner
    } else {
        tab_in_use
    }
}

// ---------- Privacidad y datos (privacy.rs) ----------

fn privacy_view(app: &AppHandle) -> Value {
    let st = app.state::<AppState>();
    let data = st.privacy.snapshot();
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let stores = crate::privacy::Paths::of(app).map(|p| crate::privacy::stores(&p, autostart, platform::electron_keychain_exists())).unwrap_or_default();
    let mut events = data.events;
    events.reverse();
    json!({
        "stores": stores,
        "usage": data.usage,
        "events": events,
        "facts": crate::privacy::facts(),
        "capturing": crate::tray::capture_key(app),
        // Si este arranque terminó un "borrar todo" (true = todo borrado).
        "lastWipe": crate::privacy::LAST_WIPE.get(),
    })
}

/// Lleva todas las pestañas a about:blank: la página deja de correr y no vuelve a escribir sus
/// datos mientras se borran. Espera a que el hilo principal lo haga.
async fn blank_tabs(app: &AppHandle) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        for (label, wv) in a.webviews() {
            if crate::tabs::tab_id(&label).is_some() {
                if let Ok(u) = url::Url::parse("about:blank") {
                    let _ = wv.navigate(u);
                }
            }
        }
        let _ = tx.send(());
    });
    let _ = rx.await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
}

fn reload_tabs(app: &AppHandle) {
    crate::load_app_path(app, "/app");
    crate::tabs::reload_all(app);
}

/// Lo que puede pedir Ajustes › Privacidad y datos. Solo la página local de Ajustes.
/// - get: inventario, últimos usos, registro y los hechos.
/// - delete (target: pending | activity | web_data | update_temp | electron_data |
///   electron_keychain | all).
/// - reveal (target: id de un dato guardado): lo muestra en Finder o el Explorador.
/// - export: el registro de actividad a un archivo en Descargas (solo tu usuario lo lee).
/// - open (target: docs | source:<archivo>): la página pública o un archivo del repositorio, en el
///   navegador (el tag de esta versión). Solo los archivos que nombran los hechos.
#[tauri::command]
pub async fn privacy(app: AppHandle, window: WebviewWindow, action: String, target: Option<String>) -> CmdResult<Value> {
    use crate::privacy::{Event, Kind, Paths, Tag};
    from_settings(&window)?;
    let target = target.unwrap_or_default();
    let paths = Paths::of(&app).ok_or("paths")?;
    let deleted = |what: Tag| crate::privacy::record(&app, Event::new(Kind::DataDeleted).trigger(Tag::Settings).result(what));
    match action.as_str() {
        "get" => {}
        "delete" => match target.as_str() {
            "pending" => {
                if !crate::privacy::delete_pending(&paths) {
                    return Err("delete".into());
                }
                deleted(Tag::Pending);
                crate::tray::rebuild(&app);
                refresh_settings(&app);
            }
            "activity" => app.state::<AppState>().privacy.clear(),
            "update_temp" | "electron_data" => {
                if !crate::privacy::delete_store(&paths, &target) {
                    return Err("delete".into());
                }
                deleted(Tag::Old);
            }
            "electron_keychain" => {
                if !platform::delete_electron_keychain() {
                    return Err("delete".into());
                }
                deleted(Tag::Old);
            }
            // Cookies (la sesión), almacenamiento y caché del webview, como "borrar datos del sitio".
            // Primero se cierra la sesión también en el servidor; las páginas se van a about:blank
            // para que no vuelvan a escribir. El webview no avisa cuándo terminó de borrar: la
            // respuesta dice "pedido" (requested) y la página vuelve a medir.
            "web_data" => {
                crate::auth::server_sign_out(&app).await;
                blank_tabs(&app).await;
                let wv = crate::tabs::any_webview(&app).ok_or("webview")?;
                let asked = wv.clear_all_browsing_data().is_ok();
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                reload_tabs(&app);
                refresh_settings(&app);
                if !asked {
                    return Err("delete".into());
                }
                deleted(Tag::WebData);
                return Ok(json!({ "ok": true, "requested": true, "view": privacy_view(&app) }));
            }
            // Todo lo que la app guardó acá, y reinicia como recién instalada. Los datos del webview
            // se terminan de borrar al arrancar, antes de crear ninguna ventana (privacy::finish_wipe).
            "all" => {
                crate::auth::server_sign_out(&app).await;
                let _ = app.autolaunch().disable();
                crate::system_audio::stop_because(crate::system_audio::Why::User);
                blank_tabs(&app).await;
                app.state::<AppState>().privacy.clear();
                if !crate::privacy::wipe_files(&paths, platform::delete_electron_keychain) {
                    reload_tabs(&app);
                    return Ok(json!({ "ok": false, "view": privacy_view(&app) }));
                }
                // Además, lo que el webview pueda borrar ya (al arrancar se borran sus carpetas).
                if let Some(wv) = crate::tabs::any_webview(&app) {
                    let _ = wv.clear_all_browsing_data();
                }
                let a = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    a.restart();
                });
                return Ok(json!({ "ok": true, "restart": true }));
            }
            _ => return Err("target".into()),
        },
        "open" => {
            let url = if target == "docs" {
                format!("{}{}", api::server(&app), crate::privacy::DOCS_PATH)
            } else {
                let file = target.strip_prefix("source:").filter(|f| crate::privacy::is_source(f)).ok_or("target")?;
                format!("{}{file}", crate::privacy::repo_for(&app.package_info().version.to_string()))
            };
            let _ = app.opener().open_url(url, None::<&str>);
            return Ok(json!({ "ok": true }));
        }
        "reveal" => {
            if !crate::privacy::STORE_IDS.contains(&target.as_str()) {
                return Err("target".into());
            }
            let p = paths.shown_path(&target).ok_or("target")?;
            // Si todavía no existe, la carpeta que lo va a contener (la primera que exista).
            let shown = p.ancestors().find(|a| a.exists()).ok_or("target")?.to_path_buf();
            let _ = app.opener().reveal_item_in_dir(shown);
        }
        "export" => {
            let dir = app.path().download_dir().map_err(|_| "export".to_string())?;
            let data = app.state::<AppState>().privacy.snapshot();
            let file = dir.join(format!("zerosoft-activity-{}.json", now_ms()));
            let body = json!({ "app": "zerosoft desktop", "version": app.package_info().version.to_string(), "exportedAt": now_ms(), "usage": data.usage, "events": data.events });
            if !crate::privacy::write_private(&file, &serde_json::to_vec_pretty(&body).unwrap_or_default()) {
                return Err("export".into());
            }
            let _ = app.opener().reveal_item_in_dir(&file);
            return Ok(json!({ "ok": true, "file": file.to_string_lossy(), "view": privacy_view(&app) }));
        }
        _ => return Err("action".into()),
    }
    Ok(json!({ "ok": true, "view": privacy_view(&app) }))
}

#[cfg(test)]
mod tests {
    use super::{accessibility_hint, settings_user_agent, system_audio_start_allowed};

    #[test]
    fn system_audio_starts_only_from_the_tab_in_use() {
        assert!(system_audio_start_allowed(true, false, false));
        assert!(!system_audio_start_allowed(false, false, false));
        // Una captura en curso: solo la reinicia la pestaña que la empezó, aunque otra esté adelante.
        assert!(system_audio_start_allowed(false, true, true));
        assert!(!system_audio_start_allowed(true, true, false));
        assert!(!system_audio_start_allowed(false, true, false));
    }

    #[test]
    fn settings_ua_is_recognized_by_the_server() {
        // lib/settings-embed.ts: SETTINGS_EMBED_UA = 'zerosoft-settings/'.
        assert!(settings_user_agent("0.3.2").ends_with(" zerosoft-settings/0.3.2"));
    }

    #[test]
    fn accessibility_hints() {
        assert_eq!(accessibility_hint(true, "", "0.3.0", "adhoc"), "ok");
        // Se vio permitida en otra versión: la entrada de macOS es de la build vieja.
        assert_eq!(accessibility_hint(false, "0.2.1", "0.3.0", "stable"), "updated");
        assert_eq!(accessibility_hint(false, "", "0.3.0", "adhoc"), "adhoc");
        assert_eq!(accessibility_hint(false, "0.3.0", "0.3.0", "stable"), "off");
        assert_eq!(accessibility_hint(false, "", "0.3.0", "unknown"), "off");
    }
}

/// Empieza a capturar el audio del sistema para las notas de reunión. Devuelve
/// "ok" | "denied" | "unsupported" | "failed". Sin permiso, pide el aviso de macOS y abre el panel
/// de Grabación de pantalla (la persona lo activa y vuelve a empezar; macOS pide reabrir la app).
#[tauri::command]
pub async fn desktop_system_audio_start(app: AppHandle, window: tauri::Webview) -> CmdResult<String> {
    from_app(&app, &window)?;
    // Apagado en Ajustes › Privacidad y datos: la app no captura (la página sigue con el micrófono).
    if !app.state::<AppState>().settings.lock().unwrap().allow_system_audio {
        return Ok(crate::system_audio::SysAudio::Unsupported.code().to_string());
    }
    // Solo desde la pestaña que la persona está usando: una pestaña de atrás, una ventana sin foco,
    // tapada o escondida no puede empezar a capturar. Reiniciar una captura en curso, solo la
    // pestaña que la empezó.
    let label = window.label().to_string();
    let in_use = crate::tabs::tab_id(&label).is_some_and(|id| crate::tabs::tab_in_use(&app, id));
    if !system_audio_start_allowed(in_use, crate::system_audio::running(), is_system_audio_owner(&label)) {
        return Ok(crate::system_audio::SysAudio::Failed.code().to_string());
    }
    let res = tauri::async_runtime::spawn_blocking(crate::system_audio::start).await.map_err(|e| e.to_string())?;
    if res == crate::system_audio::SysAudio::Ok {
        *SYSTEM_AUDIO_OWNER.lock().unwrap() = Some(label);
    }
    if res == crate::system_audio::SysAudio::Denied {
        let _ = app.opener().open_url(platform::PANE_SCREEN, None::<&str>);
    }
    Ok(res.code().to_string())
}

/// Lo capturado desde la lectura anterior (PCM i16 little endian, 16 kHz, mono) en base64.
#[tauri::command]
pub fn desktop_system_audio_read(app: AppHandle, window: tauri::Webview) -> CmdResult<String> {
    from_app(&app, &window)?;
    // Otra pestaña no lee lo que captura la que la empezó.
    if !is_system_audio_owner(window.label()) {
        return Ok(String::new());
    }
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(crate::system_audio::read()))
}

#[tauri::command]
pub fn desktop_system_audio_stop(app: AppHandle, window: tauri::Webview) -> CmdResult<()> {
    from_app(&app, &window)?;
    if !is_system_audio_owner(window.label()) {
        return Ok(());
    }
    crate::system_audio::stop();
    Ok(())
}
