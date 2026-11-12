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
/// La app de Electron (0.1.0 a 0.1.2) guardaba en <carpeta de datos>/zerosoft y su clave de
/// safeStorage en el llavero con este servicio y esta cuenta.
pub const ELECTRON_FOLDER: &str = "zerosoft";
pub const ELECTRON_KEYCHAIN_SERVICE: &str = "zerosoft Safe Storage";
pub const ELECTRON_KEYCHAIN_ACCOUNT: &str = "zerosoft Key";

/// Carpetas de la app en este sistema.
#[derive(Debug, Clone)]
pub struct Paths {
    /// Roaming en Windows (%APPDATA%): solo settings.json y el plugin de la ventana.
    pub config: PathBuf,
    /// Local (%LOCALAPPDATA% en Windows): sesión, dictados, registro y el webview.
    pub local_data: PathBuf,
    pub cache: PathBuf,
    pub home: PathBuf,
    pub temp: PathBuf,
    pub identifier: String,
    pub mac: bool,
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

    /// Las mismas carpetas sin la app (antes de crearla: el borrado pendiente al arrancar). Como
    /// las resuelve Tauri: Mac ~/Library/…/<id>; Windows %APPDATA%\<id> y %LOCALAPPDATA%\<id>.
    pub fn from_env(home: Option<PathBuf>, appdata: Option<PathBuf>, local_appdata: Option<PathBuf>, mac: bool) -> Option<Paths> {
        let home = home?;
        let (config, local_data, cache) = if mac {
            let support = home.join("Library").join("Application Support").join(IDENTIFIER);
            (support.clone(), support, home.join("Library").join("Caches").join(IDENTIFIER))
        } else {
            let local = local_appdata?.join(IDENTIFIER);
            (appdata?.join(IDENTIFIER), local.clone(), local)
        };
        Some(Paths { config, local_data, cache, home, temp: std::env::temp_dir(), identifier: IDENTIFIER.into(), mac })
    }

    pub fn current_env() -> Option<Paths> {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        let mac = cfg!(target_os = "macos");
        Paths::from_env(if mac { var("HOME") } else { var("USERPROFILE") }, var("APPDATA"), var("LOCALAPPDATA"), mac)
    }

    /// El archivo que pide terminar "borrar todo" en el próximo arranque.
    pub fn wipe_marker(&self) -> PathBuf {
        self.local_data.join(".wipe-pending")
    }

    /// Dónde está cada cosa (vacío = no existe en este sistema, o no es un archivo).
    pub fn paths_of(&self, id: &str) -> Vec<PathBuf> {
        let lib = self.home.join("Library");
        let one = |p: PathBuf| vec![p];
        match id {
            "settings" => one(self.config.join("settings.json")),
            "session" => one(self.local_data.join("session.json")),
            "window_state" => one(self.config.join(".window-state.json")),
            "pending" => one(self.local_data.join("pending")),
            "activity" => one(self.local_data.join("privacy")),
            // WKWebView guarda con el identificador de la app; WebView2, en EBWebView.
            "web_data" => one(if self.mac { lib.join("WebKit").join(&self.identifier) } else { self.local_data.join("EBWebView") }),
            "web_cookies" if self.mac => one(lib.join("HTTPStorages").join(format!("{}.binarycookies", self.identifier))),
            "web_cache" if self.mac => one(self.cache.clone()),
            "os_prefs" if self.mac => one(lib.join("Preferences").join(format!("{}.plist", self.identifier))),
            // Windows: el instalador de cada actualización queda en una carpeta temporal.
            "update_temp" if !self.mac => fs::read_dir(&self.temp)
                .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(is_update_temp)).collect())
                .unwrap_or_default(),
            "electron_data" => {
                let base = self.config.parent().map(|p| p.join(ELECTRON_FOLDER));
                let updater = (!self.mac).then(|| self.local_data.parent().map(|p| p.join("zerosoft-desktop-updater"))).flatten();
                base.into_iter().chain(updater).collect()
            }
            _ => vec![],
        }
    }

    /// Lo que se muestra como ruta de un dato (la carpeta temporal para los instaladores).
    pub fn shown_path(&self, id: &str) -> Option<PathBuf> {
        match id {
            "update_temp" if !self.mac => Some(self.temp.clone()),
            _ => self.paths_of(id).into_iter().next(),
        }
    }
}

/// Carpeta temporal de un instalador de la app (tauri-plugin-updater: "<app>-<versión>-updater-").
pub fn is_update_temp(name: &str) -> bool {
    name.starts_with("zerosoft-") && name.contains("-updater-")
}

/// Ids de `stores` en privacy-facts.json, en el orden en que se muestran.
pub const STORE_IDS: [&str; 13] = [
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
    "autostart",
];

/// Lo que se puede borrar por separado desde Ajustes (lo demás, con "Borrar todo").
pub const DELETABLE: [&str; 6] = ["pending", "activity", "web_data", "update_temp", "electron_data", "electron_keychain"];

/// Lo que "Borrar todo" borra (además del ítem de inicio). `os_prefs` es del sistema.
pub const WIPED_BY_DELETE_ALL: [&str; 11] = ["settings", "session", "window_state", "pending", "activity", "web_data", "web_cookies", "web_cache", "update_temp", "electron_data", "electron_keychain"];

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

/// El inventario. `autostart` y `keychain`: si existen el ítem de inicio y la clave de Electron.
pub fn stores(paths: &Paths, autostart: bool, keychain: bool) -> Vec<Store> {
    STORE_IDS
        .iter()
        .filter_map(|id| {
            let deletable = DELETABLE.contains(id);
            match *id {
                "autostart" => return Some(Store { id, path: String::new(), exists: autostart, bytes: 0, files: 0, deletable }),
                "electron_keychain" => return paths.mac.then(|| Store { id, path: String::new(), exists: keychain, bytes: 0, files: 0, deletable }),
                _ => {}
            }
            let shown = paths.shown_path(id)?;
            let all = paths.paths_of(id);
            let (bytes, files) = all.iter().map(|p| measure(p)).fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1));
            Some(Store { id, path: shown.to_string_lossy().into_owned(), exists: all.iter().any(|p| p.exists()), bytes, files, deletable })
        })
        .collect()
}

/// Borra un archivo o una carpeta. true si ya no está.
pub fn remove(p: &Path) -> bool {
    match fs::symlink_metadata(p) {
        Err(_) => true,
        Ok(m) if m.is_dir() => fs::remove_dir_all(p).is_ok() || !p.exists(),
        Ok(_) => fs::remove_file(p).is_ok() || !p.exists(),
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

/// "Borrar todos los datos locales", la parte que se hace con la app abierta: los archivos
/// propios, los instaladores viejos, lo que dejó la app de Electron y su clave del llavero
/// (`keychain`). Desde acá nada se vuelve a escribir (WIPED). Los datos del webview se borran al
/// próximo arranque, antes de crear ninguna ventana (`finish_wipe`): con el webview abierto, su
/// borrado no avisa cuándo terminó. Si algo no se pudo borrar, WIPED se apaga y no hay reinicio.
pub fn wipe_files(paths: &Paths, keychain: impl FnOnce() -> bool) -> bool {
    set_wiped(true);
    let mut ok = true;
    let mut keychain = Some(keychain);
    for id in WIPED_BY_DELETE_ALL {
        ok &= match id {
            // Con el webview abierto no se borran sus carpetas: al arrancar (FINISH_WIPE).
            "web_data" | "web_cookies" | "web_cache" => FINISH_WIPE.contains(&id),
            "electron_keychain" => keychain.take().is_some_and(|k| k()),
            _ => delete_store(paths, id),
        };
    }
    if ok {
        let marker = paths.wipe_marker();
        if let Some(dir) = marker.parent() {
            let _ = fs::create_dir_all(dir);
        }
        ok = fs::write(&marker, b"1").is_ok();
    }
    if !ok {
        set_wiped(false);
    }
    ok
}

/// Lo que se borra al arrancar con el pedido pendiente: los datos del webview y, de nuevo, los
/// archivos que se pudieron escribir al cerrar (la posición de la ventana).
const FINISH_WIPE: [&str; 6] = ["web_data", "web_cookies", "web_cache", "window_state", "settings", "session"];

/// Al arrancar, antes de crear la app: si quedó pedido "borrar todo", borra los datos del webview
/// (nada los tiene abiertos todavía). Reintenta un rato: los procesos del webview anterior pueden
/// tardar en cerrar. None = no había nada pendiente; Some(ok).
pub fn finish_wipe(paths: &Paths, attempts: u32, wait: std::time::Duration) -> Option<bool> {
    let marker = paths.wipe_marker();
    if !marker.exists() {
        return None;
    }
    let mut ok = false;
    for i in 0..attempts.max(1) {
        if i > 0 {
            std::thread::sleep(wait);
        }
        ok = FINISH_WIPE.iter().all(|id| delete_store(paths, id)) && FINISH_WIPE.iter().all(|id| paths.paths_of(id).iter().all(|p| !p.exists()));
        if ok {
            break;
        }
    }
    let _ = fs::remove_file(&marker);
    Some(ok)
}

/// Resultado del borrado terminado al arrancar (lo lee Ajustes).
pub static LAST_WIPE: OnceLock<bool> = OnceLock::new();

/// Después de crear la app: si el arranque terminó un "borrar todo", queda anotado.
pub fn note_finished_wipe(app: &AppHandle) {
    if let Some(ok) = LAST_WIPE.get() {
        record(app, Event::new(Kind::DataDeleted).trigger(Tag::Settings).result(if *ok { Tag::All } else { Tag::Failed }));
    }
}

/// Mueve un archivo o carpeta de lugar una vez (Windows: de Roaming a Local). Si el destino ya
/// existe, no pisa nada.
pub fn migrate(from: &Path, to: &Path) -> bool {
    if from == to || !from.exists() || to.exists() {
        return true;
    }
    if let Some(dir) = to.parent() {
        let _ = fs::create_dir_all(dir);
    }
    fs::rename(from, to).is_ok()
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
        assert_eq!(list.iter().map(|s| s.id).collect::<Vec<_>>(), STORE_IDS.iter().filter(|id| **id != "update_temp").copied().collect::<Vec<_>>());
        let by = |id: &str| list.iter().find(|s| s.id == id).unwrap().clone();
        assert_eq!((by("pending").bytes, by("pending").files, by("pending").deletable), (3002, 2, true));
        assert!(by("settings").exists && !by("settings").deletable);
        assert!(!by("web_data").exists && by("web_data").path.ends_with("Library/WebKit/ai.zerosoft.desktop"));
        assert!(by("web_cookies").path.ends_with("HTTPStorages/ai.zerosoft.desktop.binarycookies"));
        assert!(by("os_prefs").path.ends_with("Library/Preferences/ai.zerosoft.desktop.plist") && !by("os_prefs").deletable);
        assert!(by("electron_keychain").exists && by("electron_keychain").deletable);
        assert_eq!((by("autostart").path.as_str(), by("autostart").exists), ("", false));

        // Windows: cookies y caché van dentro de la carpeta de WebView2; no hay llavero; los
        // instaladores viejos y la carpeta de Electron se listan.
        let w = paths(&root, false);
        fs::create_dir_all(w.temp.join("zerosoft-0.3.5-updater-ab12")).unwrap();
        fs::write(w.temp.join("zerosoft-0.3.5-updater-ab12/zerosoft-0.3.5-installer.exe"), vec![0u8; 50]).unwrap();
        fs::create_dir_all(w.temp.join("otra-app-updater-x")).unwrap();
        let electron = w.config.parent().unwrap().join(ELECTRON_FOLDER);
        fs::create_dir_all(&electron).unwrap();
        fs::write(electron.join("session.bin"), b"cifrado").unwrap();
        let win = stores(&w, true, true);
        assert_eq!(
            win.iter().map(|s| s.id).collect::<Vec<_>>(),
            ["settings", "session", "window_state", "pending", "activity", "web_data", "update_temp", "electron_data", "autostart"]
        );
        let wby = |id: &str| win.iter().find(|s| s.id == id).unwrap().clone();
        assert!(wby("web_data").path.ends_with("EBWebView") && wby("web_data").path.contains("local"));
        assert!(wby("session").path.contains("local") && wby("settings").path.contains("roaming"));
        assert_eq!((wby("update_temp").bytes, wby("update_temp").files), (50, 1));
        assert!(wby("electron_data").exists);

        assert!(delete_pending(&p));
        assert!(!local.join("pending").exists());
        assert!(delete_pending(&p), "borrar lo que no está también es ok");
        assert_eq!(stores(&p, false, false).iter().find(|s| s.id == "pending").unwrap().bytes, 0);

        // Borrar todo con la app abierta: lo propio, los instaladores, Electron y su clave; queda
        // pedido terminar al arrancar. Mientras tanto nada se vuelve a escribir.
        let log = Log::open(&w.local_data.join("privacy"));
        log.record(Event::new(Kind::MicStart));
        let mut keychain_asked = false;
        assert!(wipe_files(&w, || {
            keychain_asked = true;
            true
        }));
        assert!(keychain_asked);
        for id in ["settings", "session", "window_state", "pending", "activity", "update_temp", "electron_data"] {
            assert!(w.paths_of(id).iter().all(|p| !p.exists()), "{id}");
        }
        assert!(w.temp.join("otra-app-updater-x").exists(), "solo lo de zerosoft");
        assert!(w.wipe_marker().exists());
        log.record(Event::new(Kind::MicStop));
        assert!(!log.path().exists(), "después de borrar todo no se escribe nada");
        assert!(crate::config::save(&w.config, &crate::config::normalize(&Value::Null, "windows", crate::config::DEFAULT_SERVER.into())).is_ok());
        assert!(!w.config.join("settings.json").exists());

        // Al arrancar: los datos del webview (y la posición de la ventana, escrita al cerrar).
        set_wiped(false);
        fs::create_dir_all(w.local_data.join("EBWebView/Default/IndexedDB")).unwrap();
        fs::write(w.local_data.join("EBWebView/Default/Cookies"), b"x").unwrap();
        fs::write(w.config.join(".window-state.json"), b"{}").unwrap();
        assert_eq!(finish_wipe(&w, 3, std::time::Duration::from_millis(1)), Some(true));
        assert!(!w.local_data.join("EBWebView").exists() && !w.config.join(".window-state.json").exists());
        assert!(!w.wipe_marker().exists());
        assert_eq!(finish_wipe(&w, 3, std::time::Duration::from_millis(1)), None, "sin pedido no borra nada");

        // Si la clave del llavero no se pudo borrar: no queda pedido, se puede volver a escribir.
        assert!(!wipe_files(&w, || false));
        assert!(!wiped() && !w.wipe_marker().exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn paths_match_tauri_and_migrate_once() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
        let mac = Paths::from_env(Some("/Users/ana".into()), None, None, true).unwrap();
        assert_eq!(mac.config, PathBuf::from("/Users/ana/Library/Application Support/ai.zerosoft.desktop"));
        assert_eq!(mac.local_data, mac.config);
        assert_eq!(mac.cache, PathBuf::from("/Users/ana/Library/Caches/ai.zerosoft.desktop"));
        let win = Paths::from_env(Some("C:/Users/ana".into()), Some("C:/Users/ana/AppData/Roaming".into()), Some("C:/Users/ana/AppData/Local".into()), false).unwrap();
        assert_eq!(win.config, PathBuf::from("C:/Users/ana/AppData/Roaming/ai.zerosoft.desktop"));
        assert_eq!(win.local_data, PathBuf::from("C:/Users/ana/AppData/Local/ai.zerosoft.desktop"));
        assert!(Paths::from_env(Some("x".into()), None, None, false).is_none());
        assert!(is_update_temp("zerosoft-0.3.6-updater-Ab3x") && !is_update_temp("zerosoft-cache") && !is_update_temp("other-0.1-updater-x"));

        let root = tmp("migrate");
        let (from, to) = (root.join("roaming/pending"), root.join("local/pending"));
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("a.json"), b"{}").unwrap();
        assert!(migrate(&from, &to));
        assert!(to.join("a.json").exists() && !from.exists());
        fs::create_dir_all(&from).unwrap();
        fs::write(from.join("b.json"), b"{}").unwrap();
        assert!(migrate(&from, &to));
        assert!(from.join("b.json").exists() && !to.join("b.json").exists(), "no pisa lo que ya está");
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
