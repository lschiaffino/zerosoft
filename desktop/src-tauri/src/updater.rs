//! Actualizaciones con el updater de Tauri. Feed: <servidor>/api/desktop/update/latest.json, que
//! sirve el latest.json del último release desktop-v* de GitHub. Cada paquete viene firmado con la
//! clave del updater (minisign, independiente de la firma de Apple): por eso también se actualiza
//! en Mac con firma ad hoc. Se baja en segundo plano; en Mac se instala en el lugar y vale al
//! reiniciar; en Windows el instalador corre al elegir "Reiniciar para actualizar".

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use crate::state::AppState;
use crate::strings::{fill, t};

/// Windows: el instalador bajado espera al reinicio.
static DOWNLOADED: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> = Mutex::new(None);

/// La build trae clave pública del updater (sin ella el plugin no verifica nada y no se usa).
pub fn enabled(app: &AppHandle) -> bool {
    !cfg!(debug_assertions) && app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str()).is_some_and(|k| !k.is_empty())
}

pub async fn check(app: &AppHandle, interactive: bool) {
    let l = app.state::<AppState>().locale;
    if !enabled(app) {
        if interactive {
            let _ = app.notification().builder().title(t(l, "upToDate")).body(t(l, "updatesOff")).show();
        }
        return;
    }
    let feed = format!("{}/api/desktop/update/latest.json", crate::api::server(app));
    let Ok(url) = url::Url::parse(&feed) else { return };
    let Ok(builder) = app.updater_builder().endpoints(vec![url]) else { return };
    let Ok(updater) = builder.timeout(Duration::from_secs(30)).build() else { return };
    let update = match updater.check().await {
        Ok(Some(u)) => u,
        _ => {
            if interactive {
                let _ = app.notification().builder().title(t(l, "upToDate")).body(format!("v{}", app.package_info().version)).show();
            }
            return;
        }
    };
    let version = update.version.clone();
    let Ok(bytes) = update.download(|_, _| {}, || {}).await else { return };
    if cfg!(target_os = "macos") {
        if update.install(&bytes).is_err() {
            return;
        }
    } else {
        *DOWNLOADED.lock().unwrap() = Some((update, bytes));
    }
    *app.state::<AppState>().update_ready.lock().unwrap() = Some(version.clone());
    crate::tray::rebuild(app);
    let _ = app.notification().builder().title(t(l, "updateReady")).body(fill(&t(l, "updateReadyBody"), &[("v", &version)])).show();
}

/// "Reiniciar para actualizar".
pub fn restart_to_update(app: &AppHandle) {
    if let Some((update, bytes)) = DOWNLOADED.lock().unwrap().take() {
        // Windows: corre el instalador (pasivo) y la app se cierra; el instalador la vuelve a abrir.
        let _ = update.install(bytes);
    }
    app.restart();
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            check(&app, false).await;
            tokio::time::sleep(Duration::from_secs(4 * 3600)).await;
        }
    });
}
