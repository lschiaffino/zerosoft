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
    All,
    /// Lo que dejaron versiones anteriores (instaladores, la app de Electron).
    Old,
    WebData,
}

#[allow(dead_code)]
pub const TAGS: [Tag; 26] = [
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
    Tag::All,
    Tag::Old,
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
        (Kind::SystemAudioStart, _) | (Kind::ScreenStart, _) => vec!["screen"],
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

/// Escribe un archivo que solo lee tu usuario: en Mac nace con modo 600 (sin un instante con
/// permisos más abiertos) y, si ya existía con otros, se corrigen. En Windows hereda los permisos de
/// la carpeta del perfil.
pub(crate) fn write_private(p: &Path, data: &[u8]) -> bool {
    use std::io::Write;
    let mut o = fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let Ok(mut f) = o.open(p) else { return false };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if f.set_permissions(fs::Permissions::from_mode(0o600)).is_err() {
            return false;
        }
    }
    f.write_all(data).is_ok() && f.sync_all().is_ok()
}

/// Anota un evento (desde cualquier hilo).
pub fn record(app: &AppHandle, e: Event) {
    if let Some(st) = app.try_state::<AppState>() {
        st.privacy.record(e);
    }
    crate::commands::refresh_privacy(app);
}

// ---------- Inventario de lo guardado en esta computadora ----------

/// Identificador de la app (tauri.conf.json): nombre de sus carpetas. Un test lo compara.
pub const IDENTIFIER: &str = "ai.zerosoft.desktop";
/// La app de Electron (0.1.0 a 0.1.2) guardaba en <carpeta de datos>/zerosoft, su caché del
/// updater en zerosoft-desktop-updater, y su clave de safeStorage en el llavero.
pub const ELECTRON_FOLDER: &str = "zerosoft";
pub const ELECTRON_UPDATER_FOLDER: &str = "zerosoft-desktop-updater";
pub const ELECTRON_KEYCHAIN_SERVICE: &str = "zerosoft Safe Storage";
pub const ELECTRON_KEYCHAIN_ACCOUNT: &str = "zerosoft Key";
/// Lo que deja Electron (Chromium) en su carpeta de datos: sin alguno de estos, una carpeta
/// "zerosoft" no es la nuestra (puede ser de otra app con el mismo nombre).
const ELECTRON_PROFILE_MARKERS: [&str; 5] = ["session.bin", "Local State", "Preferences", "Partitions", "SingletonLock"];
/// Lo que deja electron-updater en su caché.
const ELECTRON_UPDATER_MARKERS: [&str; 3] = ["pending", "update-info.json", "installer.exe"];

/// Carpetas de la app en este sistema.
#[derive(Debug, Clone)]
pub struct Paths {
    /// Roaming en Windows (%APPDATA%): settings.json y el plugin de la ventana (y, de versiones
    /// anteriores, sesión, dictados y registro).
    pub config: PathBuf,
    /// Local (%LOCALAPPDATA% en Windows): sesión, dictados, registro y el webview.
    pub local_data: PathBuf,
    pub cache: PathBuf,
    pub home: PathBuf,
    pub temp: PathBuf,
    pub identifier: String,
    pub mac: bool,
}

/// Una carpeta real (no un enlace) cuyo nombre en su carpeta es exactamente `name` (en un disco
/// que no distingue mayúsculas, "ZeroSoft" de otra app no cuenta) y que tiene alguna de `markers`.
/// Las marcas se miran sin seguir enlaces: SingletonLock de Chromium es un enlace roto.
pub fn owned_folder(dir: &Path, name: &str, markers: &[&str]) -> bool {
    let real_dir = fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir());
    let exact = dir.parent().and_then(|p| fs::read_dir(p).ok()).is_some_and(|rd| rd.flatten().any(|e| e.file_name() == name));
    real_dir && exact && markers.iter().any(|m| fs::symlink_metadata(dir.join(m)).is_ok())
}

impl Paths {
    pub fn of(app: &AppHandle) -> Option<Paths> {
        let p = app.path();
        Some(Paths {
            config: p.app_config_dir().ok()?,
            local_data: p.app_local_data_dir().ok()?,
            cache: p.app_cache_dir().ok()?,
            home: p.home_dir().ok()?,
            temp: std::env::temp_dir(),
            identifier: app.config().identifier.clone(),
            mac: cfg!(target_os = "macos"),
        })
    }

    /// El archivo que pide terminar "borrar todo" en el próximo arranque.
    pub fn wipe_marker(&self) -> PathBuf {
        self.local_data.join(".wipe-pending")
    }

    /// La misma cosa en la carpeta de configuración, donde la dejaban versiones anteriores (solo
    /// donde config y local son carpetas distintas: Windows).
    fn legacy(&self, name: &str) -> Option<PathBuf> {
        (self.config != self.local_data).then(|| self.config.join(name))
    }

    /// La carpeta de la app de Electron, si de verdad es suya.
    pub fn electron_profile(&self) -> Option<PathBuf> {
        let dir = self.config.parent()?.join(ELECTRON_FOLDER);
        owned_folder(&dir, ELECTRON_FOLDER, &ELECTRON_PROFILE_MARKERS).then_some(dir)
    }

    /// Su caché del updater (Mac: ~/Library/Caches; Windows: %LOCALAPPDATA%), si de verdad es suya.
    pub fn electron_updater_cache(&self) -> Option<PathBuf> {
        let base = if self.mac { self.cache.parent()? } else { self.local_data.parent()? };
        let dir = base.join(ELECTRON_UPDATER_FOLDER);
        owned_folder(&dir, ELECTRON_UPDATER_FOLDER, &ELECTRON_UPDATER_MARKERS).then_some(dir)
    }

    /// Dónde está cada cosa (vacío = no existe en este sistema, o no es un archivo).
    pub fn paths_of(&self, id: &str) -> Vec<PathBuf> {
        let lib = self.home.join("Library");
        let one = |p: PathBuf| vec![p];
        let with_legacy = |name: &str| std::iter::once(self.local_data.join(name)).chain(self.legacy(name)).collect::<Vec<_>>();
        match id {
            "settings" => one(self.config.join("settings.json")),
            "session" => with_legacy("session.json"),
            "window_state" => one(self.config.join(".window-state.json")),
            "pending" => with_legacy("pending"),
            "activity" => with_legacy("privacy"),
            // WKWebView guarda con el identificador de la app; WebView2, en EBWebView.
            "web_data" => one(if self.mac { lib.join("WebKit").join(&self.identifier) } else { self.local_data.join("EBWebView") }),
            "web_cookies" if self.mac => one(lib.join("HTTPStorages").join(format!("{}.binarycookies", self.identifier))),
            "web_cache" if self.mac => one(self.cache.clone()),
            "os_prefs" if self.mac => one(lib.join("Preferences").join(format!("{}.plist", self.identifier))),
            // Windows: el instalador de cada actualización queda en una carpeta temporal.
            "update_temp" if !self.mac => fs::read_dir(&self.temp)
                .map(|rd| rd.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_update_temp)).collect())
                .unwrap_or_default(),
            "electron_data" => self.electron_profile().into_iter().chain(self.electron_updater_cache()).collect(),
            _ => vec![],
        }
    }

    /// Lo que se muestra como ruta de un dato.
    pub fn shown_path(&self, id: &str) -> Option<PathBuf> {
        match id {
            "update_temp" if !self.mac => Some(self.temp.clone()),
            "electron_data" => Some(self.paths_of(id).into_iter().next().unwrap_or_else(|| self.config.parent().unwrap_or(&self.config).join(ELECTRON_FOLDER))),
            _ => self.paths_of(id).into_iter().next(),
        }
    }
}

/// Carpeta temporal de un instalador de la app: exactamente "zerosoft-<versión>-updater-<letras>"
/// (tauri-plugin-updater), con una versión X.Y.Z (y un sufijo -beta.1 si lo hay).
pub fn is_update_temp(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("zerosoft-") else { return false };
    let Some((version, suffix)) = rest.split_once("-updater-") else { return false };
    let (core, pre) = version.split_once('-').unwrap_or((version, ""));
    let nums: Vec<&str> = core.split('.').collect();
    nums.len() == 3
        && nums.iter().all(|n| !n.is_empty() && n.len() <= 5 && n.bytes().all(|b| b.is_ascii_digit()))
        && pre.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
        && !suffix.is_empty()
        && suffix.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Ids de `stores` en privacy-facts.json, en el orden en que se muestran.
pub const STORE_IDS: [&str; 14] = [
    "settings",
    "session",
    "window_state",
    "pending",
    "activity",
    "web_data",
    "web_cookies",
    "web_cache",
    "os_prefs",
    "update_temp",
    "electron_data",
    "electron_keychain",
    "link_handler",
    "autostart",
];

/// Dónde registra Windows el esquema zerosoft:// (tauri-plugin-deep-link, register_all en lib.rs).
pub const LINK_HANDLER_KEY: &str = "HKEY_CURRENT_USER\\Software\\Classes\\zerosoft";

/// Lo que se puede borrar por separado desde Ajustes (lo demás, con "Borrar todo").
pub const DELETABLE: [&str; 6] = ["pending", "activity", "web_data", "update_temp", "electron_data", "electron_keychain"];

/// Lo que "Borrar todo" borra (además del ítem de inicio). `os_prefs` es del sistema.
pub const WIPED_BY_DELETE_ALL: [&str; 12] = ["settings", "session", "window_state", "pending", "activity", "web_data", "web_cookies", "web_cache", "update_temp", "electron_data", "electron_keychain", "autostart"];

/// Lo propio de la app: si no se puede borrar, "borrar todo" no sigue.
const OWN: [&str; 5] = ["settings", "session", "window_state", "pending", "activity"];
/// Lo que dejaron versiones anteriores, y el ítem de inicio: se intenta, y lo que quede se informa
/// sin frenar el resto.
const LEFTOVERS: [&str; 4] = ["update_temp", "electron_data", "electron_keychain", "autostart"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub id: &'static str,
    /// "" = no es un archivo (abrir al iniciar sesión, el llavero).
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

/// El inventario. `autostart`: si existe el ítem de inicio; `keychain`: si existe la clave de la
/// app de Electron y es de ella (platform.rs).
pub fn stores(paths: &Paths, autostart: bool, keychain: bool) -> Vec<Store> {
    STORE_IDS
        .iter()
        .filter_map(|id| {
            let deletable = DELETABLE.contains(id);
            match *id {
                "autostart" => return Some(Store { id, path: String::new(), exists: autostart, bytes: 0, files: 0, deletable }),
                "electron_keychain" => return paths.mac.then(|| Store { id, path: String::new(), exists: keychain, bytes: 0, files: 0, deletable }),
                // Windows: el manejador de links zerosoft:// que la app registra al arrancar (lib.rs).
                "link_handler" => return (!paths.mac).then(|| Store { id, path: LINK_HANDLER_KEY.into(), exists: true, bytes: 0, files: 0, deletable }),
                _ => {}
            }
            let shown = paths.shown_path(id)?;
            let all = paths.paths_of(id);
            let (bytes, files) = all.iter().map(|p| measure(p)).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
            Some(Store { id, path: shown.to_string_lossy().into_owned(), exists: all.iter().any(|p| fs::symlink_metadata(p).is_ok()), bytes, files, deletable })
        })
        .collect()
}

/// Borra un archivo o una carpeta (un enlace se borra como enlace, sin seguirlo). true si ya no está.
pub fn remove(p: &Path) -> bool {
    match fs::symlink_metadata(p) {
        Err(_) => true,
        Ok(m) if m.is_dir() => fs::remove_dir_all(p).is_ok() || fs::symlink_metadata(p).is_err(),
        Ok(_) => fs::remove_file(p).is_ok() || fs::symlink_metadata(p).is_err(),
    }
}

/// Borra lo que hay en disco de un dato (no el llavero ni el webview en uso: commands.rs).
pub fn delete_store(paths: &Paths, id: &str) -> bool {
    let mut ok = true;
    for p in paths.paths_of(id) {
        ok &= remove(&p);
        if p.extension().is_some_and(|e| e == "json") {
            let _ = fs::remove_file(p.with_extension("json.tmp"));
        }
    }
    ok
}

/// Borra los dictados sin enviar (audio y metadatos). La carpeta vuelve a crearse solo si otro
/// dictado falla.
pub fn delete_pending(paths: &Paths) -> bool {
    delete_store(paths, "pending")
}

/// Lo que se borra al arrancar con el pedido pendiente: los datos del webview y, de nuevo, los
/// archivos que se pudieron escribir al cerrar (la posición de la ventana).
/// También los dictados sin enviar y el registro: un dictado que terminaba justo mientras se
/// borraba pudo escribirse después.
const FINISH_WIPE: [&str; 8] = ["web_data", "web_cookies", "web_cache", "window_state", "settings", "session", "pending", "activity"];

/// El pedido de "borrar todo" que queda en disco para el próximo arranque.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WipeMarker {
    pub version: u32,
    /// La carpeta personal cuando se pidió (para reconocer las mismas rutas si cambió).
    pub home: PathBuf,
    /// Rutas absolutas a borrar, resueltas por la app cuando se pidió.
    pub targets: Vec<PathBuf>,
    /// Lo de versiones anteriores que no se pudo borrar (ids de stores).
    pub leftovers: Vec<String>,
}

/// Cómo terminó "borrar todo" (lo muestra Ajustes después de reiniciar).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WipeResult {
    /// Lo propio y los datos del webview, borrados.
    pub ok: bool,
    /// Lo de versiones anteriores que quedó (ids de stores).
    pub leftovers: Vec<String>,
    /// El pedido no se pudo cumplir: "marker" (ilegible o con rutas que no son de la app) o
    /// "locked" (el webview anterior las tenía abiertas).
    pub error: Option<&'static str>,
}

/// "Borrar todos los datos locales", la parte que se hace con la app abierta.
/// - Lo propio (ajustes, sesión, ventana, dictados, registro): si algo no se puede borrar, no se
///   sigue, WIPED se apaga y no hay reinicio (devuelve None).
/// - Lo que dejaron versiones anteriores (instaladores, Electron y su clave, `keychain`): se
///   intenta; lo que quede va en el pedido y se informa, sin frenar el resto.
/// - Queda el pedido con las rutas del webview: se borran al próximo arranque, antes de crear
///   ninguna ventana (con el webview abierto, su borrado no avisa cuándo terminó).
///
/// Desde acá nada se vuelve a escribir (WIPED) hasta que la app reinicia.
pub fn wipe_files(paths: &Paths, keychain: impl FnOnce() -> bool, autostart_off: bool) -> Option<WipeMarker> {
    set_wiped(true);
    let own = OWN.iter().all(|id| delete_store(paths, id));
    if !own {
        set_wiped(false);
        return None;
    }
    let mut keychain = Some(keychain);
    let leftovers: Vec<String> = LEFTOVERS
        .iter()
        .filter(|id| {
            let gone = match **id {
                "electron_keychain" => keychain.take().is_some_and(|k| k()),
                "autostart" => autostart_off,
                _ => delete_store(paths, id),
            };
            !gone
        })
        .map(|id| id.to_string())
        .collect();
    let marker = WipeMarker { version: 1, home: paths.home.clone(), targets: FINISH_WIPE.iter().flat_map(|id| paths.paths_of(id)).collect(), leftovers };
    let file = paths.wipe_marker();
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::write(&file, serde_json::to_vec(&marker).unwrap_or_default()).is_err() {
        set_wiped(false);
        return None;
    }
    Some(marker)
}

/// Una ruta del pedido que se puede borrar: una de las que la app resuelve ahora, o la misma ruta
/// dentro de la carpeta personal que anotó el pedido (si cambió la carpeta personal). Nada más.
fn valid_target(paths: &Paths, expected: &[PathBuf], marker_home: &Path, t: &Path) -> bool {
    if expected.iter().any(|e| e == t) {
        return true;
    }
    let clean = |p: &Path| p.is_absolute() && p.components().all(|c| !matches!(c, std::path::Component::ParentDir | std::path::Component::CurDir));
    if !clean(t) || !clean(marker_home) || marker_home.components().count() < 2 {
        return false;
    }
    expected.iter().filter_map(|e| e.strip_prefix(&paths.home).ok()).any(|rel| !rel.as_os_str().is_empty() && marker_home.join(rel) == t)
}

/// Al arrancar, antes de crear ninguna ventana: si quedó pedido "borrar todo", borra las rutas
/// del pedido que sean válidas y, además, las que la app resuelve ahora (por si cambió algo).
/// Reintenta un rato: los procesos del webview anterior pueden tardar en cerrar. None = no había
/// nada pendiente.
pub fn finish_wipe(paths: &Paths, attempts: u32, wait: std::time::Duration) -> Option<WipeResult> {
    let file = paths.wipe_marker();
    let raw = fs::read(&file).ok()?;
    let parsed: Option<WipeMarker> = serde_json::from_slice(&raw).ok().filter(|m: &WipeMarker| m.version == 1);
    let mut error = None;
    let expected: Vec<PathBuf> = FINISH_WIPE.iter().flat_map(|id| paths.paths_of(id)).collect();
    let mut targets = expected.clone();
    match &parsed {
        None => error = Some("marker"),
        Some(m) => {
            for t in &m.targets {
                if valid_target(paths, &expected, &m.home, t) {
                    if !targets.contains(t) {
                        targets.push(t.clone());
                    }
                } else {
                    error = Some("marker");
                }
            }
        }
    }
    let mut gone = false;
    for i in 0..attempts.max(1) {
        if i > 0 {
            std::thread::sleep(wait);
        }
        targets.iter().for_each(|t| {
            remove(t);
        });
        gone = targets.iter().all(|t| fs::symlink_metadata(t).is_err());
        if gone {
            break;
        }
    }
    // El pedido se borra recién al terminar: si la app se cierra en el medio, el próximo arranque
    // lo vuelve a intentar.
    let _ = fs::remove_file(&file);
    AFTER_WIPE.store(true, Ordering::Relaxed);
    if !gone && error.is_none() {
        error = Some("locked");
    }
    Some(WipeResult { ok: gone && error.is_none(), leftovers: parsed.map(|m| m.leftovers).unwrap_or_default(), error })
}

/// Este arranque terminó un "borrar todo": la posición de la ventana no se restaura ni se guarda
/// (el plugin window-state ya la había leído de disco antes de que se borrara; lib.rs).
static AFTER_WIPE: AtomicBool = AtomicBool::new(false);

pub fn after_wipe() -> bool {
    AFTER_WIPE.load(Ordering::Relaxed)
}

/// El plugin window-state puede restaurar y seguir esta ventana.
pub fn keep_window_state(label: &str, main: &str, after_wipe: bool) -> bool {
    label == main && !after_wipe
}

/// Resultado del borrado terminado al arrancar (lo lee Ajustes).
pub static LAST_WIPE: OnceLock<WipeResult> = OnceLock::new();

/// Después de crear el estado de la app: si el arranque terminó un "borrar todo", queda anotado.
pub fn note_finished_wipe(app: &AppHandle) {
    if let Some(r) = LAST_WIPE.get() {
        record(app, Event::new(Kind::DataDeleted).trigger(Tag::Settings).result(if r.ok && r.leftovers.is_empty() { Tag::All } else { Tag::Failed }));
    }
}

/// Copia un archivo o una carpeta entera (sin seguir enlaces: un enlace no se copia).
fn copy_all(from: &Path, to: &Path) -> bool {
    let Ok(m) = fs::symlink_metadata(from) else { return false };
    if m.is_file() {
        return fs::copy(from, to).is_ok();
    }
    if !m.is_dir() || fs::create_dir_all(to).is_err() {
        return false;
    }
    fs::read_dir(from).map(|rd| rd.flatten().all(|e| copy_all(&e.path(), &to.join(e.file_name())))).unwrap_or(false)
}

/// Mueve un archivo o carpeta de lugar (Windows: de Roaming a Local). Si renombrar no anda (otra
/// unidad, carpetas redirigidas), copia y después borra el original. Si el destino ya existe y
/// los dos son carpetas, mueve lo que no esté; un archivo que ya existe no se pisa. Lo que quede
/// en el origen igual se lista, se poda y se borra (`paths_of`). true = no quedó nada en el origen.
pub fn migrate(from: &Path, to: &Path) -> bool {
    if from == to || fs::symlink_metadata(from).is_err() {
        return true;
    }
    if let Some(dir) = to.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::symlink_metadata(to).is_err() {
        if fs::rename(from, to).is_ok() {
            return true;
        }
        if copy_all(from, to) {
            return remove(from);
        }
        remove(to);
        return false;
    }
    if from.is_dir() && to.is_dir() {
        if let Ok(rd) = fs::read_dir(from) {
            for e in rd.flatten() {
                let dest = to.join(e.file_name());
                if fs::symlink_metadata(&dest).is_err() {
                    migrate(&e.path(), &dest);
                }
            }
        }
        let _ = fs::remove_dir(from);
    }
    fs::symlink_metadata(from).is_err()
}

// ---------- Hechos (desktop/privacy-facts.json) ----------

pub fn facts() -> &'static Value {
    static FACTS: OnceLock<Value> = OnceLock::new();
    FACTS.get_or_init(|| serde_json::from_str(include_str!("../../privacy-facts.json")).unwrap_or(Value::Null))
}

/// La página pública con estos mismos hechos (en el servidor configurado).
pub const DOCS_PATH: &str = "/download/privacy";

/// Links al código desde la app: el tag de la versión que corre (desktop-v<versión>), así lo que
/// se lee es lo que está instalado. La página pública enlaza a main ("el código actual").
pub fn repo_for(version: &str) -> String {
    let v: String = version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').take(40).collect();
    format!("https://github.com/lschiaffino/zerosoft/blob/desktop-v{v}/")
}

/// Secciones de privacy-facts.json con hechos (cada uno con su código).
pub const FACT_SECTIONS: [&str; 10] = ["permissions", "stores", "network", "never", "system", "indicators", "events", "controls", "security", "open"];

/// Un archivo del repositorio que los hechos nombran como fuente (lo único que "ver el código" abre).
pub fn is_source(file: &str) -> bool {
    let f = facts();
    FACT_SECTIONS.iter().any(|section| {
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

    /// Como en Windows: config (Roaming) y local separados; en Mac son la misma carpeta.
    fn paths(root: &Path, mac: bool) -> Paths {
        let base = root.join("appdata");
        Paths {
            config: base.join("roaming").join(IDENTIFIER),
            local_data: base.join("local").join(IDENTIFIER),
            cache: root.join("cache"),
            home: root.join("home"),
            temp: root.join("temp"),
            identifier: IDENTIFIER.into(),
            mac,
        }
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
        // Una grabación de Rec que avisó la página también cuenta para pantalla.
        log.record(Event::new(Kind::ScreenStart).trigger(Tag::Page));
        assert_eq!(log.snapshot().usage["screen"].count, 2);
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
        let local = p.local_data.clone();
        fs::create_dir_all(local.join("pending")).unwrap();
        fs::create_dir_all(&p.config).unwrap();
        fs::write(local.join("pending/a1b2c3.audio"), vec![0u8; 3000]).unwrap();
        fs::write(local.join("pending/a1b2c3.json"), b"{}").unwrap();
        fs::write(p.config.join("settings.json"), b"{\"mode\":\"both\"}").unwrap();
        fs::write(local.join("session.json"), b"{}").unwrap();
        fs::write(p.config.join(".window-state.json"), b"{}").unwrap();
        let list = stores(&p, false, true);
        assert_eq!(list.iter().map(|s| s.id).collect::<Vec<_>>(), STORE_IDS.iter().filter(|id| !["update_temp", "link_handler"].contains(*id)).copied().collect::<Vec<_>>());
        let by = |id: &str| list.iter().find(|s| s.id == id).unwrap().clone();
        assert_eq!((by("pending").bytes, by("pending").files, by("pending").deletable), (3002, 2, true));
        assert!(by("settings").exists && !by("settings").deletable);
        assert!(!by("web_data").exists && by("web_data").path.ends_with("Library/WebKit/ai.zerosoft.desktop"));
        assert!(by("web_cookies").path.ends_with("HTTPStorages/ai.zerosoft.desktop.binarycookies"));
        assert!(by("os_prefs").path.ends_with("Library/Preferences/ai.zerosoft.desktop.plist") && !by("os_prefs").deletable);
        assert!(by("electron_keychain").exists && by("electron_keychain").deletable);
        assert!(!by("electron_data").exists, "no hay carpeta de Electron");
        assert_eq!((by("autostart").path.as_str(), by("autostart").exists), ("", false));
        assert!(delete_pending(&p));
        assert!(!local.join("pending").exists());
        assert!(delete_pending(&p), "borrar lo que no está también es ok");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn old_app_folders_only_count_when_they_are_really_ours() {
        let root = tmp("electron");
        let w = paths(&root, false);
        let parent = w.config.parent().unwrap().to_path_buf();
        // Una carpeta "zerosoft" de otra app (sin nada de Chromium): no es nuestra, no se lista ni se borra.
        let theirs = parent.join(ELECTRON_FOLDER);
        fs::create_dir_all(theirs.join("docs")).unwrap();
        fs::write(theirs.join("docs/importante.txt"), b"de otra app").unwrap();
        assert!(w.electron_profile().is_none());
        assert!(w.paths_of("electron_data").is_empty());
        assert!(delete_store(&w, "electron_data"));
        assert!(theirs.join("docs/importante.txt").exists());
        // Con una marca de Chromium (SingletonLock es un enlace roto: cuenta igual), sí.
        #[cfg(unix)]
        std::os::unix::fs::symlink("host-1234", theirs.join("SingletonLock")).unwrap();
        #[cfg(not(unix))]
        fs::write(theirs.join("Local State"), b"{}").unwrap();
        assert_eq!(w.electron_profile(), Some(theirs.clone()));
        // Un enlace llamado "zerosoft" que apunta a otra carpeta: no se sigue.
        #[cfg(unix)]
        {
            let other = root.join("otra");
            fs::create_dir_all(&other).unwrap();
            fs::write(other.join("Preferences"), b"x").unwrap();
            let fake = root.join("enlace");
            fs::create_dir_all(&fake).unwrap();
            std::os::unix::fs::symlink(&other, fake.join(ELECTRON_FOLDER)).unwrap();
            assert!(!owned_folder(&fake.join(ELECTRON_FOLDER), ELECTRON_FOLDER, &ELECTRON_PROFILE_MARKERS));
        }
        // Nombre exacto: "ZeroSoft" no es "zerosoft" (en un disco que no distingue mayúsculas).
        let case = root.join("mayus");
        fs::create_dir_all(case.join("ZeroSoft/Partitions")).unwrap();
        assert!(!owned_folder(&case.join(ELECTRON_FOLDER), ELECTRON_FOLDER, &ELECTRON_PROFILE_MARKERS));
        // La caché de su updater: solo con lo que deja electron-updater.
        let cache = w.local_data.parent().unwrap().join(ELECTRON_UPDATER_FOLDER);
        fs::create_dir_all(&cache).unwrap();
        assert!(w.electron_updater_cache().is_none());
        fs::create_dir_all(cache.join("pending")).unwrap();
        assert_eq!(w.paths_of("electron_data"), vec![theirs.clone(), cache.clone()]);
        assert!(delete_store(&w, "electron_data"));
        assert!(!theirs.exists() && !cache.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_all_wipes_own_files_and_reports_old_leftovers_without_stopping() {
        let root = tmp("wipe");
        let w = paths(&root, false);
        fs::create_dir_all(w.local_data.join("pending")).unwrap();
        fs::write(w.local_data.join("pending/a.json"), b"{}").unwrap();
        fs::create_dir_all(&w.config).unwrap();
        fs::write(w.config.join("settings.json"), b"{}").unwrap();
        fs::write(w.config.join(".window-state.json"), b"{}").unwrap();
        // Lo que dejó una versión anterior en Roaming también se borra.
        fs::create_dir_all(w.config.join("privacy")).unwrap();
        fs::write(w.config.join("session.json"), b"{}").unwrap();
        fs::create_dir_all(w.temp.join("zerosoft-0.3.5-updater-ab12")).unwrap();
        fs::write(w.temp.join("zerosoft-0.3.5-updater-ab12/zerosoft-0.3.5-installer.exe"), vec![0u8; 50]).unwrap();
        fs::create_dir_all(w.temp.join("zerosoft-cache-updater-x")).unwrap();
        let win = stores(&w, true, false);
        let wby = |id: &str| win.iter().find(|s| s.id == id).unwrap().clone();
        assert_eq!((wby("link_handler").path.as_str(), wby("link_handler").deletable), (LINK_HANDLER_KEY, false));
        assert!(wby("web_data").path.ends_with("EBWebView") && wby("web_data").path.contains("local"));
        assert!(wby("session").path.contains("local") && wby("settings").path.contains("roaming"));
        assert!(wby("session").exists, "el session.json viejo de Roaming cuenta");
        assert_eq!((wby("update_temp").bytes, wby("update_temp").files), (50, 1));

        let log = Log::open(&w.local_data.join("privacy"));
        log.record(Event::new(Kind::MicStart));
        // La clave del llavero no se pudo borrar: igual se borra lo propio y queda el pedido.
        // Además, el ítem de inicio no se pudo sacar: se informa igual.
        let marker = wipe_files(&w, || false, false).expect("lo propio se borró");
        assert_eq!(marker.leftovers, ["electron_keychain", "autostart"]);
        for id in OWN {
            assert!(w.paths_of(id).iter().all(|p| !p.exists()), "{id}");
        }
        assert!(!w.temp.join("zerosoft-0.3.5-updater-ab12").exists());
        assert!(w.temp.join("zerosoft-cache-updater-x").exists(), "solo instaladores con versión");
        assert!(w.wipe_marker().exists());
        assert!(marker.targets.iter().all(|t| t.is_absolute()) && marker.targets.contains(&w.local_data.join("EBWebView")));
        log.record(Event::new(Kind::MicStop));
        assert!(!log.path().exists(), "después de borrar todo no se escribe nada");
        assert!(crate::config::save(&w.config, &crate::config::normalize(&Value::Null, "windows", crate::config::DEFAULT_SERVER.into())).is_ok());
        assert!(!w.config.join("settings.json").exists());

        // Al arrancar: los datos del webview, la posición de la ventana (escrita al cerrar) y un
        // dictado que llegó a escribirse mientras se borraba.
        set_wiped(false);
        fs::create_dir_all(w.local_data.join("EBWebView/Default/IndexedDB")).unwrap();
        fs::write(w.config.join(".window-state.json"), b"{}").unwrap();
        fs::create_dir_all(w.local_data.join("pending")).unwrap();
        fs::write(w.local_data.join("pending/tarde.audio"), b"RIFF").unwrap();
        let r = finish_wipe(&w, 3, std::time::Duration::from_millis(1)).unwrap();
        assert_eq!(r, WipeResult { ok: true, leftovers: vec!["electron_keychain".into(), "autostart".into()], error: None });
        assert!(after_wipe());
        assert!(!w.local_data.join("EBWebView").exists() && !w.config.join(".window-state.json").exists());
        assert!(!w.local_data.join("pending").exists());
        assert!(!w.wipe_marker().exists());
        assert_eq!(finish_wipe(&w, 3, std::time::Duration::from_millis(1)), None, "sin pedido no borra nada");

        // Si lo propio no se puede borrar (una carpeta en lugar de settings.json que no se deja
        // borrar no se puede simular fácil: un archivo en una carpeta sin permisos), no hay pedido.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::create_dir_all(w.local_data.join("pending")).unwrap();
            fs::write(w.local_data.join("pending/b.json"), b"{}").unwrap();
            fs::set_permissions(w.local_data.join("pending"), fs::Permissions::from_mode(0o500)).unwrap();
            fs::set_permissions(&w.local_data, fs::Permissions::from_mode(0o500)).unwrap();
            assert!(wipe_files(&w, || true, true).is_none());
            assert!(!wiped() && !w.wipe_marker().exists());
            fs::set_permissions(&w.local_data, fs::Permissions::from_mode(0o700)).unwrap();
            fs::set_permissions(w.local_data.join("pending"), fs::Permissions::from_mode(0o700)).unwrap();
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_wipe_request_is_validated_before_deleting_anything() {
        let root = tmp("marker");
        let w = paths(&root, true);
        fs::create_dir_all(&w.local_data).unwrap();
        // Archivos con nombres "permitidos" que no son de la app: nunca se tocan.
        let other_app = w.home.join("Library/Application Support/OtraApp/settings.json");
        fs::create_dir_all(other_app.parent().unwrap()).unwrap();
        fs::write(&other_app, b"{}").unwrap();
        let outside = root.join("ajeno/EBWebView");
        fs::create_dir_all(&outside).unwrap();
        let bad = WipeMarker {
            version: 1,
            home: w.home.clone(),
            targets: vec!["relative/EBWebView".into(), outside.clone(), other_app.clone(), w.home.clone(), w.home.join("Library/../x/settings.json")],
            leftovers: vec![],
        };
        fs::write(w.wipe_marker(), serde_json::to_vec(&bad).unwrap()).unwrap();
        let r = finish_wipe(&w, 1, std::time::Duration::from_millis(1)).unwrap();
        assert_eq!((r.ok, r.error), (false, Some("marker")));
        assert!(outside.exists() && other_app.exists() && w.home.exists(), "nada fuera de lo de la app");
        // Un pedido ilegible: igual se borra lo que la app resuelve, y se avisa.
        fs::write(w.wipe_marker(), b"no es json").unwrap();
        fs::create_dir_all(w.home.join("Library/WebKit").join(IDENTIFIER)).unwrap();
        let r = finish_wipe(&w, 1, std::time::Duration::from_millis(1)).unwrap();
        assert_eq!((r.ok, r.error), (false, Some("marker")));
        assert!(!w.home.join("Library/WebKit").join(IDENTIFIER).exists());
        assert!(!w.wipe_marker().exists(), "el pedido se borra al terminar");
        // La misma ruta bajo otra carpeta personal (la que anotó el pedido): vale, y solo esa.
        let old_home = root.join("home-anterior");
        let moved = old_home.join("Library/WebKit").join(IDENTIFIER);
        fs::create_dir_all(&moved).unwrap();
        let elsewhere = old_home.join("Library/WebKit/otra.app");
        fs::create_dir_all(&elsewhere).unwrap();
        let m = WipeMarker { version: 1, home: old_home.clone(), targets: vec![moved.clone(), elsewhere.clone()], leftovers: vec![] };
        fs::write(w.wipe_marker(), serde_json::to_vec(&m).unwrap()).unwrap();
        assert_eq!(finish_wipe(&w, 1, std::time::Duration::from_millis(1)).unwrap().error, Some("marker"));
        assert!(!moved.exists() && elsewhere.exists());
        // Después de borrar todo, la ventana no recupera ni guarda su posición vieja.
        assert!(keep_window_state("main", "main", false));
        assert!(!keep_window_state("main", "main", true) && !keep_window_state("settings", "main", false));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn paths_match_tauri_and_migrate_with_copy_fallback() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
        for ok in ["zerosoft-0.3.6-updater-Ab3x", "zerosoft-1.10.0-beta.1-updater-x9"] {
            assert!(is_update_temp(ok), "{ok}");
        }
        for bad in ["zerosoft-cache-updater-x", "zerosoft-0.3-updater-x", "zerosoft-0.3.6-updater-", "other-0.1.0-updater-x", "zerosoft-0.3.6-updater-../x", "ZEROSOFT-0.3.6-updater-x"] {
            assert!(!is_update_temp(bad), "{bad}");
        }
        let root = tmp("migrate");
        let (from, to) = (root.join("roaming/pending"), root.join("local/pending"));
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("a.json"), b"{}").unwrap();
        assert!(migrate(&from, &to));
        assert!(to.join("a.json").exists() && !from.exists());
        // Los dos existen: se mueve lo que falta, no se pisa lo que está.
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("a.json"), b"viejo").unwrap();
        fs::write(from.join("b.json"), b"{}").unwrap();
        assert!(!migrate(&from, &to), "queda a.json en el origen");
        assert!(to.join("b.json").exists() && fs::read(to.join("a.json")).unwrap() == b"{}");
        assert!(from.join("a.json").exists());
        // Copiar y borrar cuando renombrar no anda: lo mismo que hace copy_all + remove.
        let (src, dst) = (root.join("x/privacy"), root.join("y/privacy"));
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("sub/activity.json"), b"{}").unwrap();
        assert!(copy_all(&src, &dst) && remove(&src));
        assert!(dst.join("sub/activity.json").exists() && !src.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn private_files_are_born_0600() {
        let dir = tmp("private");
        let f = dir.join("x.json");
        assert!(write_private(&f, b"{}"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&f, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(write_private(&f, b"{\"a\":1}"));
            assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o600);
        }
        assert_eq!(fs::read(&f).unwrap(), b"{\"a\":1}");
        assert_eq!(repo_for("0.3.7"), "https://github.com/lschiaffino/zerosoft/blob/desktop-v0.3.7/");
        assert_eq!(repo_for("1.0/../x"), "https://github.com/lschiaffino/zerosoft/blob/desktop-v1.0..x/");
        let _ = fs::remove_dir_all(dir);
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
        // "Borrar todo" borra exactamente lo que los hechos marcan con "all".
        let marked: Vec<String> = f["stores"].as_array().unwrap().iter().filter(|s| s["all"] == true).map(|s| s["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(marked, WIPED_BY_DELETE_ALL);
        assert_eq!(f["path"], DOCS_PATH);
        assert!(is_source("desktop/src-tauri/src/privacy.rs") && !is_source("../../etc/passwd") && !is_source(""));
        // Cada archivo que se nombra como fuente existe en el repositorio.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for section in FACT_SECTIONS {
            for item in f[section].as_array().unwrap() {
                for c in item["code"].as_array().unwrap() {
                    assert!(root.join(c.as_str().unwrap()).is_file(), "{section} {}: {c}", item["id"]);
                }
            }
        }
        // Cada texto está en los tres idiomas.
        for section in FACT_SECTIONS {
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
