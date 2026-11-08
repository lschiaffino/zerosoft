//! Deep links zerosoft:// validados campo por campo (puro).
//! - zerosoft://auth/callback?code&state: vuelta del login en el navegador.
//! - zerosoft://open?path=/app/... (o zerosoft://open/app/...): abre una página de la app.

#[derive(Debug, PartialEq, Eq)]
pub enum DeepLink {
    Auth { code: String, state: String },
    Open { path: String },
}

pub const SCHEME: &str = "zerosoft";

fn token_ok(v: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&v.len()) && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Path de la app: /app o /<locale>/app, sin //, sin \, sin .. ni esquema.
pub fn safe_app_path(p: &str) -> Option<String> {
    if p.len() > 500 || !p.starts_with('/') || p.starts_with("//") || p.contains('\\') || p.contains("..") || p.contains(':') {
        return None;
    }
    let path_only = p.split(['?', '#']).next().unwrap_or("");
    let segs: Vec<&str> = path_only.split('/').skip(1).collect();
    let ok = match segs.as_slice() {
        ["app", ..] => true,
        [l, "app", ..] => matches!(*l, "en" | "es" | "pt"),
        _ => false,
    };
    ok.then(|| p.to_string())
}

pub fn parse(raw: &str) -> Option<DeepLink> {
    if raw.len() > 2000 {
        return None;
    }
    let u = url::Url::parse(raw).ok()?;
    if !u.scheme().eq_ignore_ascii_case(SCHEME) || !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let q = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    match host.as_str() {
        "auth" => {
            if u.path().trim_end_matches('/') != "/callback" {
                return None;
            }
            let (code, state) = (q("code")?, q("state")?);
            (token_ok(&code, 20, 200) && token_ok(&state, 16, 200)).then_some(DeepLink::Auth { code, state })
        }
        "open" => {
            let path = match q("path") {
                Some(p) => p,
                None => {
                    let mut p = u.path().to_string();
                    if let Some(qs) = u.query() {
                        p = format!("{p}?{qs}");
                    }
                    p
                }
            };
            safe_app_path(&path).map(|path| DeepLink::Open { path })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const CODE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const STATE: &str = "SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS";

    #[test]
    fn auth_callback() {
        assert_eq!(parse(&format!("zerosoft://auth/callback?code={CODE}&state={STATE}")), Some(DeepLink::Auth { code: CODE.into(), state: STATE.into() }));
        assert_eq!(parse(&format!("zerosoft://auth/callback?code=short&state={STATE}")), None);
        assert_eq!(parse(&format!("zerosoft://auth/other?code={CODE}&state={STATE}")), None);
        assert_eq!(parse(&format!("zerosoft://user:pw@auth/callback?code={CODE}&state={STATE}")), None);
        assert_eq!(parse(&format!("https://auth/callback?code={CODE}&state={STATE}")), None);
        assert_eq!(parse(&format!("zerosoft://auth/callback?code={CODE}%3Cscript%3E&state={STATE}")), None);
    }

    #[test]
    fn open_only_app_pages() {
        assert_eq!(parse("zerosoft://open?path=/app/talk"), Some(DeepLink::Open { path: "/app/talk".into() }));
        assert_eq!(parse("zerosoft://open/app/voice?new=1"), Some(DeepLink::Open { path: "/app/voice?new=1".into() }));
        assert_eq!(parse("zerosoft://open?path=/es/app/crm"), Some(DeepLink::Open { path: "/es/app/crm".into() }));
        for bad in ["zerosoft://open?path=//evil.com/app", "zerosoft://open?path=https://evil.com/app", "zerosoft://open?path=/blog", "zerosoft://open?path=/app/../x", "zerosoft://nope"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }
}
