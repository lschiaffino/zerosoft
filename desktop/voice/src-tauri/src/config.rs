//! Configuración local: servidor, atajo y contexto en config.json; la API key
//! en el llavero del sistema (crate keyring). La key nunca vuelve a la ventana.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "ai.zerosoft.voice";
const KEYRING_USER: &str = "api_key";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    /// Base de la API v1, p. ej. https://zerosoft.ai/api/v1
    pub server: String,
    /// Key zs_… con scopes voice:read y voice:write. Vive en el llavero, no en config.json.
    #[serde(skip)]
    pub api_key: String,
    /// Atajo global de mantener para dictar.
    pub shortcut: String,
    /// Contexto del dictado: email | chat | note | other.
    pub context: String,
}

/// Lo que ve la ventana: sin la key, solo si hay una guardada.
#[derive(Clone, Debug, Serialize)]
pub struct PublicConfig {
    pub server: String,
    pub shortcut: String,
    pub context: String,
    pub has_key: bool,
}

/// Lo que manda la ventana al guardar. `api_key` vacía = dejar la que está.
#[derive(Clone, Debug, Deserialize)]
pub struct ConfigInput {
    pub server: String,
    pub api_key: Option<String>,
    pub shortcut: String,
    pub context: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server: "https://zerosoft.ai/api/v1".into(),
            api_key: String::new(),
            shortcut: "Control+Alt+Space".into(),
            context: "other".into(),
        }
    }
}

impl Config {
    pub fn public(&self) -> PublicConfig {
        PublicConfig { server: self.server.clone(), shortcut: self.shortcut.clone(), context: self.context.clone(), has_key: !self.api_key.is_empty() }
    }
}

/// Solo https, salvo localhost para desarrollo: la key viaja en cada pedido.
pub fn valid_server(server: &str) -> bool {
    let s = server.trim().to_ascii_lowercase();
    if s.starts_with("https://") {
        return s.len() > "https://".len();
    }
    ["http://localhost", "http://127.0.0.1", "http://[::1]"].iter().any(|p| {
        s == *p || s.starts_with(&format!("{p}:")) || s.starts_with(&format!("{p}/"))
    })
}

fn path(dir: &PathBuf) -> PathBuf {
    dir.join("config.json")
}

fn entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()
}

pub fn load(dir: &PathBuf) -> Config {
    let mut cfg: Config = std::fs::read_to_string(path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    cfg.api_key = entry().and_then(|e| e.get_password().ok()).unwrap_or_default();
    cfg
}

pub fn save(dir: &PathBuf, cfg: &Config) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(path(dir), serde_json::to_string_pretty(cfg)?)?;
    if let Some(e) = entry() {
        if cfg.api_key.is_empty() {
            let _ = e.delete_credential();
        } else {
            e.set_password(&cfg.api_key)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::valid_server;

    #[test]
    fn only_https_or_localhost() {
        assert!(valid_server("https://zerosoft.ai/api/v1"));
        assert!(valid_server("http://localhost:3000/api/v1"));
        assert!(valid_server("http://127.0.0.1/api/v1"));
        assert!(!valid_server("http://zerosoft.ai/api/v1"));
        assert!(!valid_server("http://localhost.evil.com/api/v1"));
        assert!(!valid_server("ftp://x"));
    }
}
