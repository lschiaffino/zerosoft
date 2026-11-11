//! Privacidad y datos (Ajustes › Privacidad y datos, y la página pública /download/privacy):
//!
//! - **Registro de actividad** local, acotado (500 eventos, 30 días) y sin contenido: cada evento
//!   es una estructura cerrada (`Event`) con un tipo, etiquetas de una lista fija, números, el host
//!   y, si la persona lo permite, el nombre de la app de adelante. No hay ningún campo de texto
//!   libre: ni audio, ni transcripciones, ni portapapeles, ni títulos.
//! - **Último uso** de cada permiso del sistema (cuándo y cuántas veces), sin contenido.
//! - **Inventario** de lo que la app guarda en esta computadora (rutas, tamaños) y su borrado.
//! - Los **hechos** que se muestran (desktop/privacy-facts.json) son los mismos de la página
//!   pública: un test compara sus ids con los de este archivo.
//!
//! Todo vive en <datos>/privacy/activity.json y no sale de la computadora.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub const MAX_EVENTS: usize = 500;
pub const MAX_AGE_MS: u64 = 30 * 86_400_000;
const MAX_APP: usize = 60;
const MAX_HOST: usize = 100;

/// "Borrar todos los datos locales" está en curso: nada se vuelve a escribir hasta reiniciar.
static WIPED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
thread_local! {
    /// En los tests cada uno corre en su hilo: el corte no se comparte entre tests.
    static TEST_WIPED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn wiped() -> bool {
    #[cfg(test)]
    return TEST_WIPED.with(|c| c.get());
    #[cfg(not(test))]
    WIPED.load(Ordering::Relaxed)
}

fn set_wiped(on: bool) {
    #[cfg(test)]
    TEST_WIPED.with(|c| c.set(on));
    WIPED.store(on, Ordering::Relaxed);
}

/// Qué pasó. Los nombres (snake_case) son los ids de `events` en privacy-facts.json.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// El dictado abrió el micrófono.
    MicStart,
    MicStop,
    /// Captura nativa del audio de la computadora (notas de reunión, Mac).
    SystemAudioStart,
    SystemAudioStop,
    /// La app le dio micrófono o cámara a la página de zerosoft de una pestaña.
    PageMedia,
    /// La página avisó que graba una reunión.
    MeetingStart,
    MeetingStop,
    /// La página avisó que Rec graba la pantalla.
    ScreenStart,
    ScreenStop,
    /// Audio de un dictado enviado a transcribir.
    AudioUpload,
    /// Texto puesto en el portapapeles y, con Accesibilidad, pegado.
    Paste,
    UpdateCheck,
    SignIn,
    SignOut,
    DataDeleted,
}

#[allow(dead_code)]
pub const KINDS: [Kind; 15] = [
    Kind::MicStart,
    Kind::MicStop,
    Kind::SystemAudioStart,
    Kind::SystemAudioStop,
    Kind::PageMedia,
    Kind::MeetingStart,
    Kind::MeetingStop,
    Kind::ScreenStart,
    Kind::ScreenStop,
    Kind::AudioUpload,
    Kind::Paste,
    Kind::UpdateCheck,
    Kind::SignIn,
    Kind::SignOut,
    Kind::DataDeleted,
];

/// Detalle de un evento: siempre una palabra de esta lista (ids de `tags` en privacy-facts.json).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tag {
    Shortcut,
    Menu,
    Settings,
    Page,
    Idle,
    User,
    Dictation,
    PasteLast,
    History,
    Retry,
    Auto,
    Manual,
    Browser,
    Ok,
    Failed,
    Saved,
    Cancelled,
    Pasted,
    Copied,
    Update,
    Microphone,
    Camera,
    Pending,
    WebData,
}

#[allow(dead_code)]
pub const TAGS: [Tag; 24] = [
    Tag::Shortcut,
    Tag::Menu,
    Tag::Settings,
    Tag::Page,
    Tag::Idle,
    Tag::User,
    Tag::Dictation,
    Tag::PasteLast,
    Tag::History,
    Tag::Retry,
    Tag::Auto,
    Tag::Manual,
    Tag::Browser,
    Tag::Ok,
    Tag::Failed,
    Tag::Saved,
    Tag::Cancelled,
    Tag::Pasted,
    Tag::Copied,
    Tag::Update,
    Tag::Microphone,
    Tag::Camera,
    Tag::Pending,
    Tag::WebData,
];

/// Un evento del registro. Estos son todos los campos que se guardan (`deny_unknown_fields`: una
/// línea con cualquier otro campo se descarta al leer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    /// ms desde epoch.
    pub at: u64,
    pub kind: Kind,
    /// Qué lo disparó.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<Tag>,
    /// Cómo terminó, o de qué se trata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Tag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
    /// Host al que se mandó algo (sin ruta ni query).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// Nombre de la app de adelante, solo si "Mandar el nombre de la app" está prendido.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
}

#[allow(dead_code)]
pub const EVENT_FIELDS: [&str; 8] = ["at", "kind", "trigger", "result", "durationMs", "bytes", "host", "app"];

impl Event {
    pub fn new(kind: Kind) -> Self {
        Event { at: crate::state::now_ms(), kind, trigger: None, result: None, duration_ms: None, bytes: None, host: None, app: None }
    }
    pub fn trigger(mut self, t: Tag) -> Self {
        self.trigger = Some(t);
        self
    }
    pub fn result(mut self, t: Tag) -> Self {
        self.result = Some(t);
        self
    }
    pub fn duration(mut self, ms: u64) -> Self {
        self.duration_ms = Some(ms);
        self
    }
    pub fn bytes(mut self, n: u64) -> Self {
        self.bytes = Some(n);
        self
    }
    /// Solo el host de una URL del servidor.
    pub fn host_of(mut self, server: &str) -> Self {
        self.host = url::Url::parse(server).ok().and_then(|u| u.host_str().map(|h| match u.port() {
            Some(p) => format!("{h}:{p}"),
            None => h.to_string(),
        }));
        self
    }
    pub fn app(mut self, name: &str) -> Self {
        if !name.is_empty() {
            self.app = Some(name.to_string());
        }
        self
    }

    /// Deja los dos campos de texto en lo que dicen ser: un host y un nombre corto de app.
    pub fn clean(mut self) -> Self {
        self.host = self.host.map(|h| clean_host(&h)).filter(|h| !h.is_empty());
        self.app = self.app.map(|a| clean_app(&a)).filter(|a| !a.is_empty());
        self
    }
}

/// Un host: letras, números, punto, guion y dos puntos (puerto). Corta en lo primero que no lo sea.
pub fn clean_host(h: &str) -> String {
    h.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':')).take(MAX_HOST).collect::<String>().to_ascii_lowercase()
}

/// Un nombre de app: una línea corta, sin caracteres de control.
pub fn clean_app(a: &str) -> String {
    a.lines().next().unwrap_or("").chars().filter(|c| !c.is_control()).take(MAX_APP).collect::<String>().trim().to_string()
}

/// Cuándo se usó por última vez un permiso del sistema y cuántas veces.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Usage {
    pub last: u64,
    pub count: u64,
}

/// Permisos con "último uso" (ids de `permissions` en privacy-facts.json).
pub const CAPABILITIES: [&str; 5] = ["microphone", "accessibility", "screen", "camera", "clipboard"];

/// Qué permisos usa un evento.
pub fn capabilities_of(e: &Event) -> Vec<&'static str> {
    match (e.kind, e.result) {
        (Kind::MicStart, _) => vec!["microphone"],
        (Kind::SystemAudioStart, _) => vec!["screen"],
        (Kind::PageMedia, Some(Tag::Camera)) => vec!["camera"],
        (Kind::PageMedia, _) => vec!["microphone"],
        (Kind::Paste, Some(Tag::Pasted)) => vec!["clipboard", "accessibility"],
        (Kind::Paste, _) => vec!["clipboard"],
        _ => vec![],
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Data {
    pub usage: BTreeMap<String, Usage>,
    pub events: Vec<Event>,
}

/// Afuera lo viejo y lo que pasa del tope (quedan los más nuevos, en orden de llegada).
pub fn prune(events: &mut Vec<Event>, now: u64) {
    events.retain(|e| now.saturating_sub(e.at) <= MAX_AGE_MS);
    let over = events.len().saturating_sub(MAX_EVENTS);
    if over > 0 {
        events.drain(..over);
    }
}

/// Lo que haya en el archivo → datos válidos. Lo que no sea un `Event` exacto se descarta.
pub fn parse(raw: &Value, now: u64) -> Data {
    let mut events: Vec<Event> = raw
        .get("events")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| serde_json::from_value::<Event>(v.clone()).ok()).map(Event::clean).collect())
        .unwrap_or_default();
    prune(&mut events, now);
    let usage = raw
        .get("usage")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter(|(k, _)| CAPABILITIES.contains(&k.as_str())).filter_map(|(k, v)| Some((k.clone(), serde_json::from_value::<Usage>(v.clone()).ok()?))).collect())
        .unwrap_or_default();
    Data { usage, events }
}

pub fn to_json(d: &Data) -> Value {
    serde_json::json!({ "version": 1, "usage": d.usage, "events": d.events })
}

pub struct Log {
    path: PathBuf,
    data: Mutex<Data>,
}

impl Log {
    pub fn open(dir: &Path) -> Self {
        let path = dir.join("activity.json");
        let raw = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).unwrap_or(Value::Null);
        Log { path, data: Mutex::new(parse(&raw, crate::state::now_ms())) }
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn persist(&self, d: &Data) {
        if wiped() {
            return;
        }
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let tmp = self.path.with_extension("json.tmp");
        if write_private(&tmp, &serde_json::to_vec(&to_json(d)).unwrap_or_default()) {
            let _ = fs::rename(tmp, &self.path);
        }
    }

    pub fn record(&self, e: Event) {
        let e = e.clean();
        let mut d = self.data.lock().unwrap();
        // Dos avisos iguales seguidos (la página pide la cámara dos veces): uno solo.
        if d.events.last().is_some_and(|l| l.kind == e.kind && l.result == e.result && l.trigger == e.trigger && e.at.saturating_sub(l.at) < 2000 && e.kind == Kind::PageMedia) {
            return;
        }
        for cap in capabilities_of(&e) {
            let u = d.usage.entry(cap.to_string()).or_default();
            u.last = e.at;
            u.count += 1;
        }
        let now = e.at;
        d.events.push(e);
        prune(&mut d.events, now);
        self.persist(&d);
    }

    pub fn snapshot(&self) -> Data {
        let mut d = self.data.lock().unwrap();
        prune(&mut d.events, crate::state::now_ms());
        d.clone()
    }

    /// Vacía el registro y los últimos usos, y borra el archivo. Vuelve a existir con el próximo
    /// evento (solo con lo nuevo).
    pub fn clear(&self) {
        let mut d = self.data.lock().unwrap();
        *d = Data::default();
        let _ = fs::remove_file(&self.path);
    }
}

pub(crate) fn write_private(p: &Path, data: &[u8]) -> bool {
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

/// Anota un evento (desde cualquier hilo).
pub fn record(app: &AppHandle, e: Event) {
    if let Some(st) = app.try_state::<AppState>() {
        st.privacy.record(e);
    }
    crate::commands::refresh_privacy(app);
}

// ---------- Inventario de lo guardado en esta computadora ----------

/// Carpetas de la app en este sistema.
#[derive(Debug, Clone)]
pub struct Paths {
    pub config: PathBuf,
    pub data: PathBuf,
    pub cache: PathBuf,
    pub local_data: PathBuf,
    pub home: PathBuf,
    pub identifier: String,
    pub mac: bool,
}

impl Paths {
    pub fn of(app: &AppHandle) -> Option<Paths> {
        let p = app.path();
        Some(Paths {
            config: p.app_config_dir().ok()?,
            data: p.app_data_dir().ok()?,
            cache: p.app_cache_dir().ok()?,
            local_data: p.app_local_data_dir().ok()?,
            home: p.home_dir().ok()?,
            identifier: app.config().identifier.clone(),
            mac: cfg!(target_os = "macos"),
        })
    }

    /// Dónde está cada cosa. None = no existe en este sistema (o no es un archivo: `autostart`).
    pub fn of_store(&self, id: &str) -> Option<PathBuf> {
        let lib = self.home.join("Library");
        match id {
            "settings" => Some(self.config.join("settings.json")),
            "session" => Some(self.config.join("session.json")),
            "window_state" => Some(self.config.join(".window-state.json")),
            "pending" => Some(self.data.join("pending")),
            "activity" => Some(self.data.join("privacy")),
            // WKWebView guarda con el identificador de la app; WebView2, en EBWebView.
            "web_data" => Some(if self.mac { lib.join("WebKit").join(&self.identifier) } else { self.local_data.join("EBWebView") }),
            "web_cookies" if self.mac => Some(lib.join("HTTPStorages").join(format!("{}.binarycookies", self.identifier))),
            "web_cache" if self.mac => Some(self.cache.clone()),
            _ => None,
        }
    }
}

/// Ids de `stores` en privacy-facts.json, en el orden en que se muestran.
pub const STORE_IDS: [&str; 9] = ["settings", "session", "window_state", "pending", "activity", "web_data", "web_cookies", "web_cache", "autostart"];

/// Lo que se puede borrar por separado desde Ajustes (lo demás, con "Borrar todo").
pub const DELETABLE: [&str; 3] = ["pending", "activity", "web_data"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub id: &'static str,
    /// "" = no es un archivo (abrir al iniciar sesión) o no existe en este sistema.
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
    pub files: u64,
    pub deletable: bool,
}

/// Tamaño y cantidad de archivos de un archivo o carpeta (sin seguir enlaces).
pub fn measure(p: &Path) -> (u64, u64) {
    let Ok(meta) = fs::symlink_metadata(p) else { return (0, 0) };
    if meta.is_file() {
        return (meta.len(), 1);
    }
    if !meta.is_dir() {
        return (0, 0);
    }
    let mut total = (0u64, 0u64);
    let mut stack = vec![p.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let Ok(m) = fs::symlink_metadata(e.path()) else { continue };
            if m.is_dir() {
                stack.push(e.path());
            } else if m.is_file() {
                total.0 += m.len();
                total.1 += 1;
            }
        }
    }
    total
}

pub fn stores(paths: &Paths, autostart: bool) -> Vec<Store> {
    STORE_IDS
        .iter()
        .filter_map(|id| {
            if *id == "autostart" {
                return Some(Store { id, path: String::new(), exists: autostart, bytes: 0, files: 0, deletable: false });
            }
            let p = paths.of_store(id)?;
            let (bytes, files) = measure(&p);
            Some(Store { id, path: p.to_string_lossy().into_owned(), exists: p.exists(), bytes, files, deletable: DELETABLE.contains(id) })
        })
        .collect()
}

/// Borra los dictados sin enviar (audio y metadatos). La carpeta vuelve a crearse solo si otro
/// dictado falla.
pub fn delete_pending(paths: &Paths) -> bool {
    let Some(dir) = paths.of_store("pending") else { return false };
    !dir.exists() || fs::remove_dir_all(dir).is_ok()
}

/// "Borrar todos los datos locales": los archivos propios de la app. Los datos del sitio (cookies,
/// almacenamiento y caché del webview) los borra el webview (commands.rs). Desde acá nada se
/// vuelve a escribir (WIPED) hasta que la app reinicia.
pub fn wipe_files(paths: &Paths) -> bool {
    set_wiped(true);
    let mut ok = delete_pending(paths);
    if let Some(dir) = paths.of_store("activity") {
        ok &= !dir.exists() || fs::remove_dir_all(dir).is_ok();
    }
    for id in ["settings", "session", "window_state"] {
        if let Some(f) = paths.of_store(id) {
            ok &= !f.exists() || fs::remove_file(&f).is_ok();
            let _ = fs::remove_file(f.with_extension("json.tmp"));
        }
    }
    ok
}

// ---------- Hechos (desktop/privacy-facts.json) ----------

pub fn facts() -> &'static Value {
    static FACTS: OnceLock<Value> = OnceLock::new();
    FACTS.get_or_init(|| serde_json::from_str(include_str!("../../privacy-facts.json")).unwrap_or(Value::Null))
}

/// La página pública con estos mismos hechos (en el servidor configurado).
pub const DOCS_PATH: &str = "/download/privacy";

/// Base de los links al código (el repositorio público).
pub fn repo() -> String {
    facts().get("repo").and_then(Value::as_str).unwrap_or("https://github.com/lschiaffino/zerosoft/blob/main/").to_string()
}

/// Un archivo del repositorio que los hechos nombran como fuente (lo único que "ver el código" abre).
pub fn is_source(file: &str) -> bool {
    let f = facts();
    ["permissions", "stores", "network", "never", "indicators", "events", "controls", "security", "open"].iter().any(|section| {
        f.get(*section).and_then(Value::as_array).is_some_and(|items| items.iter().any(|i| i.get("code").and_then(Value::as_array).is_some_and(|c| c.iter().any(|x| x.as_str() == Some(file)))))
    })
}

/// Qué muestra el indicador de la barra de menú mientras algo captura (tray.rs). `None` = nada.
/// Es nativo: la página no lo puede apagar y no hay ajuste que lo esconda.
pub fn capture_marker(dictating: bool, system_audio: bool, meeting: bool, screen: bool) -> Option<&'static str> {
    if dictating {
        Some("trayMic")
    } else if system_audio {
        Some("traySystemAudio")
    } else if screen {
        Some("trayScreen")
    } else if meeting {
        Some("trayMeeting")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("zs-privacy-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn paths(root: &Path, mac: bool) -> Paths {
        Paths { config: root.join("config"), data: root.join("data"), cache: root.join("cache"), local_data: root.join("local"), home: root.join("home"), identifier: "ai.zerosoft.desktop".into(), mac }
    }

    #[test]
    fn events_keep_only_whitelisted_fields() {
        let dir = tmp("fields");
        let log = Log::open(&dir);
        let dictated = "the quarterly numbers are confidential";
        // Un evento con "contenido" metido donde se pueda: el host con ruta y token, la app con
        // varias líneas de texto.
        let mut e = Event::new(Kind::AudioUpload).trigger(Tag::Dictation).result(Tag::Ok).duration(1200).bytes(38_444);
        e.host = Some("zerosoft.ai/api/voice/dictate?token=abc123".into());
        e.app = Some(format!("Slack\n{dictated} {}", "x".repeat(300)));
        log.record(e);
        let text = fs::read_to_string(log.path()).unwrap();
        assert!(!text.contains(dictated) && !text.contains("abc123") && !text.contains("/api/"), "{text}");
        let saved: Value = serde_json::from_str(&text).unwrap();
        let ev = saved["events"][0].as_object().unwrap();
        assert!(ev.keys().all(|k| EVENT_FIELDS.contains(&k.as_str())), "{ev:?}");
        assert_eq!(ev["host"], "zerosoft.ai");
        assert_eq!(ev["app"], "Slack");
        let mut top: Vec<&String> = saved.as_object().unwrap().keys().collect();
        top.sort();
        assert_eq!(top, ["events", "usage", "version"]);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_tampered_file_loses_everything_that_is_not_an_event() {
        let now = 1_800_000_000_000;
        let raw = json!({
            "usage": { "microphone": { "last": 5, "count": 2 }, "notes": { "last": 1, "count": 1 }, "camera": { "last": 1, "count": 1, "text": "x" } },
            "transcript": "secret words",
            "events": [
                { "at": now, "kind": "paste", "result": "pasted" },
                { "at": now, "kind": "paste", "result": "pasted", "text": "secret words" },
                { "at": now, "kind": "paste", "result": "whatever" },
                { "at": now, "kind": "keystroke" },
                { "at": now, "kind": "audio_upload", "app": "Notes\nsecret words", "host": "a.b/c?d=e" },
                "secret words"
            ]
        });
        let d = parse(&raw, now);
        assert_eq!(d.events.len(), 2);
        assert_eq!(d.events[1].app.as_deref(), Some("Notes"));
        assert_eq!(d.events[1].host.as_deref(), Some("a.b"));
        assert_eq!(d.usage.keys().collect::<Vec<_>>(), ["microphone"]);
        assert!(!to_json(&d).to_string().contains("secret"));
    }

    #[test]
    fn bounded_by_count_and_age() {
        let now = 1_800_000_000_000;
        let mut events: Vec<Event> = (0..MAX_EVENTS as u64 + 40).map(|i| Event { at: now - 1000 + i, ..Event::new(Kind::MicStart) }).collect();
        events.insert(0, Event { at: now - MAX_AGE_MS - 1, ..Event::new(Kind::SignIn) });
        prune(&mut events, now + 1000);
        assert_eq!(events.len(), MAX_EVENTS);
        assert!(events.iter().all(|e| e.kind == Kind::MicStart));
        // Quedan los más nuevos.
        assert_eq!(events.last().unwrap().at, now - 1000 + MAX_EVENTS as u64 + 39);
        let dir = tmp("bounded");
        let log = Log::open(&dir);
        for _ in 0..MAX_EVENTS + 25 {
            log.record(Event::new(Kind::Paste).result(Tag::Copied));
        }
        assert_eq!(log.snapshot().events.len(), MAX_EVENTS);
        assert_eq!(Log::open(&dir).snapshot().events.len(), MAX_EVENTS);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn usage_counts_each_permission() {
        let dir = tmp("usage");
        let log = Log::open(&dir);
        log.record(Event::new(Kind::MicStart).trigger(Tag::Shortcut));
        log.record(Event::new(Kind::Paste).result(Tag::Pasted));
        log.record(Event::new(Kind::Paste).result(Tag::Copied));
        log.record(Event::new(Kind::SystemAudioStart));
        log.record(Event::new(Kind::PageMedia).result(Tag::Camera));
        log.record(Event::new(Kind::UpdateCheck));
        let u = log.snapshot().usage;
        assert_eq!(u["microphone"].count, 1);
        assert_eq!(u["clipboard"].count, 2);
        assert_eq!(u["accessibility"].count, 1);
        assert_eq!(u["screen"].count, 1);
        assert_eq!(u["camera"].count, 1);
        assert!(u.keys().all(|k| CAPABILITIES.contains(&k.as_str())));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn clear_removes_the_file_and_it_comes_back_only_with_new_events() {
        let dir = tmp("clear");
        let log = Log::open(&dir);
        log.record(Event::new(Kind::SignIn).trigger(Tag::Browser));
        assert!(log.path().exists());
        log.clear();
        assert!(!log.path().exists());
        assert!(log.snapshot().events.is_empty() && log.snapshot().usage.is_empty());
        assert!(Log::open(&dir).snapshot().events.is_empty());
        log.record(Event::new(Kind::SignOut).trigger(Tag::Settings));
        let back = Log::open(&dir).snapshot();
        assert_eq!(back.events.len(), 1);
        assert_eq!(back.events[0].kind, Kind::SignOut);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn inventory_lists_sizes_and_deletes() {
        let root = tmp("stores");
        let p = paths(&root, true);
        fs::create_dir_all(p.data.join("pending")).unwrap();
        fs::create_dir_all(&p.config).unwrap();
        fs::write(p.data.join("pending/a1b2c3.audio"), vec![0u8; 3000]).unwrap();
        fs::write(p.data.join("pending/a1b2c3.json"), b"{}").unwrap();
        fs::write(p.config.join("settings.json"), b"{\"mode\":\"both\"}").unwrap();
        fs::write(p.config.join("session.json"), b"{}").unwrap();
        fs::write(p.config.join(".window-state.json"), b"{}").unwrap();
        let list = stores(&p, false);
        assert_eq!(list.iter().map(|s| s.id).collect::<Vec<_>>(), STORE_IDS);
        let by = |id: &str| list.iter().find(|s| s.id == id).unwrap().clone();
        assert_eq!((by("pending").bytes, by("pending").files, by("pending").deletable), (3002, 2, true));
        assert!(by("settings").exists && !by("settings").deletable);
        assert!(!by("web_data").exists && by("web_data").path.ends_with("Library/WebKit/ai.zerosoft.desktop"));
        assert!(by("web_cookies").path.ends_with("HTTPStorages/ai.zerosoft.desktop.binarycookies"));
        assert_eq!((by("autostart").path.as_str(), by("autostart").exists), ("", false));
        // Windows: cookies y caché van dentro de la carpeta de WebView2.
        let win: Vec<&str> = stores(&paths(&root, false), true).iter().map(|s| s.id).collect();
        assert_eq!(win, ["settings", "session", "window_state", "pending", "activity", "web_data", "autostart"]);

        assert!(delete_pending(&p));
        assert!(!p.data.join("pending").exists());
        assert!(delete_pending(&p), "borrar lo que no está también es ok");
        assert_eq!(stores(&p, false).iter().find(|s| s.id == "pending").unwrap().bytes, 0);

        // Borrar todo: nada propio queda y nada se vuelve a escribir.
        let log = Log::open(&p.data.join("privacy"));
        log.record(Event::new(Kind::MicStart));
        assert!(wipe_files(&p));
        for id in ["settings", "session", "window_state", "pending", "activity"] {
            assert!(!p.of_store(id).unwrap().exists(), "{id}");
        }
        log.record(Event::new(Kind::MicStop));
        assert!(!log.path().exists(), "después de borrar todo no se escribe nada");
        assert!(crate::config::save(&p.config, &crate::config::normalize(&Value::Null, "macos", crate::config::DEFAULT_SERVER.into())).is_ok());
        assert!(!p.config.join("settings.json").exists());
        set_wiped(false);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hosts_and_app_names() {
        assert_eq!(clean_host("Zerosoft.AI"), "zerosoft.ai");
        assert_eq!(clean_host("localhost:3000/app?x=1"), "localhost:3000");
        assert_eq!(clean_host("user@evil.com"), "user");
        assert_eq!(clean_app("  Google Chrome \u{7}"), "Google Chrome");
        assert_eq!(clean_app(&"a".repeat(500)).len(), MAX_APP);
        assert_eq!(Event::new(Kind::AudioUpload).host_of("https://zerosoft.ai").host.as_deref(), Some("zerosoft.ai"));
        assert_eq!(Event::new(Kind::AudioUpload).host_of("http://localhost:3000").host.as_deref(), Some("localhost:3000"));
        assert_eq!(Event::new(Kind::AudioUpload).app("").app, None);
    }

    #[test]
    fn marker_is_on_whenever_something_captures() {
        assert_eq!(capture_marker(false, false, false, false), None);
        assert_eq!(capture_marker(true, true, true, true), Some("trayMic"));
        assert_eq!(capture_marker(false, true, false, false), Some("traySystemAudio"));
        assert_eq!(capture_marker(false, false, false, true), Some("trayScreen"));
        assert_eq!(capture_marker(false, false, true, false), Some("trayMeeting"));
    }

    fn ids(v: &Value, key: &str) -> Vec<String> {
        v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.get("id").and_then(Value::as_str).map(String::from)).collect()).unwrap_or_default()
    }

    fn snake<T: Serialize>(v: &T) -> String {
        serde_json::to_value(v).unwrap().as_str().unwrap().to_string()
    }

    /// Los hechos que se muestran (Ajustes y la página pública) nombran exactamente lo que este
    /// archivo hace: si se agrega un evento, un dato guardado o un permiso, hay que explicarlo.
    #[test]
    fn facts_match_the_code() {
        let f = facts();
        assert_eq!(ids(f, "stores"), STORE_IDS);
        assert_eq!(ids(f, "events"), KINDS.iter().map(snake).collect::<Vec<_>>());
        let mut tags: Vec<String> = f["tags"].as_object().unwrap().keys().cloned().collect();
        tags.sort();
        let mut mine: Vec<String> = TAGS.iter().map(snake).collect();
        mine.sort();
        assert_eq!(tags, mine);
        for cap in CAPABILITIES {
            assert!(ids(f, "permissions").iter().any(|p| p == cap), "{cap}");
        }
        for d in DELETABLE {
            let s = f["stores"].as_array().unwrap().iter().find(|s| s["id"] == d).unwrap();
            assert_eq!(s["delete"], true, "{d}");
        }
        assert_eq!(f["path"], DOCS_PATH);
        assert!(is_source("desktop/src-tauri/src/privacy.rs") && !is_source("../../etc/passwd") && !is_source(""));
        // Cada archivo que se nombra como fuente existe en el repositorio.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for section in ["permissions", "stores", "network", "never", "indicators", "events", "controls", "security", "open"] {
            for item in f[section].as_array().unwrap() {
                for c in item["code"].as_array().unwrap() {
                    assert!(root.join(c.as_str().unwrap()).is_file(), "{section} {}: {c}", item["id"]);
                }
            }
        }
        // Cada texto está en los tres idiomas.
        for section in ["permissions", "stores", "network", "never", "indicators", "events", "controls", "security", "open"] {
            for item in f[section].as_array().unwrap() {
                for l in ["en", "es", "pt"] {
                    assert!(item.get(l).is_some(), "{section} {} {l}", item["id"]);
                }
            }
        }
        // Lo que dicen los hechos sobre el registro es lo que hace.
        assert_eq!(f["limits"]["activityEvents"], MAX_EVENTS);
        assert_eq!(f["limits"]["activityDays"], MAX_AGE_MS / 86_400_000);
        assert_eq!(f["limits"]["pendingMax"], crate::retry::PENDING_MAX);
        assert_eq!(f["limits"]["pendingDays"], crate::retry::PENDING_MAX_AGE_MS / 86_400_000);
        assert_eq!(f["limits"]["systemAudioIdleSeconds"], crate::system_audio::IDLE_STOP_MS / 1000);
        assert_eq!(f["limits"]["badgeSeconds"], crate::badge::POLL_SECS);
        assert_eq!(f["limits"]["updateHours"], crate::updater::CHECK_EVERY_SECS / 3600);
        assert_eq!(f["limits"]["dictationMaxSeconds"], crate::dictation::MAX_MS / 1000);
        assert_eq!(f["limits"]["clipboardRestoreMs"], crate::clipboard::SETTLE.as_millis() as u64);
    }
}
