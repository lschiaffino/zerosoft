//! Actualizaciones con el updater de Tauri. Feed: <servidor>/api/desktop/update/latest.json, que
//! sirve el latest.json del último release desktop-v* de GitHub. Cada paquete viene firmado con la
//! clave del updater (minisign, independiente de la firma de Apple): por eso también se actualiza
//! en Mac con firma ad hoc. Se baja en segundo plano y se instala al elegir "Reiniciar para
//! actualizar" (en Mac también al salir de la app).
//!
//! En Mac no se instala con la app abierta: el updater reemplaza el paquete en el lugar, y macOS
//! valida los permisos (Accesibilidad, micrófono) contra el código en disco. Con el paquete nuevo
//! debajo del proceso viejo, `AXIsProcessTrusted` daba false hasta reiniciar aunque la llave
//! siguiera prendida: el pegado dejaba de andar horas después de cada actualización.
//!
//! Sola: busca 20 s después de abrir y cada 4 horas, baja en segundo plano y avisa sin cortar nada
//! (un aviso del sistema y "Reiniciar para actualizar" en los menús). Se instala al elegir
//! "Reiniciar para actualizar" (en Mac también al salir de la app).
//!
//! Desde el menú ("Buscar actualizaciones"): siempre contesta con un diálogo nativo (al día, bajando,
//! lista para reiniciar o el error en palabras). Antes solo mandaba un aviso del sistema, que macOS
//! no muestra con la app adelante, y varios caminos (error, ya lista, otra búsqueda en curso) no
//! contestaban nada.
//!
//! Reiniciar nunca corta una grabación ni un dictado: con algo grabando, se pide terminarlo antes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult, MessageLevel};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::state::{AppState, Phase};
use crate::strings::{fill, t};

/// La versión bajada espera al reinicio (Windows: el instalador; Mac: el paquete, también hasta salir).
static DOWNLOADED: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = Mutex::new(None);

/// Alguien eligió "Buscar actualizaciones" mientras ya se buscaba (o bajaba): la búsqueda en curso
/// le contesta al terminar.
static ASKED: AtomicBool = AtomicBool::new(false);

/// Cada cuánto se busca sola una versión nueva.
pub const CHECK_EVERY_SECS: u64 = 4 * 3600;
/// El pedido del feed. La descarga tiene el suyo: 30 s no alcanzan para el paquete con poca red.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// La build trae clave pública del updater (sin ella el plugin no verifica nada y no se usa).
pub fn enabled(app: &AppHandle) -> bool {
    !cfg!(debug_assertions) && app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str()).is_some_and(|k| !k.is_empty())
}

/// Lo que se le contesta a la persona.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Esta build no trae firma de actualizaciones.
    Off,
    /// Al día, con la versión instalada.
    UpToDate(String),
    /// Hay versión nueva y se está bajando.
    Downloading(String),
    /// Bajada (en Mac, ya instalada): falta reiniciar.
    Ready(String),
    /// Falló: la clave del texto (updateErr*) y el detalle técnico.
    Failed(&'static str, String),
    /// Pidió reiniciar con una grabación o un dictado en curso.
    Busy,
}

/// Título y texto del diálogo de cada resultado.
pub fn message(l: &str, o: &Outcome) -> (String, String) {
    match o {
        Outcome::Off => (t(l, "upToDate"), t(l, "updatesOff")),
        Outcome::UpToDate(v) => (t(l, "upToDate"), fill(&t(l, "upToDateVersion"), &[("v", v)])),
        Outcome::Downloading(v) => (fill(&t(l, "updateDownloadingTitle"), &[("v", v)]), t(l, "updateDownloadingBody")),
        Outcome::Ready(v) => (t(l, "updateReady"), fill(&t(l, "updateReadyBody"), &[("v", v)])),
        Outcome::Failed(key, detail) => {
            let text = t(l, key);
            (t(l, "updateFailed"), if detail.is_empty() { text } else { format!("{text}\n\n{detail}") })
        }
        Outcome::Busy => (t(l, "updateWaitBusy"), t(l, "updateWaitBusyBody")),
    }
}

/// Qué explicación corresponde a cada error del updater.
pub fn error_key(e: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Reqwest(_) | E::Network(_) => "updateErrNetwork",
        E::ReleaseNotFound | E::Serialization(_) | E::Semver(_) | E::TargetNotFound(_) | E::TargetsNotFound(_) | E::UnsupportedOs | E::UnsupportedArch => "updateErrFeed",
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) | E::SignedVersionMismatch { .. } | E::MissingSignedVersion => "updateErrSignature",
        E::Io(_) | E::TempDirNotOnSameMountPoint | E::PreviousAppNotRestored(_) | E::AuthenticationFailed | E::FailedToDetermineExtractPath | E::BinaryNotFoundInArchive | E::TempDirNotFound => "updateErrInstall",
        _ => "updateErrOther",
    }
}

fn failed(e: &tauri_plugin_updater::Error) -> Outcome {
    Outcome::Failed(error_key(e), e.to_string())
}

/// Algo graba o dicta: reiniciar (o correr el instalador de Windows) lo cortaría.
pub fn busy(app: &AppHandle) -> bool {
    let st = app.state::<AppState>();
    let dictating = st.dictation.lock().unwrap().phase != Phase::Idle;
    let meeting = st.recording.lock().unwrap().is_some();
    is_busy(dictating, meeting, crate::rec_overlay::active(), crate::system_audio::running())
}

pub fn is_busy(dictating: bool, meeting: bool, screen: bool, system_audio: bool) -> bool {
    dictating || meeting || screen || system_audio
}

/// Diálogo nativo (rfd, como tauri-plugin-dialog; ese plugin no se usa porque reemplaza
/// window.alert y window.confirm en todas las páginas). Se arma en el hilo principal y se espera en
/// otro: no traba la app. Ready ofrece reiniciar.
fn tell(app: &AppHandle, o: Outcome) {
    let l = app.state::<AppState>().locale;
    let (title, body) = message(l, &o);
    let restart = t(l, "restartToUpdate");
    let offers_restart = matches!(o, Outcome::Ready(_));
    let (level, buttons) = match o {
        Outcome::Ready(_) => (MessageLevel::Info, MessageButtons::OkCancelCustom(restart.clone(), t(l, "updateLater"))),
        Outcome::Failed(..) => (MessageLevel::Error, MessageButtons::Ok),
        Outcome::Busy => (MessageLevel::Warning, MessageButtons::Ok),
        _ => (MessageLevel::Info, MessageButtons::Ok),
    };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let shown = AsyncMessageDialog::new().set_title(&title).set_description(&body).set_level(level).set_buttons(buttons).show();
        std::thread::spawn(move || {
            let chose = tauri::async_runtime::block_on(shown);
            if offers_restart && chose_restart(&chose, &restart) {
                restart_to_update(&a);
            }
        });
    });
}

/// Mac y Windows devuelven el texto del botón elegido; otros, Ok.
fn chose_restart(chose: &MessageDialogResult, label: &str) -> bool {
    match chose {
        MessageDialogResult::Ok => true,
        MessageDialogResult::Custom(s) => s == label,
        _ => false,
    }
}

fn set_info(app: &AppHandle, f: impl FnOnce(&mut crate::state::UpdateInfo)) {
    {
        let st = app.state::<AppState>();
        let mut info = st.update.lock().unwrap();
        f(&mut info);
    }
    crate::commands::refresh_settings(app);
}

fn ready_version(app: &AppHandle) -> Option<String> {
    app.state::<AppState>().update_ready.lock().unwrap().clone()
}

fn log_check(app: &AppHandle, interactive: bool, result: crate::privacy::Tag) {
    use crate::privacy::{Event, Kind, Tag};
    crate::privacy::record(app, Event::new(Kind::UpdateCheck).trigger(if interactive { Tag::Manual } else { Tag::Auto }).result(result).host_of(&crate::api::server(app)));
}

/// Busca una versión nueva y, si hay, la baja y la deja esperando ("Reiniciar para actualizar";
/// en Mac también al salir). `interactive`: lo pidió la persona (menú o Ajustes): se avisa
/// también si está al día.
pub async fn check(app: &AppHandle, interactive: bool) {
    if !enabled(app) {
        if interactive {
            tell(app, Outcome::Off);
        }
        return;
    }
    // Ya bajada: no hace falta otra búsqueda para ofrecer el reinicio.
    if interactive {
        if let Some(v) = ready_version(app) {
            return tell(app, Outcome::Ready(v));
        }
    }
    let started = {
        let st = app.state::<AppState>();
        let mut info = st.update.lock().unwrap();
        !std::mem::replace(&mut info.checking, true)
    };
    if !started {
        if interactive {
            ASKED.store(true, Ordering::SeqCst);
        }
        return;
    }
    crate::commands::refresh_settings(app);
    let (outcome, fresh) = run(app, interactive).await;
    set_info(app, |i| {
        i.checking = false;
        i.failed = matches!(outcome, Outcome::Failed(..));
        i.checked_at = Some(crate::state::now_ms());
    });
    crate::tray::refresh_menus(app);
    let asked = ASKED.swap(false, Ordering::SeqCst) || interactive;
    if asked {
        return tell(app, outcome);
    }
    // Sola: un aviso que no interrumpe, una vez por versión. Los menús ya ofrecen reiniciar.
    if let (Outcome::Ready(v), true) = (&outcome, fresh) {
        let l = app.state::<AppState>().locale;
        let _ = app.notification().builder().title(t(l, "updateReady")).body(fill(&t(l, "updateReadyBody"), &[("v", v)])).show();
    }
}

/// La búsqueda y la descarga. `fresh`: la versión quedó lista recién ahora.
async fn run(app: &AppHandle, interactive: bool) -> (Outcome, bool) {
    let feed = format!("{}/api/desktop/update/latest.json", crate::api::server(app));
    let url = match url::Url::parse(&feed) {
        Ok(u) => u,
        Err(e) => return (Outcome::Failed("updateErrOther", e.to_string()), false),
    };
    // El plugin se presenta como tauri-plugin-updater/<versión>; acá va el de la app, como sus
    // otros pedidos (api.rs). Un encabezado del pedido pisa el del cliente (reqwest).
    let updater = match app.updater_builder().endpoints(vec![url]).and_then(|b| b.header("user-agent", crate::api::USER_AGENT)).and_then(|b| b.timeout(CHECK_TIMEOUT).build()) {
        Ok(u) => u,
        Err(e) => return (failed(&e), false),
    };
    let mut update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            log_check(app, interactive, crate::privacy::Tag::Ok);
            return (Outcome::UpToDate(app.package_info().version.to_string()), false);
        }
        Err(e) => {
            log_check(app, interactive, crate::privacy::Tag::Failed);
            return (failed(&e), false);
        }
    };
    let version = update.version.clone();
    log_check(app, interactive, crate::privacy::Tag::Update);
    // Se sabe que hay versión nueva antes de bajarla: Ajustes y los menús ya lo muestran.
    set_info(app, |i| i.available = Some(version.clone()));
    if ready_version(app).as_deref() == Some(version.as_str()) {
        return (Outcome::Ready(version), false);
    }
    crate::tray::refresh_menus(app);
    if interactive || ASKED.load(Ordering::SeqCst) {
        tell(app, Outcome::Downloading(version.clone()));
    }
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(b) => b,
        Err(e) => return (failed(&e), false),
    };
    // Mac: no se instala con la app abierta (los permisos se validan contra el código en disco);
    // queda bajada para "Reiniciar para actualizar" o para cuando se cierre la app.
    *DOWNLOADED.lock().unwrap() = Some((update, bytes));
    *app.state::<AppState>().update_ready.lock().unwrap() = Some(version.clone());
    (Outcome::Ready(version), true)
}

/// "Reiniciar para actualizar" (menús, Ajustes y el diálogo). Con algo grabando no reinicia.
pub fn restart_to_update(app: &AppHandle) {
    if busy(app) {
        return tell(app, Outcome::Busy);
    }
    if let Some((update, bytes)) = DOWNLOADED.lock().unwrap().take() {
        // Mac: reemplaza el paquete y el reinicio abre el nuevo. Windows: corre el instalador
        // (pasivo) y la app se cierra; el instalador la vuelve a abrir.
        let _ = update.install(bytes);
    }
    app.restart();
}

/// Mac: al salir, instala la versión que quedó bajada (el próximo arranque ya es la nueva).
pub fn install_on_exit() {
    if !cfg!(target_os = "macos") {
        return;
    }
    // try_lock: si otro hilo la tiene (un reinicio en curso), ese se encarga.
    let taken = DOWNLOADED.try_lock().ok().and_then(|mut d| d.take());
    if let Some((update, bytes)) = taken {
        let _ = update.install(bytes);
    }
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            check(&app, false).await;
            tokio::time::sleep(Duration::from_secs(CHECK_EVERY_SECS)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_updater::Error as E;

    #[test]
    fn every_outcome_has_words() {
        for l in ["en", "es", "pt"] {
            for o in [
                Outcome::Off,
                Outcome::UpToDate("0.3.9".into()),
                Outcome::Downloading("0.4.0".into()),
                Outcome::Ready("0.4.0".into()),
                Outcome::Failed("updateErrNetwork", "timeout".into()),
                Outcome::Busy,
            ] {
                let (title, body) = message(l, &o);
                // t() devuelve la clave si falta el texto: ninguna puede quedar como clave.
                for s in [&title, &body] {
                    assert!(!s.is_empty() && !s.starts_with("update") && !s.starts_with("upTo"), "{l} {o:?}: {s}");
                    assert!(!s.contains('{'), "{l} {o:?}: sin rellenar: {s}");
                }
            }
        }
    }

    #[test]
    fn up_to_date_names_the_version() {
        assert_eq!(message("en", &Outcome::UpToDate("0.3.9".into())).1, "You're up to date (v0.3.9).");
        assert!(message("en", &Outcome::Downloading("0.4.0".into())).0.contains("v0.4.0"));
        assert!(message("es", &Outcome::Ready("0.4.0".into())).1.contains("0.4.0"));
    }

    #[test]
    fn failures_explain_and_keep_the_detail() {
        let (title, body) = message("en", &failed(&E::ReleaseNotFound));
        assert_eq!(title, "Couldn't update zerosoft");
        assert!(body.starts_with("The update server answered without a version"), "{body}");
        assert!(body.lines().count() > 1, "lleva el detalle: {body}");
    }

    #[test]
    fn errors_map_to_readable_reasons() {
        assert_eq!(error_key(&E::Network("502".into())), "updateErrNetwork");
        assert_eq!(error_key(&E::ReleaseNotFound), "updateErrFeed");
        assert_eq!(error_key(&E::TargetNotFound("darwin-aarch64".into())), "updateErrFeed");
        assert_eq!(error_key(&E::MissingSignedVersion), "updateErrSignature");
        assert_eq!(error_key(&E::SignatureUtf8("x".into())), "updateErrSignature");
        assert_eq!(error_key(&E::TempDirNotOnSameMountPoint), "updateErrInstall");
        assert_eq!(error_key(&E::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied))), "updateErrInstall");
        assert_eq!(error_key(&E::EmptyEndpoints), "updateErrOther");
    }

    #[test]
    fn never_restarts_over_a_recording() {
        assert!(!is_busy(false, false, false, false));
        assert!(is_busy(true, false, false, false), "dictado");
        assert!(is_busy(false, true, false, false), "reunión");
        assert!(is_busy(false, false, true, false), "Rec");
        assert!(is_busy(false, false, false, true), "audio del sistema");
    }
}
