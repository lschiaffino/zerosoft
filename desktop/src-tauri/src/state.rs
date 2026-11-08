//! Estado compartido de la app (Tauri lo guarda con `manage`).

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::audio::Capture;
use crate::config::Settings;
use crate::retry::PendingStore;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    Recording,
    Working,
}

pub struct Dictation {
    pub phase: Phase,
    pub capture: Option<Capture>,
    /// Grabando sin mantener (un toque corto o el menú).
    pub hands_free: bool,
    /// Cuándo se apretó el atajo (para distinguir toque de mantener).
    pub pressed_at: Option<std::time::Instant>,
    pub source_app: String,
    /// Sube con cada grabación: los temporizadores viejos no tocan una nueva.
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    /// ms desde epoch.
    pub started_at: u64,
    /// Página de la reunión (/app/...), para "Abrir".
    pub path: String,
}

pub struct AuthPending {
    pub state: String,
    pub verifier: String,
    pub server: String,
    pub at: std::time::Instant,
}

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub config_dir: PathBuf,
    pub pending: PendingStore,
    pub dictation: Mutex<Dictation>,
    pub locale: &'static str,
    pub last_text: Mutex<String>,
    pub last_latency: Mutex<Option<crate::dictation::Latency>>,
    /// Reunión grabándose en la ventana principal (la avisa la página por el puente).
    pub recording: Mutex<Option<Recording>>,
    pub http: reqwest::Client,
    pub auth: Mutex<Option<AuthPending>>,
    pub shortcut_taken: AtomicBool,
    pub badge_since: Mutex<Option<String>>,
    /// Versión nueva bajada y lista para instalar al reiniciar.
    pub update_ready: Mutex<Option<String>>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
