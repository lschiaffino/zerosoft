//! Arrancar sin conexión. La página de zerosoft anda sin red gracias a su service worker
//! (public/sw.js: guarda las vistas y los archivos de las apps que andan sin red, y para las demás
//! responde "necesita conexión"). WKWebView y WebView2 lo usan igual que un navegador.
//!
//! Lo que el worker no puede cubrir es la primera carga sin él: la primera vez que se abre la app
//! sin red, o si se borraron los datos guardados. Ahí la navegación falla y WKWebView deja la
//! pestaña en blanco. Si una pestaña no terminó de cargar en `GRACE`, se le inyecta
//! (en el documento en blanco que quedó) una página que lo explica y vuelve a probar sola
//! cuando vuelve la red o cada `RETRY_SECS`. Si la carga solo era lenta, la página real la
//! reemplaza al llegar. No se pide nada a la red para decidir.

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Cuánto se espera a que una pestaña termine su primera carga antes de mostrar "sin conexión".
pub const GRACE: Duration = Duration::from_secs(10);
/// Cada cuánto vuelve a probar la página "sin conexión" (además del evento `online`).
pub const RETRY_SECS: u32 = 15;

fn loaded() -> &'static Mutex<HashSet<String>> {
    static L: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(HashSet::new()))
}

/// La pestaña terminó una carga (on_page_load Finished).
pub fn mark_loaded(label: &str) {
    loaded().lock().unwrap().insert(label.to_string());
}

/// Webview nueva (o recreada): si en `GRACE` no terminó de cargar, la página "sin conexión".
pub fn watch(app: &AppHandle, label: &str, target: &str) {
    loaded().lock().unwrap().remove(label);
    let (app, label, target) = (app.clone(), label.to_string(), target.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(GRACE).await;
        if loaded().lock().unwrap().contains(&label) {
            return;
        }
        let Some(wv) = app.get_webview(&label) else { return };
        let locale = app.state::<crate::state::AppState>().locale;
        let _ = wv.eval(fallback_script(locale, &target));
    });
}

fn js_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

/// JS que, en un documento vacío (la navegación falló), dibuja la página "sin conexión" y vuelve
/// a `target` al volver la red, con el botón o cada `RETRY_SECS`. En una página que sí cargó
/// (tiene contenido) no hace nada.
pub fn fallback_script(locale: &str, target: &str) -> String {
    let t = |k: &str| js_string(&crate::strings::t(locale, k));
    format!(
        r#"(function(){{
if (location.protocol !== 'about:' && document.body && document.body.childElementCount > 0) return;
if (document.getElementById('zs-offline')) return;
var target = {target};
var go = function(){{ location.replace(target); }};
document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{{color-scheme:light dark}}body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font:15px/1.5 -apple-system,system-ui,sans-serif;background:Canvas;color:CanvasText}}main{{max-width:380px;padding:24px}}h1{{font-size:1.25rem;margin:0 0 8px}}p{{margin:0 0 16px}}button{{font:inherit;padding:8px 14px;border:1px solid currentColor;border-radius:3px;background:none;color:inherit;cursor:pointer}}</style></head><body><main id="zs-offline" data-zs-offline="desktop"><h1></h1><p></p><button type="button"></button></main></body>';
var m = document.getElementById('zs-offline');
m.querySelector('h1').textContent = {title};
m.querySelector('p').textContent = {body};
var b = m.querySelector('button');
b.textContent = {retry};
b.addEventListener('click', go);
addEventListener('online', go);
setInterval(function(){{ if (navigator.onLine) go(); }}, {every});
}})()"#,
        target = js_string(target),
        title = t("offlineTitle"),
        body = t("offlineBody"),
        retry = t("offlineRetry"),
        every = RETRY_SECS * 1000,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_localized_and_escaped() {
        let s = fallback_script("es", "https://zerosoft.ai/app?x=\"';</script>");
        assert!(s.contains("Sin conexión"), "{s}");
        // El destino va como string JSON: comillas escapadas, nada se cierra.
        assert!(s.contains(r#"var target = "https://zerosoft.ai/app?x=\"';</script>";"#), "{s}");
        assert!(s.contains("setInterval(function(){ if (navigator.onLine) go(); }, 15000);"));
        let en = fallback_script("fr", "https://zerosoft.ai/app");
        assert!(en.contains("You are offline"));
    }

    #[test]
    fn loaded_set() {
        mark_loaded("tab-99");
        assert!(loaded().lock().unwrap().contains("tab-99"));
    }
}
