//! Pedidos de la app al servidor con la sesión de la ventana: la cookie sale del cookie store
//! del webview (el mismo login que la página), nunca de un archivo propio.
//! En Windows leer cookies desde un handler síncrono traba WebView2: todo esto corre en tareas
//! async (tauri::async_runtime).

use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub struct ApiResponse {
    /// None = no hubo respuesta (sin conexión, DNS, timeout).
    pub status: Option<u16>,
    pub body: Option<Value>,
}

pub fn server(app: &AppHandle) -> String {
    app.state::<AppState>().settings.lock().unwrap().server.clone()
}

/// "nombre=valor; ..." de las cookies del servidor en el webview principal.
pub async fn cookie_header(app: &AppHandle) -> String {
    let Some(win) = crate::tabs::any_webview(app) else { return String::new() };
    let Ok(url) = url::Url::parse(&server(app)) else { return String::new() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    // Hilo aparte: en Windows la lectura de cookies no puede bloquear el hilo de eventos.
    std::thread::spawn(move || {
        let v = win.cookies_for_url(url).unwrap_or_default();
        let _ = tx.send(v.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; "));
    });
    rx.await.unwrap_or_default()
}

/// Cómo se presentan los pedidos de la app (los suyos y los del updater).
pub const USER_AGENT: &str = concat!("zerosoft-desktop/", env!("CARGO_PKG_VERSION"));

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(75))
        .build()
        .unwrap_or_default()
}

async fn finish(res: Result<reqwest::Response, reqwest::Error>) -> ApiResponse {
    match res {
        Ok(r) => {
            let status = r.status().as_u16();
            let body = r.json::<Value>().await.ok();
            ApiResponse { status: Some(status), body }
        }
        Err(_) => ApiResponse { status: None, body: None },
    }
}

pub async fn get(app: &AppHandle, path: &str) -> ApiResponse {
    let url = format!("{}{}", server(app), path);
    let cookie = cookie_header(app).await;
    let http = app.state::<AppState>().http.clone();
    finish(http.get(url).header("cookie", cookie).send().await).await
}

pub async fn send_json(app: &AppHandle, method: reqwest::Method, path: &str, body: &Value) -> ApiResponse {
    let url = format!("{}{}", server(app), path);
    let cookie = cookie_header(app).await;
    let http = app.state::<AppState>().http.clone();
    // Origin del servidor: las rutas de escritura del sitio piden el mismo origen.
    finish(http.request(method, url).header("cookie", cookie).header("origin", server(app)).json(body).send().await).await
}

pub async fn delete(app: &AppHandle, path: &str) -> ApiResponse {
    let url = format!("{}{}", server(app), path);
    let cookie = cookie_header(app).await;
    let http = app.state::<AppState>().http.clone();
    finish(http.delete(url).header("cookie", cookie).header("origin", server(app)).send().await).await
}

/// Dictado: multipart con el audio (WAV) y el contexto. `capture=desktop` para el historial.
pub async fn dictate(app: &AppHandle, wav: Vec<u8>, source_app: &str, context: &str, duration_ms: u64) -> ApiResponse {
    let url = format!("{}/api/voice/dictate", server(app));
    let cookie = cookie_header(app).await;
    let http = app.state::<AppState>().http.clone();
    let part = match reqwest::multipart::Part::bytes(wav).file_name("dictation.wav").mime_str("audio/wav") {
        Ok(p) => p,
        Err(_) => return ApiResponse { status: None, body: None },
    };
    let form = reqwest::multipart::Form::new()
        .text("context", context.to_string())
        .text("sourceApp", if source_app.is_empty() { "desktop".to_string() } else { source_app.to_string() })
        .text("durationMs", duration_ms.to_string())
        .text("capture", "desktop")
        // Respuesta rápida: el servidor salta la limpieza con IA en frases cortas, le pone un tope
        // de tiempo y guarda el historial después de contestar.
        .text("fast", "1")
        .part("audio", part);
    finish(http.post(url).header("cookie", cookie).header("origin", server(app)).multipart(form).send().await).await
}

/// Abre la conexión con el servidor (TCP + TLS) mientras se graba: al soltar el atajo, el audio
/// sale por una conexión ya lista del pool de reqwest.
pub async fn warm(app: AppHandle) {
    let url = format!("{}/robots.txt", server(&app));
    let http = app.state::<AppState>().http.clone();
    let _ = http.head(url).timeout(Duration::from_secs(5)).send().await;
}

/// Si la respuesta dice "sin sesión" o "sin conexión", para los errores de Ajustes.
pub fn remote_error(status: Option<u16>) -> &'static str {
    match status {
        None => "offline",
        Some(401) => "signed_out",
        _ => "failed",
    }
}
