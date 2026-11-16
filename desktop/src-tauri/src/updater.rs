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

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::state::AppState;
use crate::strings::{fill, t};

/// La versión bajada espera al reinicio (Windows: el instalador; Mac: el paquete, también hasta salir).
static DOWNLOADED: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = Mutex::new(None);

/// La build trae clave pública del updater (sin ella el plugin no verifica nada y no se usa).
pub fn enabled(app: &AppHandle) -> bool {
    !cfg!(debug_assertions) && app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str()).is_some_and(|k| !k.is_empty())
}

fn set_info(app: &AppHandle, f: impl FnOnce(&mut crate::state::UpdateInfo)) {
    {
        let st = app.state::<AppState>();
        let mut info = st.update.lock().unwrap();
        f(&mut info);
    }
    crate::commands::refresh_settings(app);
}

/// Cada cuánto se busca sola una versión nueva.
pub const CHECK_EVERY_SECS: u64 = 4 * 3600;

fn log_check(app: &AppHandle, interactive: bool, result: crate::privacy::Tag) {
    use crate::privacy::{Event, Kind, Tag};
    crate::privacy::record(app, Event::new(Kind::UpdateCheck).trigger(if interactive { Tag::Manual } else { Tag::Auto }).result(result).host_of(&crate::api::server(app)));
}

/// Busca una versión nueva y, si hay, la baja y la deja esperando ("Reiniciar para actualizar";
/// en Mac también al salir). `interactive`: lo pidió la persona (menú o Ajustes): se avisa
/// también si está al día.
pub async fn check(app: &AppHandle, interactive: bool) {
    let l = app.state::<AppState>().locale;
    if !enabled(app) {
        if interactive {
            let _ = app.notification().builder().title(t(l, "upToDate")).body(t(l, "updatesOff")).show();
        }
        return;
    }
    if app.state::<AppState>().update.lock().unwrap().checking {
        return;
    }
    set_info(app, |i| i.checking = true);
    let finish = |app: &AppHandle, failed: bool| {
        set_info(app, |i| {
            i.checking = false;
            i.failed = failed;
            i.checked_at = Some(crate::state::now_ms());
        })
    };
    let feed = format!("{}/api/desktop/update/latest.json", crate::api::server(app));
    let Ok(url) = url::Url::parse(&feed) else { return finish(app, true) };
    // El plugin se presenta como tauri-plugin-updater/<versión>; acá va el de la app, como sus
    // otros pedidos (api.rs). Un encabezado del pedido pisa el del cliente (reqwest).
    let Ok(builder) = app.updater_builder().endpoints(vec![url]).and_then(|b| b.header("user-agent", crate::api::USER_AGENT)) else { return finish(app, true) };
    let Ok(updater) = builder.timeout(Duration::from_secs(30)).build() else { return finish(app, true) };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        res => {
            log_check(app, interactive, if res.is_err() { crate::privacy::Tag::Failed } else { crate::privacy::Tag::Ok });
            finish(app, res.is_err());
            if interactive && res.is_ok() {
                let _ = app.notification().builder().title(t(l, "upToDate")).body(format!("v{}", app.package_info().version)).show();
            }
            return;
        }
    };
    let version = update.version.clone();
    log_check(app, interactive, crate::privacy::Tag::Update);
    // Se sabe que hay versión nueva antes de bajarla: Ajustes ya lo muestra.
    set_info(app, |i| i.available = Some(version.clone()));
    if app.state::<AppState>().update_ready.lock().unwrap().as_deref() == Some(version.as_str()) {
        return finish(app, false);
    }
    let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return finish(app, true) };
    *DOWNLOADED.lock().unwrap() = Some((update, bytes));
    *app.state::<AppState>().update_ready.lock().unwrap() = Some(version.clone());
    finish(app, false);
    crate::tray::rebuild(app);
    let _ = app.notification().builder().title(t(l, "updateReady")).body(fill(&t(l, "updateReadyBody"), &[("v", &version)])).show();
}

/// "Reiniciar para actualizar".
pub fn restart_to_update(app: &AppHandle) {
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
