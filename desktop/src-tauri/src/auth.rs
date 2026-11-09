//! Login sin Google en un webview (Google no lo permite):
//!
//! 1. `begin_login` arma un verifier PKCE y un state al azar y abre en el navegador del sistema
//!    <servidor>/api/desktop/login?challenge&state.
//! 2. La persona entra con Google en su navegador y el servidor redirige a
//!    zerosoft://auth/callback?code&state con un código de un solo uso (2 minutos).
//! 3. `complete_login` valida el state, canjea código + verifier en POST /api/desktop/token y pone
//!    la cookie de sesión en el webview. El webview la guarda (cookie persistente) y la app la
//!    lee de ahí para sus pedidos: no hay copia propia del token.
//!
//! Con email (código por correo) se entra directamente en la ventana: la cookie queda igual.

use base64::Engine;
use rand::RngCore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::api;
use crate::state::{AppState, AuthPending};

const PENDING_TTL: Duration = Duration::from_secs(600);

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random(n: usize) -> String {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    b64url(&buf)
}

pub fn challenge_for(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn begin_login(app: &AppHandle) {
    let st = app.state::<AppState>();
    let server = api::server(app);
    let verifier = random(32);
    let state = random(24);
    let mut url = match url::Url::parse(&format!("{server}/api/desktop/login")) {
        Ok(u) => u,
        Err(_) => return,
    };
    url.query_pairs_mut()
        .append_pair("challenge", &challenge_for(&verifier))
        .append_pair("state", &state)
        .append_pair("locale", st.locale)
        .append_pair("device", if cfg!(target_os = "macos") { "darwin" } else { "win32" });
    *st.auth.lock().unwrap() = Some(AuthPending { state, verifier, server, at: Instant::now() });
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
}

fn same(a: &str, b: &str) -> bool {
    // Comparación de tiempo constante.
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Vuelta del navegador (deep link ya validado). true = sesión lista en el webview.
pub async fn complete_login(app: &AppHandle, code: &str, state: &str) -> bool {
    let pending = {
        let st = app.state::<AppState>();
        let mut guard = st.auth.lock().unwrap();
        match guard.take() {
            Some(p) if p.at.elapsed() < PENDING_TTL && same(&p.state, state) => p,
            other => {
                *guard = other;
                return false;
            }
        }
    };
    if pending.server != api::server(app) {
        return false;
    }
    let http = app.state::<AppState>().http.clone();
    let res = http.post(format!("{}/api/desktop/token", pending.server)).json(&json!({ "code": code, "verifier": pending.verifier })).send().await;
    let Ok(res) = res else { return false };
    if !res.status().is_success() {
        return false;
    }
    let Ok(data) = res.json::<Value>().await else { return false };
    let name = data.pointer("/cookie/name").and_then(Value::as_str).unwrap_or("");
    let token = data.get("token").and_then(Value::as_str).unwrap_or("");
    if token.is_empty() || !(name == "next-auth.session-token" || name == "__Secure-next-auth.session-token") {
        return false;
    }
    let max_age = data.pointer("/cookie/maxAge").and_then(Value::as_i64).unwrap_or(0).clamp(60, 30 * 86_400);
    let Ok(server) = url::Url::parse(&pending.server) else { return false };
    let host = server.host_str().unwrap_or("").to_string();
    let cookie = cookie::Cookie::build((name.to_string(), token.to_string()))
        .domain(host)
        .path("/")
        .secure(server.scheme() == "https")
        .http_only(true)
        .same_site(cookie::SameSite::Lax)
        .max_age(cookie::time::Duration::seconds(max_age))
        .build();
    let Some(win) = crate::tabs::any_webview(app) else { return false };
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(win.set_cookie(cookie).is_ok());
    });
    rx.await.unwrap_or(false)
}

/// Cierra la sesión: borra las cookies de next-auth del webview.
pub async fn sign_out(app: &AppHandle) {
    let Some(win) = crate::tabs::any_webview(app) else { return };
    let Ok(url) = url::Url::parse(&api::server(app)) else { return };
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    std::thread::spawn(move || {
        for c in win.cookies_for_url(url).unwrap_or_default() {
            if c.name().contains("next-auth") {
                let _ = win.delete_cookie(c);
            }
        }
        let _ = tx.send(());
    });
    let _ = rx.await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_s256() {
        // RFC 7636, apéndice B.
        assert_eq!(challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_eq!(random(32).len(), 43);
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
