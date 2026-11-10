//! Navegación de la ventana principal (puro): adentro solo el origen exacto del servidor; el login
//! de Google va por el navegador del sistema (PKCE, auth.rs); el resto de http(s), mailto y tel
//! al navegador; cualquier otro esquema se bloquea.

#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    Allow,
    GoogleLogin,
    External,
    Block,
}

fn origin(u: &url::Url) -> String {
    format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), u.port().map(|p| format!(":{p}")).unwrap_or_default())
}

pub fn classify(target: &url::Url, server: &str) -> Nav {
    match target.scheme() {
        "about" | "blob" | "data" => return if target.as_str() == "about:blank" { Nav::Allow } else { Nav::Block },
        "mailto" | "tel" => return Nav::External,
        "http" | "https" => {}
        _ => return Nav::Block,
    }
    if origin(target) == server {
        return Nav::Allow;
    }
    let host = target.host_str().unwrap_or("");
    if host == "accounts.google.com" || host.ends_with(".accounts.google.com") {
        return Nav::GoogleLogin;
    }
    Nav::External
}

/// Navegación de la ventana de Ajustes: la página local (secciones nativas), las rutas de ajustes
/// del servidor (cargadas adentro, con la sesión de la app) y nada más. Un link a otra página de
/// la app va a la ventana principal; /app/settings/desktop/<sección> vuelve a la sección nativa.
#[derive(Debug, PartialEq, Eq)]
pub enum SettingsNav {
    /// La página local de Ajustes (tauri://localhost en Mac, http(s)://tauri.localhost en Windows).
    Local,
    /// Una ruta de ajustes del servidor: se carga en la ventana.
    Web,
    /// Una sección nativa (o "close": cerrar la ventana).
    Native(String),
    /// Otra página de la app: a la ventana principal (path con query).
    Main(String),
    GoogleLogin,
    External,
    Block,
}

/// Secciones nativas de desktop/ui/settings.ts (TABS), las mismas que DESKTOP_NATIVE_SECTIONS de
/// lib/settings-nav.ts.
pub const NATIVE_SECTIONS: [&str; 9] = ["start", "general", "meetings", "voice", "dictionary", "history", "permissions", "updates", "account"];

pub fn is_local(u: &url::Url) -> bool {
    match u.scheme() {
        "tauri" => u.host_str() == Some("localhost"),
        "http" | "https" => u.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// /app/settings/**, /app/<app>/settings/** o /app/chat/widgets, con o sin locale (como
/// isSettingsRoute de lib/settings-embed.ts).
pub fn settings_route(path: &str) -> bool {
    let p = ["/en/", "/es/", "/pt/"].iter().find_map(|l| path.strip_prefix(&l[..3]).filter(|r| r.starts_with('/'))).unwrap_or(path);
    let Some(rest) = p.strip_prefix("/app/") else { return false };
    let mut parts = rest.split('/');
    let first = parts.next().unwrap_or("");
    let second = parts.next();
    let ok_seg = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    first == "settings" || (ok_seg(first) && second == Some("settings")) || (first == "chat" && second == Some("widgets"))
}

/// La sección nativa de /app/settings/desktop/<sección> (con o sin locale), si es una.
fn native_section(path: &str) -> Option<String> {
    let p = ["/en", "/es", "/pt"].iter().find_map(|l| path.strip_prefix(l).filter(|r| r.starts_with('/'))).unwrap_or(path);
    let rest = p.strip_prefix("/app/settings/desktop")?;
    let tab = rest.trim_start_matches('/').trim_end_matches('/');
    if tab.is_empty() {
        return Some("general".into());
    }
    if tab == "close" || NATIVE_SECTIONS.contains(&tab) {
        Some(tab.to_string())
    } else {
        None
    }
}

pub fn classify_settings(target: &url::Url, server: &str) -> SettingsNav {
    if is_local(target) {
        return SettingsNav::Local;
    }
    match classify(target, server) {
        Nav::Allow => {
            let path = target.path();
            if let Some(tab) = native_section(path) {
                SettingsNav::Native(tab)
            } else if settings_route(path) {
                SettingsNav::Web
            } else if target.as_str() == "about:blank" {
                SettingsNav::Block
            } else {
                let q = target.query().map(|q| format!("?{q}")).unwrap_or_default();
                SettingsNav::Main(format!("{path}{q}"))
            }
        }
        Nav::GoogleLogin => SettingsNav::GoogleLogin,
        Nav::External => SettingsNav::External,
        Nav::Block => SettingsNav::Block,
    }
}

/// Path que la ventana de Ajustes puede pedir cargar (settings_open_web): una ruta de ajustes,
/// sin esquema, sin `..` ni `//`, con caracteres comunes de URL.
pub fn valid_settings_path(p: &str) -> bool {
    p.starts_with('/')
        && p.len() <= 300
        && !p.contains("//")
        && !p.contains("..")
        && p.chars().all(|c| c.is_ascii_alphanumeric() || "/-_?=&.#%".contains(c))
        && settings_route(p.split(['?', '#']).next().unwrap_or(""))
}

#[cfg(test)]
mod tests {
    use super::*;
    const S: &str = "https://zerosoft.ai";
    fn c(u: &str) -> Nav {
        classify(&url::Url::parse(u).unwrap(), S)
    }

    #[test]
    fn policy() {
        assert_eq!(c("https://zerosoft.ai/app/talk"), Nav::Allow);
        assert_eq!(c("https://zerosoft.ai.evil.com/app"), Nav::External);
        assert_eq!(c("http://zerosoft.ai/app"), Nav::External);
        assert_eq!(c("https://accounts.google.com/o/oauth2/v2/auth?x=1"), Nav::GoogleLogin);
        assert_eq!(c("https://example.com/docs"), Nav::External);
        assert_eq!(c("mailto:a@b.c"), Nav::External);
        assert_eq!(c("file:///etc/passwd"), Nav::Block);
        assert_eq!(c("javascript:alert(1)"), Nav::Block);
        assert_eq!(c("about:blank"), Nav::Allow);
        assert_eq!(classify(&url::Url::parse("http://localhost:3210/app").unwrap(), "http://localhost:3210"), Nav::Allow);
    }

    #[test]
    fn settings_window_policy() {
        let c = |u: &str| classify_settings(&url::Url::parse(u).unwrap(), S);
        assert_eq!(c("tauri://localhost/settings.html#voice"), SettingsNav::Local);
        assert_eq!(c("http://tauri.localhost/settings.html"), SettingsNav::Local);
        assert_eq!(c("https://zerosoft.ai/es/app/settings/members"), SettingsNav::Web);
        assert_eq!(c("https://zerosoft.ai/app/crm/settings?tab=import"), SettingsNav::Web);
        assert_eq!(c("https://zerosoft.ai/en/app/chat/widgets"), SettingsNav::Web);
        assert_eq!(c("https://zerosoft.ai/en/app/settings/desktop/permissions"), SettingsNav::Native("permissions".into()));
        assert_eq!(c("https://zerosoft.ai/app/settings/desktop"), SettingsNav::Native("general".into()));
        assert_eq!(c("https://zerosoft.ai/app/settings/desktop/close"), SettingsNav::Native("close".into()));
        // Una sección que no existe es una ruta de ajustes más (la página web la muestra).
        assert_eq!(c("https://zerosoft.ai/app/settings/desktop/nope"), SettingsNav::Web);
        assert_eq!(c("https://zerosoft.ai/es/app/crm/contacts?x=1"), SettingsNav::Main("/es/app/crm/contacts?x=1".into()));
        assert_eq!(c("https://zerosoft.ai/es/app/settingsx"), SettingsNav::Main("/es/app/settingsx".into()));
        assert_eq!(c("https://example.com/app/settings"), SettingsNav::External);
        assert_eq!(c("https://accounts.google.com/o"), SettingsNav::GoogleLogin);
        assert_eq!(c("file:///etc/passwd"), SettingsNav::Block);
        assert_eq!(c("tauri://evil/settings.html"), SettingsNav::Block);
    }

    #[test]
    fn settings_paths() {
        assert!(valid_settings_path("/app/settings/offline"));
        assert!(valid_settings_path("/app/track/settings?tab=notifications"));
        assert!(!valid_settings_path("/app/crm"));
        assert!(!valid_settings_path("//evil.com/app/settings"));
        assert!(!valid_settings_path("/app/settings/../../x"));
        assert!(!valid_settings_path("https://evil.com/app/settings"));
        assert!(!valid_settings_path("/app/settings/\"x"));
    }
}
