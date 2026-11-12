//! Navegación de la ventana principal (puro): adentro solo el origen exacto del servidor; el login
//! de Google va por el navegador del sistema (PKCE, auth.rs); conectar una cuenta (el OAuth de una
//! integración: Gmail, Calendar, Microsoft, Slack, Notion, Linear…) también va por el navegador,
//! empezando por la ruta de inicio del servidor; el resto de http(s), mailto y tel al navegador;
//! cualquier otro esquema se bloquea.

use std::time::Duration;

#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    Allow,
    /// Entrar a la app con Google (next-auth): auth.rs.
    GoogleLogin,
    /// El consentimiento OAuth de una integración que vuelve a un callback del servidor. No es un
    /// login: se abre en el navegador la ruta de inicio que llevó hasta acá (`connect_start`).
    Connect,
    External,
    Block,
}

/// Callback del login con Google (next-auth). Cualquier otro redirect_uri es una integración.
const LOGIN_CALLBACK: &str = "/api/auth/callback/google";

/// Cuánto vale la última navegación propia como "ruta de inicio" del redirect que la sigue.
pub const CONNECT_START_TTL: Duration = Duration::from_secs(30);

fn redirect_uri(target: &url::Url) -> Option<url::Url> {
    let raw = target.query_pairs().find(|(k, _)| k == "redirect_uri")?.1;
    url::Url::parse(&raw).ok().filter(|u| matches!(u.scheme(), "http" | "https"))
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
    let back = redirect_uri(target);
    if host == "accounts.google.com" || host.ends_with(".accounts.google.com") {
        // Sin redirect_uri reconocible queda como login (lo de siempre).
        return match back {
            Some(b) if b.path() != LOGIN_CALLBACK => Nav::Connect,
            _ => Nav::GoogleLogin,
        };
    }
    // Otro proveedor que vuelve a un callback de este servidor: también es conectar una cuenta.
    match back {
        Some(b) if origin(&b) == server => Nav::Connect,
        _ => Nav::External,
    }
}

/// La ruta de inicio a abrir en el navegador del sistema para un `Nav::Connect`: la última
/// navegación que se dejó pasar, si es reciente, del servidor y una ruta de API (las de inicio de
/// OAuth lo son: ponen la cookie de state y redirigen al proveedor). El state se valida contra esa
/// cookie, así que todo el recorrido tiene que pasar en el mismo navegador. Nunca devuelve una URL
/// de otro origen ni las rutas de next-auth.
pub fn connect_start(last: Option<(&url::Url, Duration)>, server: &str) -> Option<String> {
    let (u, age) = last?;
    if age > CONNECT_START_TTL || !matches!(u.scheme(), "http" | "https") || origin(u) != server {
        return None;
    }
    let path = u.path();
    if !path.starts_with("/api/") || path.starts_with("/api/auth/") {
        return None;
    }
    Some(u.to_string())
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
    Connect,
    External,
    Block,
}

/// Secciones nativas de desktop/ui/settings.ts (TABS), las mismas que DESKTOP_NATIVE_SECTIONS de
/// lib/settings-nav.ts.
pub const NATIVE_SECTIONS: [&str; 10] = ["start", "general", "meetings", "voice", "dictionary", "history", "permissions", "privacy", "updates", "account"];

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
        Nav::Connect => SettingsNav::Connect,
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
        assert_eq!(c("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fauth%2Fcallback%2Fgoogle&state=s"), Nav::GoogleLogin);
        assert_eq!(c("https://example.com/docs"), Nav::External);
        assert_eq!(c("mailto:a@b.c"), Nav::External);
        assert_eq!(c("file:///etc/passwd"), Nav::Block);
        assert_eq!(c("javascript:alert(1)"), Nav::Block);
        assert_eq!(c("about:blank"), Nav::Allow);
        assert_eq!(classify(&url::Url::parse("http://localhost:3210/app").unwrap(), "http://localhost:3210"), Nav::Allow);
    }

    fn urlencode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }

    #[test]
    fn connect_is_not_login() {
        // Gmail (CRM e Inbox), Calendar y YouTube: Google, pero con el callback de la integración.
        for cb in ["/api/integrations/gmail/callback", "/api/integrations/google-calendar/callback", "/api/social/oauth/callback"] {
            let u = format!("https://accounts.google.com/o/oauth2/v2/auth?client_id=x&redirect_uri={}&state=s", urlencode(&format!("{S}{cb}")));
            assert_eq!(c(&u), Nav::Connect, "{cb}");
        }
        // Otros proveedores que vuelven a este servidor.
        assert_eq!(c("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Foutlook%2Fcallback"), Nav::Connect);
        assert_eq!(c("https://slack.com/oauth/v2/authorize?state=s&redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Ftrack%2Fslack%2Fcallback"), Nav::Connect);
        assert_eq!(c("https://api.notion.com/v1/oauth/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Fnotion%2Fcallback"), Nav::Connect);
        assert_eq!(c("https://linear.app/oauth/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Flinear%2Fcallback"), Nav::Connect);
        // Un redirect_uri de otro sitio, roto o de otro esquema es un link externo cualquiera.
        assert_eq!(c("https://slack.com/oauth/v2/authorize?redirect_uri=https%3A%2F%2Fevil.com%2Fapi%2Fx"), Nav::External);
        assert_eq!(c("https://slack.com/oauth/v2/authorize?redirect_uri=https%3A%2F%2Fzerosoft.ai.evil.com%2Fapi%2Fx"), Nav::External);
        assert_eq!(c("https://slack.com/oauth/v2/authorize?redirect_uri=nope"), Nav::External);
        assert_eq!(c("https://slack.com/oauth/v2/authorize?redirect_uri=javascript%3Aalert(1)"), Nav::External);
        assert_eq!(c("https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=nope"), Nav::GoogleLogin);
        // El origen propio siempre va adentro, tenga el parámetro que tenga.
        assert_eq!(c("https://zerosoft.ai/api/inbox/gmail?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fx"), Nav::Allow);
    }

    #[test]
    fn connect_start_only_own_api_routes() {
        let s = |u: &str, secs: u64| connect_start(Some((&url::Url::parse(u).unwrap(), Duration::from_secs(secs))), S);
        assert_eq!(s("https://zerosoft.ai/api/inbox/gmail", 0), Some("https://zerosoft.ai/api/inbox/gmail".into()));
        assert_eq!(
            s("https://zerosoft.ai/api/integrations/gmail/start?return=%2Fes%2Fapp%2Fwelcome", 2),
            Some("https://zerosoft.ai/api/integrations/gmail/start?return=%2Fes%2Fapp%2Fwelcome".into())
        );
        // Vieja, una página (no una ruta de inicio), next-auth u otro origen: nada.
        assert_eq!(s("https://zerosoft.ai/api/inbox/gmail", 31), None);
        assert_eq!(s("https://zerosoft.ai/es/app/social/accounts", 0), None);
        assert_eq!(s("https://zerosoft.ai/api/auth/signin/google", 0), None);
        assert_eq!(s("https://evil.com/api/inbox/gmail", 0), None);
        assert_eq!(s("http://zerosoft.ai/api/inbox/gmail", 0), None);
        assert_eq!(s("about:blank", 0), None);
        assert_eq!(connect_start(None, S), None);
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
        assert_eq!(c("https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fzerosoft.ai%2Fapi%2Fintegrations%2Fgmail%2Fcallback"), SettingsNav::Connect);
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
