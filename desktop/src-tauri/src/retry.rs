//! Qué pasó con un dictado enviado al servidor y qué se hace con el audio. Si falló por la red, el
//! servidor o la sesión, el audio queda en <data>/pending para mandarlo de nuevo (bandeja o
//! historial de Ajustes); si el audio no sirve (vacío, demasiado largo), no se guarda.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    Offline,
    SignedOut,
    RateLimited,
    Server,
    TooLarge,
    Empty,
    Rejected,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Ok(String),
    Failed(Failure),
}

/// `status` None = no hubo respuesta (sin conexión, DNS, timeout).
pub fn classify(status: Option<u16>, body: Option<&Value>) -> Outcome {
    let Some(status) = status else { return Outcome::Failed(Failure::Offline) };
    let err = body.and_then(|b| b.get("error")).and_then(Value::as_str).unwrap_or("");
    match status {
        401 => Outcome::Failed(Failure::SignedOut),
        429 => Outcome::Failed(Failure::RateLimited),
        413 => Outcome::Failed(Failure::TooLarge),
        _ if err == "audio_too_large" => Outcome::Failed(Failure::TooLarge),
        _ if err == "empty_audio" => Outcome::Failed(Failure::Empty),
        500..=599 => Outcome::Failed(Failure::Server),
        200..=299 => match body {
            None => Outcome::Failed(Failure::Server),
            Some(b) => {
                let text = b.get("text").and_then(Value::as_str).unwrap_or("").trim().to_string();
                if text.is_empty() {
                    Outcome::Failed(Failure::Empty)
                } else {
                    Outcome::Ok(text)
                }
            }
        },
        _ => Outcome::Failed(Failure::Rejected),
    }
}

/// Se guarda el audio para reintentar: el problema no era el audio.
pub fn keep_for_retry(f: Failure) -> bool {
    matches!(f, Failure::Offline | Failure::SignedOut | Failure::RateLimited | Failure::Server)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMeta {
    pub id: String,
    /// ms desde epoch.
    pub created_at: u64,
    pub mime: String,
    pub duration_ms: u64,
    pub source_app: String,
    pub context: String,
    pub failure: Failure,
    pub attempts: u32,
}

pub const PENDING_MAX: usize = 20;
pub const PENDING_MAX_AGE_MS: u64 = 7 * 86_400_000;

pub fn is_pending_id(v: &str) -> bool {
    (6..=40).contains(&v.len()) && v.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

pub fn new_pending_id(now_ms: u64, rand: u32) -> String {
    format!("{}{:06}", to_base36(now_ms), rand % 1_000_000)
}

fn to_base36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(D[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Los más nuevos primero; afuera los que pasan del tope o de la semana.
pub fn prune(mut list: Vec<PendingMeta>, now: u64) -> (Vec<PendingMeta>, Vec<PendingMeta>) {
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let mut keep = Vec::new();
    let mut drop = Vec::new();
    for m in list {
        if keep.len() < PENDING_MAX && now.saturating_sub(m.created_at) <= PENDING_MAX_AGE_MS {
            keep.push(m);
        } else {
            drop.push(m);
        }
    }
    (keep, drop)
}

/// Guardado en disco: <dir>/<id>.wav y <id>.json.
pub struct PendingStore {
    dir: PathBuf,
}

impl PendingStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn paths(&self, id: &str) -> (PathBuf, PathBuf) {
        (self.dir.join(format!("{id}.audio")), self.dir.join(format!("{id}.json")))
    }

    pub fn list(&self, now: u64) -> Vec<PendingMeta> {
        let Ok(rd) = fs::read_dir(&self.dir) else { return vec![] };
        let mut metas = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<PendingMeta>(&t).ok()) {
                Some(m) if is_pending_id(&m.id) && self.paths(&m.id).0.exists() => metas.push(m),
                _ => {
                    let _ = fs::remove_file(&p);
                }
            }
        }
        let (keep, drop) = prune(metas, now);
        for m in drop {
            self.remove(&m.id);
        }
        keep
    }

    pub fn save(&self, meta: &PendingMeta, audio: &[u8]) -> bool {
        if fs::create_dir_all(&self.dir).is_err() {
            return false;
        }
        let (a, j) = self.paths(&meta.id);
        write_private(&a, audio) && write_private(&j, &serde_json::to_vec(meta).unwrap_or_default())
    }

    pub fn read(&self, id: &str, now: u64) -> Option<(PendingMeta, Vec<u8>)> {
        if !is_pending_id(id) {
            return None;
        }
        let meta = self.list(now).into_iter().find(|m| m.id == id)?;
        let audio = fs::read(self.paths(id).0).ok()?;
        Some((meta, audio))
    }

    pub fn mark_attempt(&self, id: &str, failure: Failure, now: u64) {
        if let Some(mut m) = self.list(now).into_iter().find(|m| m.id == id) {
            m.failure = failure;
            m.attempts += 1;
            let _ = write_private(&self.paths(id).1, &serde_json::to_vec(&m).unwrap_or_default());
        }
    }

    pub fn remove(&self, id: &str) -> bool {
        if !is_pending_id(id) {
            return false;
        }
        let (a, j) = self.paths(id);
        let _ = fs::remove_file(a);
        let _ = fs::remove_file(j);
        true
    }
}

fn write_private(p: &Path, data: &[u8]) -> bool {
    if fs::write(p, data).is_err() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(p, fs::Permissions::from_mode(0o600));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn classifies_server_answers() {
        assert_eq!(classify(Some(201), Some(&json!({"text": "  hola  "}))), Outcome::Ok("hola".into()));
        assert_eq!(classify(None, None), Outcome::Failed(Failure::Offline));
        assert_eq!(classify(Some(401), None), Outcome::Failed(Failure::SignedOut));
        assert_eq!(classify(Some(429), None), Outcome::Failed(Failure::RateLimited));
        assert_eq!(classify(Some(413), None), Outcome::Failed(Failure::TooLarge));
        assert_eq!(classify(Some(400), Some(&json!({"error": "empty_audio"}))), Outcome::Failed(Failure::Empty));
        assert_eq!(classify(Some(502), Some(&json!({"error": "transcribe_failed"}))), Outcome::Failed(Failure::Server));
        assert_eq!(classify(Some(201), Some(&json!({"text": ""}))), Outcome::Failed(Failure::Empty));
        assert_eq!(classify(Some(200), None), Outcome::Failed(Failure::Server));
        assert_eq!(classify(Some(400), Some(&json!({"error": "audio_type"}))), Outcome::Failed(Failure::Rejected));
    }

    #[test]
    fn keeps_audio_only_when_audio_was_fine() {
        assert!([Failure::Offline, Failure::SignedOut, Failure::RateLimited, Failure::Server].iter().all(|f| keep_for_retry(*f)));
        assert!(![Failure::TooLarge, Failure::Empty, Failure::Rejected].iter().any(|f| keep_for_retry(*f)));
    }

    #[test]
    fn ids() {
        let id = new_pending_id(1_700_000_000_000, 42);
        assert!(is_pending_id(&id), "{id}");
        assert!(!is_pending_id("../etc/passwd"));
        assert!(!is_pending_id("AB"));
    }

    fn meta(id: &str, created_at: u64) -> PendingMeta {
        PendingMeta { id: id.into(), created_at, mime: "audio/wav".into(), duration_ms: 1000, source_app: String::new(), context: "other".into(), failure: Failure::Offline, attempts: 0 }
    }

    #[test]
    fn prune_keeps_newest_within_week() {
        let now = 10 * PENDING_MAX_AGE_MS;
        let mut list: Vec<PendingMeta> = (0..PENDING_MAX + 3).map(|i| meta(&format!("id{i:06}"), now - i as u64 * 1000)).collect();
        list.push(meta("old000", now - PENDING_MAX_AGE_MS - 1));
        let (keep, drop) = prune(list, now);
        assert_eq!(keep.len(), PENDING_MAX);
        assert_eq!(keep[0].id, "id000000");
        assert_eq!(drop.len(), 4);
        assert!(drop.iter().any(|m| m.id == "old000"));
    }

    #[test]
    fn store_roundtrip() {
        let dir = std::env::temp_dir().join(format!("zs-pending-{}", std::process::id()));
        let store = PendingStore::new(dir.clone());
        let now = 1_700_000_000_000;
        let m = meta(&new_pending_id(now, 7), now);
        assert!(store.save(&m, b"RIFFdata"));
        assert_eq!(store.list(now), vec![m.clone()]);
        assert_eq!(store.read(&m.id, now).map(|(_, a)| a), Some(b"RIFFdata".to_vec()));
        store.mark_attempt(&m.id, Failure::Server, now);
        assert_eq!(store.list(now)[0].attempts, 1);
        assert!(store.remove(&m.id));
        assert!(store.list(now).is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
