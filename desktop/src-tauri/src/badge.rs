//! Contador del dock y avisos nativos: cada 30 s (y al volver el foco) GET /api/desktop/badge
//! con la sesión; con la ventana sin foco, cada aviso nuevo sale como notificación del sistema.

use serde_json::Value;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::state::AppState;

pub async fn poll(app: &AppHandle) {
    let since = app.state::<AppState>().badge_since.lock().unwrap().clone();
    let path = match &since {
        Some(s) => format!("/api/desktop/badge?since={}", url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>()),
        None => "/api/desktop/badge".to_string(),
    };
    let res = crate::api::get(app, &path).await;
    let Some(body) = res.body.filter(|_| res.status == Some(200)) else { return };
    let total = body.get("total").and_then(Value::as_i64).unwrap_or(0);
    // Puntos en las pestañas: productos (segmento de /app/<x>) con algo sin leer.
    let mut products: Vec<String> = body.get("byPath").and_then(Value::as_object).map(|m| m.iter().filter(|(_, v)| v.as_i64().unwrap_or(0) > 0).map(|(k, _)| k.clone()).collect()).unwrap_or_default();
    if body.get("talk").and_then(Value::as_i64).unwrap_or(0) > 0 && !products.iter().any(|p| p == "talk") {
        products.push("talk".into());
    }
    crate::tabs::set_unread(app, products);
    if let Some(win) = app.get_window(&crate::tabs::focused_label(app)) {
        let _ = win.set_badge_count(if total > 0 { Some(total) } else { None });
        let focused = crate::tabs::any_focused(app);
        // Al arrancar (sin `since`) no se repiten los avisos viejos.
        if since.is_some() && !focused {
            for n in body.get("notifications").and_then(Value::as_array).cloned().unwrap_or_default().iter().take(5) {
                let title = n.get("title").and_then(Value::as_str).unwrap_or("zerosoft");
                let text = n.get("body").and_then(Value::as_str).unwrap_or("");
                let _ = app.notification().builder().title(title).body(text).show();
            }
        }
    }
    if let Some(now) = body.get("now").and_then(Value::as_str) {
        *app.state::<AppState>().badge_since.lock().unwrap() = Some(now.to_string());
    }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            poll(&app).await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
