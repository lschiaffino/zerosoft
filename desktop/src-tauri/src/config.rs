//! Ajustes locales en <config>/settings.json (servidor, atajo, modo, portapapeles). Nada secreto:
//! la sesión va en el llavero del sistema (auth.rs). Lo de Voice (idioma, limpieza, diccionario)
//! vive en el servidor.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_SERVER: &str = "https://zerosoft.ai";

/// Cómo se dicta con el atajo: mantener, tocar para empezar y terminar, o los dos
/// (mantener más de HOLD_MS es mantener; un toque corto es manos libres).
pub const MODES: [&str; 3] = ["both", "hold", "toggle"];

/// Atajos ofrecidos. Todos con modificador + tecla: globalShortcut no admite solo modificadores.
pub const SHORTCUTS: [&str; 6] = ["Alt+Space", "Control+Alt+Space", "Control+Shift+Space", "Alt+Shift+Space", "CommandOrControl+Shift+D", "F5"];

pub fn default_shortcut(platform: &str) -> &'static str {
    if platform == "macos" {
        "Alt+Space"
    } else {
        "Control+Alt+Space"
    }
}

/// Pegar el último dictado otra vez (como en la web).
pub fn paste_last_shortcut(platform: &str) -> &'static str {
    if platform == "macos" {
        "Control+Super+V"
    } else {
        "Control+Alt+Shift+V"
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub server: String,
    pub mode: String,
    pub shortcut: String,
    pub restore_clipboard: bool,
    pub onboarded: bool,
}

/// http(s) con host; http solo para localhost (desarrollo). Devuelve el origen sin barra final.
pub fn normalize_server(raw: &str) -> Option<String> {
    let u = url::Url::parse(raw.trim()).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    if !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    let local = host == "localhost" || host == "127.0.0.1";
    match u.scheme() {
        "https" => {}
        "http" if local => {}
        _ => return None,
    }
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!("{}://{}{}", u.scheme(), host, port))
}

const MODIFIERS: [&str; 10] = ["Command", "Cmd", "Control", "Ctrl", "CommandOrControl", "CmdOrCtrl", "Alt", "Option", "Shift", "Super"];

fn is_key(k: &str) -> bool {
    let up = k.to_ascii_uppercase();
    if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) {
        return true;
    }
    if let Some(n) = up.strip_prefix('F') {
        if let Ok(n) = n.parse::<u8>() {
            return (1..=24).contains(&n);
        }
    }
    matches!(k, "Space" | "Tab" | "Enter" | "Backspace" | "Delete" | "Up" | "Down" | "Left" | "Right" | "Home" | "End" | "PageUp" | "PageDown")
}

/// Atajo razonable: uno o más modificadores distintos y una tecla, o una F sola.
pub fn is_shortcut(v: &str) -> bool {
    if v.is_empty() || v.len() > 60 {
        return false;
    }
    let mut parts: Vec<&str> = v.split('+').collect();
    let key = parts.pop().unwrap_or("");
    if !is_key(key) {
        return false;
    }
    if parts.is_empty() {
        return key.starts_with('F') && key.len() > 1;
    }
    let mut seen = std::collections::HashSet::new();
    parts.iter().all(|p| MODIFIERS.contains(p) && seen.insert(*p))
}

/// settings.json (o lo que sea) → ajustes completos. `server` ya viene normalizado.
pub fn normalize(raw: &Value, platform: &str, server: String) -> Settings {
    let s = |k: &str| raw.get(k).and_then(Value::as_str).unwrap_or("");
    let mode = if MODES.contains(&s("mode")) { s("mode").to_string() } else { "both".into() };
    let shortcut = if is_shortcut(s("shortcut")) { s("shortcut").to_string() } else { default_shortcut(platform).into() };
    Settings {
        server,
        mode,
        shortcut,
        restore_clipboard: raw.get("restoreClipboard").and_then(Value::as_bool) != Some(false),
        onboarded: raw.get("onboarded").and_then(Value::as_bool) == Some(true),
    }
}

/// Lo que manda la ventana de Ajustes: solo pisa lo válido.
pub fn merge_input(current: &Settings, input: &Value) -> Settings {
    let mut next = current.clone();
    if let Some(m) = input.get("mode").and_then(Value::as_str) {
        if MODES.contains(&m) {
            next.mode = m.into();
        }
    }
    if let Some(k) = input.get("shortcut").and_then(Value::as_str) {
        if is_shortcut(k) {
            next.shortcut = k.into();
        }
    }
    if let Some(b) = input.get("restoreClipboard").and_then(Value::as_bool) {
        next.restore_clipboard = b;
    }
    if input.get("onboarded").and_then(Value::as_bool) == Some(true) {
        next.onboarded = true;
    }
    next
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join("settings.json")
}

pub fn load(dir: &Path, platform: &str, env_server: Option<&str>) -> Settings {
    let raw: Value = fs::read_to_string(settings_path(dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let server = env_server
        .and_then(normalize_server)
        .or_else(|| raw.get("server").and_then(Value::as_str).and_then(normalize_server))
        .unwrap_or_else(|| DEFAULT_SERVER.to_string());
    normalize(&raw, platform, server)
}

pub fn save(dir: &Path, s: &Settings) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join("settings.json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s).unwrap_or_default())?;
    fs::rename(tmp, settings_path(dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn server_https_or_local_http() {
        assert_eq!(normalize_server("https://zerosoft.ai/app"), Some("https://zerosoft.ai".into()));
        assert_eq!(normalize_server("http://localhost:3000"), Some("http://localhost:3000".into()));
        assert_eq!(normalize_server("http://evil.com"), None);
        assert_eq!(normalize_server("ftp://x"), None);
        assert_eq!(normalize_server("https://user:pw@zerosoft.ai"), None);
        assert_eq!(normalize_server("nope"), None);
    }

    #[test]
    fn defaults_per_platform() {
        let mac = normalize(&Value::Null, "macos", DEFAULT_SERVER.into());
        assert_eq!(mac.mode, "both");
        assert_eq!(mac.shortcut, "Alt+Space");
        assert!(mac.restore_clipboard);
        assert!(!mac.onboarded);
        assert_eq!(normalize(&Value::Null, "windows", DEFAULT_SERVER.into()).shortcut, "Control+Alt+Space");
    }

    #[test]
    fn invalid_values_fall_back() {
        let s = normalize(&json!({"mode": "always", "shortcut": "A", "restoreClipboard": "no", "onboarded": "yes"}), "macos", DEFAULT_SERVER.into());
        assert_eq!((s.mode.as_str(), s.shortcut.as_str(), s.restore_clipboard, s.onboarded), ("both", "Alt+Space", true, false));
    }

    #[test]
    fn shortcuts() {
        for ok in SHORTCUTS {
            assert!(is_shortcut(ok), "{ok}");
        }
        for bad in ["A", "Space", "Control+Control+A", "Control+Banana", ""] {
            assert!(!is_shortcut(bad), "{bad}");
        }
    }

    #[test]
    fn merge_only_valid() {
        let cur = normalize(&Value::Null, "macos", DEFAULT_SERVER.into());
        let next = merge_input(&cur, &json!({"mode": "toggle", "shortcut": "Control+Shift+Space", "restoreClipboard": false}));
        assert_eq!((next.mode.as_str(), next.shortcut.as_str(), next.restore_clipboard), ("toggle", "Control+Shift+Space", false));
        assert_eq!(merge_input(&cur, &json!({"mode": "x", "shortcut": "Q", "server": "http://evil"})), cur);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("zs-cfg-{}", std::process::id()));
        let mut s = normalize(&Value::Null, "macos", DEFAULT_SERVER.into());
        s.mode = "hold".into();
        save(&dir, &s).unwrap();
        assert_eq!(load(&dir, "macos", None), s);
        assert_eq!(load(&dir, "macos", Some("http://localhost:3210")).server, "http://localhost:3210");
        let _ = fs::remove_dir_all(dir);
    }
}
