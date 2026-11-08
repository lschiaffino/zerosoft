//! HUD de dictado: ventana chica, transparente, sin foco y siempre encima, abajo al centro de la
//! pantalla donde está el puntero. Muestra el estado, el nivel y el reloj (ui/hud.html).

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "hud";
const W: f64 = 400.0;
const H: f64 = 56.0;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HudState {
    pub phase: &'static str,
    pub label: String,
    pub hint: String,
    /// ms desde epoch cuando empezó a grabar (el reloj lo calcula el HUD).
    pub started_at: Option<u64>,
    pub max_ms: u64,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("hud.html".into()))
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
        .focusable(false)
        .visible(false)
        .build()?;
    let _ = win.set_ignore_cursor_events(true);
    Ok(())
}

fn place(app: &AppHandle) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
        let (w, h) = (area.size.width as f64 / scale, area.size.height as f64 / scale);
        let _ = win.set_size(LogicalSize::new(W, H));
        let _ = win.set_position(LogicalPosition::new(x + (w - W) / 2.0, y + h - H - 24.0));
    }
}

pub fn show(app: &AppHandle, state: HudState) {
    let _ = create(app);
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let hidden = state.phase == "hidden";
    let _ = app.emit_to(LABEL, "hud://state", state);
    if hidden {
        let _ = win.hide();
    } else if !win.is_visible().unwrap_or(false) {
        place(app);
        let _ = win.show();
    }
}

pub fn level(app: &AppHandle, level: f32) {
    let _ = app.emit_to(LABEL, "hud://level", level);
}
