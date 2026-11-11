//! Indicador de grabación (como el de Granola): mientras una reunión se graba en la ventana
//! principal y esa ventana no está adelante (minimizada, escondida o detrás de otra app), un
//! rectángulo negro chico, siempre encima, con un punto rojo que late. Clic: abre la reunión.
//! Al pasar el mouse se estira hacia la izquierda y muestra el tiempo; clic derecho: menú con
//! Abrir, Cortar y Ocultar. Se arrastra a cualquier lado y la posición se recuerda
//! (settings.indicator_pos). La página avisa que graba por el puente (desktop_recording); cortar
//! le manda a la página el evento `zerosoft:stop-recording`.
//! Se apaga en Ajustes › Reuniones (por defecto, prendido).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::state::{AppState, Recording};

pub const LABEL: &str = "indicator";
/// Cerrado: solo el punto.
const W: f64 = 44.0;
/// Con el mouse encima: el punto y el reloj.
const W_OPEN: f64 = 96.0;
const H: f64 = 28.0;
const MARGIN: f64 = 12.0;
/// Está estirado (el borde derecho queda donde estaba).
static EXPANDED: AtomicBool = AtomicBool::new(false);
/// Sube con cada movimiento: solo el último guarda la posición.
static MOVES: AtomicU64 = AtomicU64::new(0);
/// La persona lo cerró con la ×: no vuelve hasta la próxima grabación.
static DISMISSED: AtomicBool = AtomicBool::new(false);

/// Path de una página de la app que se puede abrir desde el indicador.
pub fn valid_path(p: &str) -> bool {
    p.starts_with("/app/") && p.len() <= 200 && !p.contains("//") && !p.contains("..") && p.chars().all(|c| c.is_ascii_alphanumeric() || "/-_".contains(c))
}

/// Se muestra si la pestaña que graba no está adelante y: hay una reunión grabándose y está
/// prendido en Ajustes, o la app está capturando el audio de la computadora. Lo segundo no depende
/// del ajuste ni de lo que avise la página: la captura es nativa y siempre se marca. La persona
/// lo puede cerrar para esta grabación (`dismissed`); el punto de la barra de menú queda igual.
pub fn should_show(meeting: bool, system_audio: bool, enabled: bool, dismissed: bool, main_in_front: bool) -> bool {
    !dismissed && !main_in_front && ((meeting && enabled) || system_audio)
}

/// Lo que muestra el indicador: la reunión que avisó la página o, si la app captura el audio de
/// la computadora sin que la página haya avisado nada, esa captura desde que empezó.
pub fn current(app: &AppHandle) -> Option<Recording> {
    let rec = app.state::<AppState>().recording.lock().unwrap().clone();
    rec.or_else(|| crate::system_audio::started_at().map(|t| Recording { started_at: t, path: String::new() }))
}

/// Empezó una captura nueva: el indicador vuelve aunque se haya cerrado en la anterior.
pub fn undismiss() {
    DISMISSED.store(false, Ordering::Relaxed);
}

/// La pestaña que graba está a la vista (tabs.rs).
fn main_in_front(app: &AppHandle) -> bool {
    crate::tabs::recording_in_front(app)
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let mut b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("indicator.html".into()));
    // La posición va en la creación: un set_position justo después de crearla no siempre vale.
    if let Some((x, y)) = target(app) {
        b = b.position(x, y);
    }
    EXPANDED.store(false, Ordering::Relaxed);
    b.title("zerosoft")
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

/// Donde la dejó la persona (si sigue dentro de algún monitor) o arriba a la derecha del monitor
/// de la ventana principal (en coordenadas lógicas).
fn target(app: &AppHandle) -> Option<(f64, f64)> {
    let saved = app.state::<AppState>().settings.lock().unwrap().indicator_pos;
    if let Some((x, y)) = saved {
        let visible = app.available_monitors().unwrap_or_default().iter().any(|m| {
            let s = m.scale_factor();
            let (mx, my) = (m.position().x as f64 / s, m.position().y as f64 / s);
            let (mw, mh) = (m.size().width as f64 / s, m.size().height as f64 / s);
            on_screen((x, y), (mx, my, mw, mh))
        });
        if visible {
            return Some((x, y));
        }
    }
    let m = app
        .get_window(&crate::tabs::focused_label(app))
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let scale = m.scale_factor();
    let area = m.work_area();
    let (x, y) = (area.position.x as f64 / scale, area.position.y as f64 / scale);
    let w = area.size.width as f64 / scale;
    Some((x + w - W - MARGIN, y + MARGIN))
}

fn place(app: &AppHandle) {
    let (Some(win), Some((x, y))) = (app.get_webview_window(LABEL), target(app)) else { return };
    let _ = win.set_position(LogicalPosition::new(x, y));
}

/// Recalcula si se ve. Se llama cuando cambia la grabación, el foco de la ventana o el ajuste.
pub fn update(app: &AppHandle) {
    let app2 = app.clone();
    // Ventanas y foco, en el hilo principal.
    let _ = app.run_on_main_thread(move || {
        let st = app2.state::<AppState>();
        let meeting = st.recording.lock().unwrap().is_some();
        let rec = current(&app2);
        let enabled = st.settings.lock().unwrap().recording_indicator;
        let show = should_show(meeting, crate::system_audio::running(), enabled, DISMISSED.load(Ordering::Relaxed), main_in_front(&app2));
        if show {
            if create(&app2).is_err() {
                return;
            }
            let _ = app2.emit_to(LABEL, "indicator://state", rec);
            if let Some(w) = app2.get_webview_window(LABEL) {
                if !w.is_visible().unwrap_or(false) {
                    let _ = w.show();
                    place(&app2);
                }
            }
        } else if let Some(w) = app2.get_webview_window(LABEL) {
            expand(&app2, false);
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

/// Mouse encima o afuera: se estira hacia la izquierda para mostrar el reloj (o vuelve).
pub fn expand(app: &AppHandle, open: bool) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    if EXPANDED.swap(open, Ordering::Relaxed) == open {
        return;
    }
    let scale = w.scale_factor().unwrap_or(1.0);
    let Ok(pos) = w.outer_position() else { return };
    let (x, y) = (pos.x as f64 / scale, pos.y as f64 / scale);
    let dx = W_OPEN - W;
    let (nx, nw) = if open { (x - dx, W_OPEN) } else { (x + dx, W) };
    let _ = w.set_size(LogicalSize::new(nw, H));
    let _ = w.set_position(LogicalPosition::new(nx, y));
}

/// La ventana del indicador se movió (arrastre o estirarse): se recuerda dónde queda cerrado,
/// medio segundo después del último movimiento.
pub fn moved(app: &AppHandle, x: f64, y: f64) {
    let closed_x = if EXPANDED.load(Ordering::Relaxed) { x + (W_OPEN - W) } else { x };
    if !crate::config::valid_pos(closed_x, y) {
        return;
    }
    let n = MOVES.fetch_add(1, Ordering::Relaxed) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if MOVES.load(Ordering::Relaxed) != n {
            return;
        }
        let st = app.state::<AppState>();
        let mut s = st.settings.lock().unwrap();
        if s.indicator_pos != Some((closed_x, y)) {
            s.indicator_pos = Some((closed_x, y));
            let _ = crate::config::save(&st.config_dir, &s);
        }
    });
}

/// Clic derecho: Abrir, Cortar y Ocultar (menú del sistema).
pub fn menu(app: &AppHandle) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let l = app.state::<AppState>().locale;
    let t = |k: &str| crate::strings::t(l, k);
    let built = (|| {
        MenuBuilder::new(app)
            .item(&MenuItem::with_id(app, "ind-open", t("indicatorOpen"), true, None::<&str>)?)
            .item(&MenuItem::with_id(app, "ind-stop", t("indicatorStop"), true, None::<&str>)?)
            .separator()
            .item(&MenuItem::with_id(app, "ind-hide", t("indicatorHide"), true, None::<&str>)?)
            .build()
    })();
    if let Ok(m) = built {
        let _ = w.popup_menu(&m);
    }
}

/// Lo elegido en el menú del indicador (llega por el manejador de menús de la app).
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    match id {
        "ind-open" => open(app),
        "ind-stop" => stop(app),
        "ind-hide" => dismiss(app),
        _ => return false,
    }
    true
}

/// ¿Una posición guardada cae dentro de un monitor (x, y, ancho, alto)? Con margen para que se
/// vea al menos una parte.
pub fn on_screen(pos: (f64, f64), m: (f64, f64, f64, f64)) -> bool {
    let (x, y) = pos;
    let (mx, my, mw, mh) = m;
    x + W > mx + 8.0 && x < mx + mw - 8.0 && y >= my - 4.0 && y < my + mh - H / 2.0
}

/// Ocultar (menú o Esc): no vuelve hasta la próxima grabación.
pub fn dismiss(app: &AppHandle) {
    DISMISSED.store(true, Ordering::Relaxed);
    update(app);
}

/// Cortar desde el indicador o la bandeja: la página corta como con su botón.
pub fn stop(app: &AppHandle) {
    if let Some(w) = crate::tabs::recording_webview(app) {
        let _ = w.eval("window.dispatchEvent(new Event('zerosoft:stop-recording'))");
    } else if crate::system_audio::running() {
        // Ninguna pestaña dijo que graba: la captura del audio de la computadora se corta acá.
        crate::system_audio::stop_because(crate::system_audio::Why::User);
    }
}

/// Abrir la reunión en la ventana principal.
pub fn open(app: &AppHandle) {
    // La pestaña que graba, adelante; si no se sabe cuál, la página de la reunión en la de adelante.
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if crate::tabs::focus_recording(&a) {
            return;
        }
        let path = a.state::<AppState>().recording.lock().unwrap().as_ref().map(|r| r.path.clone()).unwrap_or_default();
        if valid_path(&path) {
            crate::load_app_path(&a, &path);
        }
        crate::show_main(&a);
    });
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
    fn saved_position_must_be_on_a_screen() {
        let m = (0.0, 0.0, 1440.0, 900.0);
        assert!(on_screen((1384.0, 12.0), m));
        assert!(!on_screen((3000.0, 12.0), m));
        assert!(!on_screen((100.0, 2000.0), m));
        assert!(on_screen((-30.0, 100.0), m));
    }

    #[test]
    fn visibility() {
        assert!(should_show(true, false, true, false, false));
        assert!(!should_show(true, false, true, false, true));
        assert!(!should_show(true, false, false, false, false));
        assert!(!should_show(false, false, true, false, false));
        // El audio de la computadora se marca aunque el indicador esté apagado en Ajustes y aunque
        // la página no haya avisado que graba.
        assert!(should_show(false, true, false, false, false));
        assert!(should_show(true, true, false, false, false));
        assert!(!should_show(true, true, true, true, false));
    }
}
