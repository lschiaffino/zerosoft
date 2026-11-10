//! Comandos de la ventana de Ajustes (archivo local) y del puente de la página remota.
//! Cada comando revisa quién lo llama además de los permisos de capabilities/: Ajustes solo desde
//! la ventana "settings"; el puente solo desde la ventana "main" con el origen del servidor.

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

type CmdResult<T> = Result<T, String>;

/// Solo la página local de la ventana de Ajustes (no una ruta del servidor cargada ahí).
fn from_settings(w: &WebviewWindow) -> CmdResult<()> {
    if w.label() == "settings" && w.url().map(|u| crate::nav::is_local(&u)).unwrap_or(false) {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

fn from_app(app: &AppHandle, w: &WebviewWindow) -> CmdResult<()> {
    let server = api::server(app);
    let ok = w.label() == "main" && w.url().map(|u| crate::nav::classify(&u, &server) == crate::nav::Nav::Allow).unwrap_or(false);
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
        SettingsNav::Local | SettingsNav::Web => true,
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
    if next.recording_indicator != prev.recording_indicator {
        crate::indicator::update(&app);
    }
    if next.server != prev.server {
        crate::allow_server(&app);
        crate::load_app_path(&app, "/app");
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
                let _ = tauri::async_runtime::spawn_blocking(|| crate::audio::start().map(|c| c.finish())).await;
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
    for k in ["language", "cleanupMode", "aiCleanup", "styles"] {
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
pub fn history_copy(window: WebviewWindow, text: String) -> CmdResult<bool> {
    from_settings(&window)?;
    let text: String = text.chars().take(20_000).collect();
    Ok(arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).is_ok())
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
    Ok(match dictation::insert_text(&app, &text).await {
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
    crate::auth::sign_out(&app).await;
    crate::load_app_path(&app, "/app");
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
pub fn desktop_info(app: AppHandle, window: WebviewWindow) -> CmdResult<DesktopInfo> {
    from_app(&app, &window)?;
    Ok(DesktopInfo {
        version: app.package_info().version.to_string(),
        platform: if cfg!(target_os = "macos") { "darwin" } else { "win32" },
        system_audio: false,
        dictation: !app.state::<AppState>().shortcut_taken.load(Ordering::Relaxed),
    })
}

#[tauri::command]
pub fn desktop_start_login(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    from_app(&app, &window)?;
    crate::auth::begin_login(&app);
    Ok(())
}

#[tauri::command]
pub fn desktop_open_settings(app: AppHandle, window: WebviewWindow) -> CmdResult<()> {
    from_app(&app, &window)?;
    open_settings_window(&app, None);
    Ok(())
}

/// La página empezó o terminó de grabar una reunión (para el indicador flotante).
#[tauri::command]
pub fn desktop_recording(app: AppHandle, window: WebviewWindow, active: bool, started_at: Option<f64>, path: Option<String>) -> CmdResult<()> {
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
    let rec = st.recording.lock().unwrap().clone();
    Ok(IndicatorView { recording: rec, strings: strings::table(st.locale) })
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
pub fn desktop_notify(app: AppHandle, window: WebviewWindow, title: String, body: Option<String>) -> CmdResult<bool> {
    from_app(&app, &window)?;
    let title: String = title.chars().take(200).collect();
    let body: String = body.unwrap_or_default().chars().take(500).collect();
    Ok(app.notification().builder().title(title).body(body).show().is_ok())
}


#[cfg(test)]
mod tests {
    use super::{accessibility_hint, settings_user_agent};

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
