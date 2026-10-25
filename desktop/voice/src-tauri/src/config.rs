//! Configuración local: servidor, API key, atajo y contexto. Se guarda en el
//! directorio de configuración de la app (la key queda solo en esta compu).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    /// Base de la API v1, p. ej. https://zerosoft.ai/api/v1
    pub server: String,
    /// Key zs_… con scopes voice:read y voice:write.
    pub api_key: String,
    /// Atajo global de mantener para dictar.
    pub shortcut: String,
    /// Contexto del dictado: email | chat | note | other.
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

fn path(dir: &PathBuf) -> PathBuf {
    dir.join("config.json")
}

pub fn load(dir: &PathBuf) -> Config {
    std::fs::read_to_string(path(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save(dir: &PathBuf, cfg: &Config) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(path(dir), serde_json::to_string_pretty(cfg).unwrap_or_default())
}
