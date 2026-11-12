//! Rec en la app de escritorio, como Loom: mientras la página graba (components/rec/Recorder.tsx),
//! una barra flotante (ui/recbar.*) con el reloj, el micrófono, pausar o seguir, terminar,
//! empezar de nuevo y descartar; y, con pantalla y cámara grabando la pantalla entera, la burbuja
//! redonda de la cámara (ui/recbubble.*). Las dos quedan encima de las otras apps y se arrastran.
//!
//! - La página cuenta su estado por el puente (`desktop_rec_overlay`, `desktop_rec_level`). Lo que
//!   se toca en la barra o la burbuja, y los atajos globales mientras graba (Alt+Shift+P pausa o
//!   sigue, Alt+Shift+S termina; en Mac, Option), vuelve a esa página como el evento
//!   `zerosoft:rec-control` con un control de una lista fija (lib/rec-controls.ts).
//! - Captura: la barra se excluye de la grabación (`content_protected`: NSWindowSharingNone en Mac,
//!   WDA_EXCLUDEFROMCAPTURE en Windows 10 2004 o más). La burbuja no: es la que pone la cara en el
//!   video, porque la captura de pantalla la graba. La página deja de dibujar la cara en el video
//!   mientras la burbuja está, así no sale dos veces.
//! - La burbuja abre la cámara ella misma (página local; el permiso de cámara se le da solo a ella).
//!   Si no puede, avisa (`bubble-failed`) y la página vuelve a dibujar la cara en el video.
//! - Dónde quedaron la burbuja y la barra, y el tamaño de la burbuja, se recuerdan mientras la app
//!   está abierta.

use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::commands::{from_app, CmdResult};
use crate::state::{now_ms, AppState};

pub const BAR: &str = "recbar";
pub const BUBBLE: &str = "recbubble";
const BAR_W: f64 = 392.0;
const BAR_H: f64 = 44.0;
const SMALL: f64 = 168.0;
const LARGE: f64 = 280.0;
const MARGIN: f64 = 24.0;
const GAP: f64 = 12.0;
/// Atajos globales mientras se graba (los mismos que la página).
const SHORTCUTS: [(&str, &str); 2] = [("Alt+Shift+P", "toggle"), ("Alt+Shift+S", "stop")];
/// Lo que la barra puede pedirle a la página.
const PAGE_CONTROLS: [&str; 8] = ["pause", "resume", "toggle", "stop", "restart", "discard", "mute", "unmute"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecView {
    pub phase: &'static str,
    /// Lo grabado (sin pausas) cuando llegó el estado.
    pub elapsed_ms: u64,
    /// ms desde epoch en que llegó: con `recording`, la barra sigue contando desde acá.
    pub at: u64,
    pub mic: &'static str,
    pub camera: bool,
    pub bubble_visible: bool,
    pub bubble_large: bool,
}

struct Session {
    /// Webview de la pestaña que graba ("tab-<id>").
    webview: String,
    view: RecView,
    /// Nombre de la cámara elegida en la página ("" = la de siempre).
    camera_label: String,
}

#[derive(Clone, Copy)]
struct Places {
    bubble: Option<(f64, f64)>,
    bar: Option<(f64, f64)>,
    large: bool,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static PLACES: Mutex<Places> = Mutex::new(Places { bubble: None, bar: None, large: false });

// ---------- Validación (lo que manda la página) ----------

/// Rec está grabando (lo avisó la página).
pub fn active() -> bool {
    SESSION.lock().map(|s| s.is_some()).unwrap_or(false)
}

/// Anota en el registro cuándo Rec empieza y termina de grabar, y actualiza el indicador nativo.
fn track(app: &AppHandle, on: bool) {
    use crate::privacy::{Event, Kind, Tag};
    let st = app.state::<crate::state::AppState>();
    let mut since = st.screen_since.lock().unwrap();
    match (on, *since) {
        (true, None) => {
            *since = Some(now_ms());
            crate::privacy::record(app, Event::new(Kind::ScreenStart).trigger(Tag::Page));
        }
        (false, Some(t)) => {
            *since = None;
            crate::privacy::record(app, Event::new(Kind::ScreenStop).trigger(Tag::Page).duration(now_ms().saturating_sub(t)));
        }
        _ => return,
    }
    drop(since);
    crate::tray::rebuild(app);
}

pub fn parse_phase(p: &str) -> Option<&'static str> {
    ["countdown", "recording", "paused", "finishing"].into_iter().find(|x| *x == p)
}

pub fn parse_mic(m: &str) -> &'static str {
    ["on", "muted"].into_iter().find(|x| *x == m).unwrap_or("none")
}

/// Nombre de cámara razonable (corto, sin caracteres de control); si no, la de siempre.
pub fn clean_label(l: &str) -> String {
    if l.chars().count() <= 200 && !l.chars().any(char::is_control) {
        l.to_string()
    } else {
        String::new()
    }
}

pub fn clean_elapsed(v: Option<f64>) -> u64 {
    v.filter(|v| v.is_finite() && *v >= 0.0 && *v < 86_400_000.0).map(|v| v as u64).unwrap_or(0)
}

pub fn clean_level(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Un control de la lista fija para la página (o None).
pub fn page_control(a: &str) -> Option<&'static str> {
    PAGE_CONTROLS.into_iter().chain(["bubble-failed"]).find(|x| *x == a)
}

/// El script que se evalúa en la página: solo controles de la lista fija.
pub fn control_script(c: &'static str) -> String {
    format!("window.dispatchEvent(new CustomEvent('zerosoft:rec-control',{{detail:'{c}'}}))")
}

// ---------- Lugar en pantalla (coordenadas lógicas) ----------

type Area = (f64, f64, f64, f64);

/// La ventana entera adentro del área (x, y, ancho, alto).
pub fn fit(pos: (f64, f64), size: (f64, f64), a: Area) -> (f64, f64) {
    let (ax, ay, aw, ah) = a;
    let x = pos.0.min(ax + aw - size.0).max(ax);
    let y = pos.1.min(ay + ah - size.1).max(ay);
    (x, y)
}

/// Cambiar de tamaño sin despegarse de la esquina más cercana (abajo a la izquierda se queda ahí).
pub fn resize_keep_corner(pos: (f64, f64), old: f64, new: f64, a: Area) -> (f64, f64) {
    let (ax, ay, aw, ah) = a;
    let (cx, cy) = (pos.0 + old / 2.0, pos.1 + old / 2.0);
    let x = if cx > ax + aw / 2.0 { pos.0 + old - new } else { pos.0 };
    let y = if cy > ay + ah / 2.0 { pos.1 + old - new } else { pos.1 };
    fit((x, y), (new, new), a)
}

/// Burbuja: abajo a la izquierda, como Loom.
pub fn default_bubble(a: Area, size: f64) -> (f64, f64) {
    let (ax, ay, _, ah) = a;
    (ax + MARGIN, ay + ah - size - MARGIN)
}

/// Barra: a la derecha de la burbuja, alineada abajo; sin burbuja, abajo a la izquierda.
pub fn default_bar(a: Area, bubble: Option<((f64, f64), f64)>) -> (f64, f64) {
    let (ax, ay, _, ah) = a;
    let p = match bubble {
        Some(((bx, by), s)) => (bx + s + GAP, by + s - BAR_H),
        None => (ax + MARGIN, ay + ah - BAR_H - MARGIN),
    };
    fit(p, (BAR_W, BAR_H), a)
}

fn monitor_area(m: &tauri::Monitor) -> Area {
    let s = m.scale_factor();
    let wa = m.work_area();
    (wa.position.x as f64 / s, wa.position.y as f64 / s, wa.size.width as f64 / s, wa.size.height as f64 / s)
}

/// El área del monitor donde está (o queda) un punto; si no, la del monitor de la pestaña que graba.
fn area_at(app: &AppHandle, p: Option<(f64, f64)>) -> Option<Area> {
    let monitors = app.available_monitors().unwrap_or_default();
    if let Some((x, y)) = p {
        if let Some(m) = monitors.iter().find(|m| {
            let (ax, ay, aw, ah) = monitor_area(m);
            x >= ax - 8.0 && x < ax + aw && y >= ay - 8.0 && y < ay + ah
        }) {
            return Some(monitor_area(m));
        }
    }
    let owner = SESSION.lock().unwrap().as_ref().map(|s| s.webview.clone());
    owner
        .and_then(|l| app.get_webview(&l))
        .and_then(|w| w.window().current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| monitor_area(&m))
}

// ---------- Ventanas ----------

fn base<'a>(app: &'a AppHandle, label: &'a str, page: &str, size: (f64, f64), pos: (f64, f64)) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title("zerosoft")
        .inner_size(size.0, size.1)
        .position(pos.0, pos.1)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        // Sin robarle el foco a la app que se graba; el primer clic ya cuenta.
        .focusable(false)
        .accept_first_mouse(true)
}

fn bubble_size(large: bool) -> f64 {
    if large {
        LARGE
    } else {
        SMALL
    }
}

/// Dónde va la burbuja (la última posición de esta sesión de la app, si sigue en un monitor).
fn bubble_place(app: &AppHandle, size: f64) -> Option<(f64, f64)> {
    let saved = PLACES.lock().unwrap().bubble;
    let a = area_at(app, saved)?;
    Some(match saved {
        Some(p) => fit(p, (size, size), a),
        None => default_bubble(a, size),
    })
}

fn ensure_bubble(app: &AppHandle) {
    if app.get_webview_window(BUBBLE).is_some() {
        return;
    }
    let large = PLACES.lock().unwrap().large;
    let size = bubble_size(large);
    let Some(pos) = bubble_place(app, size) else { return };
    let built = base(app, BUBBLE, "recbubble.html", (size, size), pos)
        // La cámara solo para la página local de la burbuja; nada más.
        .on_permission_request(|wv, kind| {
            let local = wv.url().map(|u| crate::nav::is_local(&u)).unwrap_or(false);
            match kind {
                PermissionKind::Camera if local => PermissionResponse::Allow,
                _ => PermissionResponse::Deny,
            }
        })
        .build();
    if built.is_ok() {
        PLACES.lock().unwrap().bubble = Some(pos);
    }
}

fn ensure_bar(app: &AppHandle, with_bubble: bool) {
    if app.get_webview_window(BAR).is_some() {
        return;
    }
    let saved = PLACES.lock().unwrap().bar;
    let Some(a) = area_at(app, saved) else { return };
    let pos = match saved {
        Some(p) => fit(p, (BAR_W, BAR_H), a),
        None => {
            let large = PLACES.lock().unwrap().large;
            let bubble = if with_bubble { bubble_place(app, bubble_size(large)).map(|p| (p, bubble_size(large))) } else { None };
            default_bar(a, bubble)
        }
    };
    // La barra no sale en la grabación (Mac: NSWindowSharingNone; Windows: WDA_EXCLUDEFROMCAPTURE).
    if base(app, BAR, "recbar.html", (BAR_W, BAR_H), pos).content_protected(true).build().is_ok() {
        PLACES.lock().unwrap().bar = Some(pos);
    }
}

fn destroy(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}

fn shortcuts(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    for (accel, control) in SHORTCUTS {
        if on {
            if !gs.is_registered(accel) {
                let _ = gs.on_shortcut(accel, move |app, _, ev| {
                    if ev.state == ShortcutState::Pressed {
                        send(app, control);
                    }
                });
            }
        } else if gs.is_registered(accel) {
            let _ = gs.unregister(accel);
        }
    }
}

/// Pinta la barra y la burbuja con el estado actual y muestra o saca cada una.
fn render(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let view = SESSION.lock().unwrap().as_ref().map(|s| s.view.clone());
        let Some(view) = view else {
            destroy(&a, BAR);
            destroy(&a, BUBBLE);
            shortcuts(&a, false);
            return;
        };
        if view.camera {
            ensure_bubble(&a);
            if let Some(w) = a.get_webview_window(BUBBLE) {
                let _ = if view.bubble_visible { w.show() } else { w.hide() };
            }
        } else {
            // Sin burbuja (o falló): se cierra para soltar la cámara.
            destroy(&a, BUBBLE);
        }
        ensure_bar(&a, view.camera);
        shortcuts(&a, matches!(view.phase, "countdown" | "recording" | "paused"));
        let _ = a.emit_to(BAR, "rec://state", view.clone());
        let _ = a.emit_to(BUBBLE, "rec://state", view);
    });
}

/// Manda un control a la página que graba. Si esa pestaña ya no está, cierra la barra.
fn send(app: &AppHandle, control: &'static str) {
    let owner = SESSION.lock().unwrap().as_ref().map(|s| s.webview.clone());
    match owner.and_then(|l| app.get_webview(&l)) {
        Some(wv) => {
            let _ = wv.eval(control_script(control));
            if control == "stop" {
                focus(app);
            }
        }
        None => {
            *SESSION.lock().unwrap() = None;
            render(app);
            track(app, false);
        }
    }
}

/// La pestaña que graba, adelante (al terminar: la subida y después el video).
fn focus(app: &AppHandle) {
    let owner = SESSION.lock().unwrap().as_ref().map(|s| s.webview.clone());
    let Some(label) = owner else { return };
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        crate::tabs::focus_webview(&a, &label);
    });
}

fn update_view(app: &AppHandle, f: impl FnOnce(&mut RecView)) {
    {
        let mut s = SESSION.lock().unwrap();
        let Some(s) = s.as_mut() else { return };
        f(&mut s.view);
    }
    render(app);
}

/// La burbuja: chica o grande, sin despegarse de su esquina.
fn toggle_size(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let large = {
            let mut p = PLACES.lock().unwrap();
            p.large = !p.large;
            p.large
        };
        if let Some(w) = a.get_webview_window(BUBBLE) {
            let scale = w.scale_factor().unwrap_or(1.0);
            if let Ok(pos) = w.outer_position() {
                let pos = (pos.x as f64 / scale, pos.y as f64 / scale);
                let (old, new) = (bubble_size(!large), bubble_size(large));
                if let Some(area) = area_at(&a, Some((pos.0 + old / 2.0, pos.1 + old / 2.0))) {
                    let (x, y) = resize_keep_corner(pos, old, new, area);
                    let _ = w.set_size(LogicalSize::new(new, new));
                    let _ = w.set_position(LogicalPosition::new(x, y));
                }
            }
        }
        update_view(&a, |v| v.bubble_large = large);
    });
}

/// La barra o la burbuja se movieron (arrastre o cambio de tamaño).
pub fn moved(label: &str, x: f64, y: f64) {
    if !crate::config::valid_pos(x, y) {
        return;
    }
    let mut p = PLACES.lock().unwrap();
    if label == BUBBLE {
        p.bubble = Some((x, y));
    } else if label == BAR {
        p.bar = Some((x, y));
    }
}

// ---------- Comandos del puente (página remota) ----------

/// La página empezó, cambió o terminó una grabación de Rec.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn desktop_rec_overlay(
    app: AppHandle,
    window: tauri::Webview,
    active: bool,
    phase: Option<String>,
    elapsed_ms: Option<f64>,
    mic: Option<String>,
    camera: Option<String>,
) -> CmdResult<()> {
    from_app(&app, &window)?;
    let label = window.label().to_string();
    if !active {
        let mut s = SESSION.lock().unwrap();
        // Solo la pestaña que graba la apaga.
        if s.as_ref().is_some_and(|s| s.webview == label) {
            *s = None;
            drop(s);
            render(&app);
            track(&app, false);
        }
        return Ok(());
    }
    let phase = phase.as_deref().and_then(parse_phase).ok_or("phase")?;
    let camera = camera.map(|c| clean_label(&c));
    let large = PLACES.lock().unwrap().large;
    {
        let mut s = SESSION.lock().unwrap();
        // La burbuja sigue escondida si la persona la escondió en esta grabación.
        let visible = s.as_ref().filter(|s| s.webview == label && s.view.camera).map(|s| s.view.bubble_visible).unwrap_or(true);
        *s = Some(Session {
            webview: label,
            view: RecView {
                phase,
                elapsed_ms: clean_elapsed(elapsed_ms),
                at: now_ms(),
                mic: parse_mic(mic.as_deref().unwrap_or("")),
                camera: camera.is_some(),
                bubble_visible: visible,
                bubble_large: large,
            },
            camera_label: camera.unwrap_or_default(),
        });
    }
    render(&app);
    track(&app, true);
    Ok(())
}

/// Nivel del micrófono (0 a 1) para la barra.
#[tauri::command]
pub fn desktop_rec_level(app: AppHandle, window: tauri::Webview, level: f64) -> CmdResult<()> {
    from_app(&app, &window)?;
    let owner = SESSION.lock().unwrap().as_ref().is_some_and(|s| s.webview == window.label());
    if owner {
        let _ = app.emit_to(BAR, "rec://level", clean_level(level));
    }
    Ok(())
}

// ---------- Comandos de la barra y la burbuja (páginas locales) ----------

fn from_overlay(w: &WebviewWindow) -> CmdResult<()> {
    let local = w.url().map(|u| crate::nav::is_local(&u)).unwrap_or(false);
    if (w.label() == BAR || w.label() == BUBBLE) && local {
        Ok(())
    } else {
        Err("forbidden".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInit {
    view: Option<RecView>,
    /// Solo para la burbuja.
    camera_label: Option<String>,
    platform: &'static str,
    strings: serde_json::Map<String, serde_json::Value>,
}

#[tauri::command]
pub fn rec_overlay_state(app: AppHandle, window: WebviewWindow) -> CmdResult<OverlayInit> {
    from_overlay(&window)?;
    let (view, label) = {
        let s = SESSION.lock().unwrap();
        (s.as_ref().map(|s| s.view.clone()), s.as_ref().map(|s| s.camera_label.clone()))
    };
    Ok(OverlayInit {
        view,
        camera_label: if window.label() == BUBBLE { label } else { None },
        platform: if cfg!(target_os = "macos") { "darwin" } else { "win32" },
        strings: crate::strings::table(app.state::<AppState>().locale),
    })
}

#[tauri::command]
pub fn rec_overlay_action(app: AppHandle, window: WebviewWindow, action: String) -> CmdResult<()> {
    from_overlay(&window)?;
    let from_bubble = window.label() == BUBBLE;
    match action.as_str() {
        "open" => focus(&app),
        "bubble-size" => toggle_size(&app),
        "bubble-hide" => update_view(&app, |v| v.bubble_visible = false),
        "bubble-show" => update_view(&app, |v| v.bubble_visible = true),
        "bubble-failed" if from_bubble => {
            send(&app, "bubble-failed");
            update_view(&app, |v| v.camera = false);
        }
        a => match page_control(a).filter(|c| *c != "bubble-failed") {
            Some(c) => send(&app, c),
            None => return Err("action".into()),
        },
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_input_is_validated() {
        assert_eq!(parse_phase("paused"), Some("paused"));
        assert_eq!(parse_phase("setup"), None);
        assert_eq!(parse_phase("recording'"), None);
        assert_eq!(parse_mic("muted"), "muted");
        assert_eq!(parse_mic("loud"), "none");
        assert_eq!(clean_label("FaceTime HD Camera"), "FaceTime HD Camera");
        assert_eq!(clean_label("a\u{0}b"), "");
        assert_eq!(clean_label(&"x".repeat(201)), "");
        assert_eq!(clean_elapsed(Some(1234.9)), 1234);
        for bad in [None, Some(-1.0), Some(f64::NAN), Some(1e12)] {
            assert_eq!(clean_elapsed(bad), 0);
        }
        assert_eq!(clean_level(3.0), 1.0);
        assert_eq!(clean_level(f64::INFINITY), 0.0);
    }

    #[test]
    fn only_known_controls_reach_the_page() {
        for c in ["pause", "resume", "toggle", "stop", "restart", "discard", "mute", "unmute", "bubble-failed"] {
            assert_eq!(page_control(c), Some(c));
            assert!(control_script(page_control(c).unwrap()).ends_with(&format!("detail:'{c}'}}))")));
        }
        for bad in ["", "Pause", "stop'}));alert(1);//", "open"] {
            assert_eq!(page_control(bad), None);
        }
    }

    #[test]
    fn places() {
        let a = (0.0, 25.0, 1440.0, 850.0);
        // Abajo a la izquierda, con margen; la barra a su derecha, alineada abajo.
        assert_eq!(default_bubble(a, SMALL), (24.0, 25.0 + 850.0 - 168.0 - 24.0));
        let b = default_bubble(a, SMALL);
        assert_eq!(default_bar(a, Some((b, SMALL))), (24.0 + 168.0 + 12.0, b.1 + 168.0 - 44.0));
        assert_eq!(default_bar(a, None), (24.0, 25.0 + 850.0 - 44.0 - 24.0));
        // Fuera de la pantalla: vuelve adentro.
        assert_eq!(fit((2000.0, -50.0), (168.0, 168.0), a), (1440.0 - 168.0, 25.0));
        // Agrandar abajo a la izquierda: crece hacia arriba; arriba a la derecha: hacia la izquierda.
        assert_eq!(resize_keep_corner((24.0, 683.0), SMALL, LARGE, a), (24.0, 683.0 + 168.0 - 280.0));
        assert_eq!(resize_keep_corner((1248.0, 49.0), SMALL, LARGE, a), (1248.0 + 168.0 - 280.0, 49.0));
    }
}
