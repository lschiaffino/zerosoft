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
}
