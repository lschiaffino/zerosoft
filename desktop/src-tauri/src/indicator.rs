//! Indicador de grabación (como el de Granola): mientras una reunión se graba en la ventana
//! principal y esa ventana no está adelante (minimizada, escondida o detrás de otra app), un
//! recuadro chico y siempre encima, arriba a la derecha, muestra que se está grabando, el reloj, y
//! deja abrir la reunión o cortar. La página avisa que graba por el puente (desktop_recording);
//! cortar le manda a la página el evento `zerosoft:stop-recording`.
//! Se apaga en Ajustes › General (por defecto, prendido).

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::{AppState, Recording};

pub const LABEL: &str = "indicator";
const W: f64 = 248.0;
const H: f64 = 44.0;
const MARGIN: f64 = 12.0;
/// La persona lo cerró con la ×: no vuelve hasta la próxima grabación.
static DISMISSED: AtomicBool = AtomicBool::new(false);

/// Path de una página de la app que se puede abrir desde el indicador.
pub fn valid_path(p: &str) -> bool {
    p.starts_with("/app/") && p.len() <= 200 && !p.contains("//") && !p.contains("..") && p.chars().all(|c| c.is_ascii_alphanumeric() || "/-_".contains(c))
}

/// Se muestra si hay grabación, está prendido en Ajustes y la ventana principal no está adelante.
pub fn should_show(recording: bool, enabled: bool, main_in_front: bool) -> bool {
    recording && enabled && !main_in_front
}

fn main_in_front(app: &AppHandle) -> bool {
    let Some(w) = app.get_webview_window("main") else { return false };
    w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false)
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("indicator.html".into()))
        .title("zerosoft")
        .inner_size(W, H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        // Sin robar el foco a la app de la llamada; el primer clic ya cuenta.
        .focusable(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
    Ok(())
}

fn place(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let w = area.size.width as f64 / scale;
        let _ = win.set_position(LogicalPosition::new(x + w - W - MARGIN, y + MARGIN));
    }
}

/// Recalcula si se ve. Se llama cuando cambia la grabación, el foco de la ventana o el ajuste.
pub fn update(app: &AppHandle) {
    let app2 = app.clone();
    // Ventanas y foco, en el hilo principal.
    let _ = app.run_on_main_thread(move || {
        let st = app2.state::<AppState>();
        let rec = st.recording.lock().unwrap().clone();
        let enabled = st.settings.lock().unwrap().recording_indicator;
        let show = should_show(rec.is_some(), enabled && !DISMISSED.load(Ordering::Relaxed), main_in_front(&app2));
        if show {
            if create(&app2).is_err() {
                return;
            }
            let _ = app2.emit_to(LABEL, "indicator://state", rec);
            if let Some(w) = app2.get_webview_window(LABEL) {
                if !w.is_visible().unwrap_or(false) {
                    place(&app2);
                    let _ = w.show();
                }
            }
        } else if let Some(w) = app2.get_webview_window(LABEL) {
            let _ = w.hide();
        }
    });
}

/// La página empezó o terminó de grabar.
pub fn set_recording(app: &AppHandle, rec: Option<Recording>) {
    {
        let st = app.state::<AppState>();
        let mut cur = st.recording.lock().unwrap();
        if *cur == rec {
            return;
        }
        *cur = rec;
    }
    DISMISSED.store(false, Ordering::Relaxed);
    crate::tray::rebuild(app);
    update(app);
}

/// La × del indicador.
pub fn dismiss(app: &AppHandle) {
    DISMISSED.store(true, Ordering::Relaxed);
    update(app);
}

/// Cortar desde el indicador o la bandeja: la página corta como con su botón.
pub fn stop(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval("window.dispatchEvent(new Event('zerosoft:stop-recording'))");
    }
}

/// Abrir la reunión en la ventana principal.
pub fn open(app: &AppHandle) {
    let path = app.state::<AppState>().recording.lock().unwrap().as_ref().map(|r| r.path.clone()).unwrap_or_default();
    if valid_path(&path) {
        let current = app.get_webview_window("main").and_then(|w| w.url().ok()).map(|u| u.path().to_string()).unwrap_or_default();
        if current != path {
            crate::load_app_path(app, &path);
        }
    }
    crate::show_main(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert!(valid_path("/app/voice/meetings/abc_123-x"));
        for bad in ["/voice", "/app//x", "/app/../admin", "https://evil.com/app/x", "/app/x?y=1", "/app/x#h", ""] {
            assert!(!valid_path(bad), "{bad}");
        }
    }

    #[test]
    fn visibility() {
        assert!(should_show(true, true, false));
        assert!(!should_show(true, true, true));
        assert!(!should_show(true, false, false));
        assert!(!should_show(false, true, false));
    }
}
