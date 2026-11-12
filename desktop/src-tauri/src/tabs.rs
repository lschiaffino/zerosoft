//! Ventanas y pestañas reales (docs/desktop-tabs.md). Cada ventana de la app es una `Window` con
//! dos tipos de webview hijos: arriba la tira de pestañas (archivo local tabs.html, etiqueta
//! "strip-<ventana>") y debajo una webview de la página de zerosoft por pestaña ("tab-<id>"). Solo
//! la de adelante se ve; las de atrás quedan cargadas hasta que se suspenden por inactividad (se
//! cierra su webview y vuelven a cargar al tocarlas). El modelo puro está en session.rs.
//!
//! Todas las webviews comparten el mismo almacén de cookies: una sola sesión para todo.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl, Window, Wry};

use crate::session::{self, Bounds, Place, Session, HOME, MAIN};
use crate::state::now_ms;
use crate::strings::t;

/// Alto de la tira de pestañas. En Mac va en la barra de título (con los semáforos a la izquierda).
pub const STRIP_H: f64 = if cfg!(target_os = "macos") { 38.0 } else { 36.0 };

pub struct TabsState {
    pub s: Mutex<Session>,
    dir: PathBuf,
    /// Ventana de la app que tuvo el foco por última vez.
    focused: Mutex<String>,
    /// Pestañas nuevas (⌘T) que abren el buscador al cargar.
    palette: Mutex<HashSet<u64>>,
    /// Ventanas que la persona cerró (las demás que se destruyen es porque la app sale).
    closing: Mutex<HashSet<String>>,
    dirty: AtomicBool,
}

fn st(app: &AppHandle) -> tauri::State<'_, TabsState> {
    app.state::<TabsState>()
}

pub fn strip_label(win: &str) -> String {
    format!("strip-{win}")
}

pub fn tab_label(id: u64) -> String {
    format!("tab-{id}")
}

pub fn tab_id(label: &str) -> Option<u64> {
    label.strip_prefix("tab-")?.parse().ok()
}

/// Ventanas de la app (no Ajustes, HUD ni indicador).
pub fn is_app_window(label: &str) -> bool {
    label == MAIN || label.strip_prefix('w').is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Corre en el hilo principal (crear webviews desde otro hilo traba WebView2).
fn ui(app: &AppHandle, f: impl FnOnce(&AppHandle) + Send + 'static) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || f(&a));
}

fn save_soon(app: &AppHandle) {
    st(app).dirty.store(true, Ordering::Relaxed);
}

fn save_now(app: &AppHandle) {
    let state = st(app);
    state.dirty.store(false, Ordering::Relaxed);
    let s = state.s.lock().unwrap().clone();
    let _ = session::save(&state.dir, &s);
}

pub fn focused_label(app: &AppHandle) -> String {
    let f = st(app).focused.lock().unwrap().clone();
    let s = st(app);
    let s = s.s.lock().unwrap();
    if s.win(&f).is_some() {
        f
    } else {
        s.windows.first().map(|w| w.label.clone()).unwrap_or_else(|| MAIN.to_string())
    }
}

// ---------- Arranque ----------

pub fn init(app: &AppHandle, config_dir: PathBuf) -> tauri::Result<()> {
    let mut s = session::load(&config_dir);
    if s.windows.is_empty() {
        s.new_window(HOME, None);
    }
    let labels: Vec<String> = s.windows.iter().map(|w| w.label.clone()).collect();
    app.manage(TabsState {
        s: Mutex::new(s),
        dir: config_dir,
        focused: Mutex::new(MAIN.to_string()),
        palette: Mutex::new(HashSet::new()),
        closing: Mutex::new(HashSet::new()),
        dirty: AtomicBool::new(false),
    });
    for l in labels {
        build_window(app, &l)?;
    }
    // Solo en desarrollo: cargar todas las pestañas restauradas (para medir la memoria por pestaña).
    if cfg!(debug_assertions) && std::env::var("ZEROSOFT_TABS_PRELOAD").is_ok() {
        let ids: Vec<u64> = st(app).s.lock().unwrap().windows.iter().flat_map(|w| w.tabs.iter().map(|t| t.id)).collect();
        for id in ids {
            ensure_webview(app, id, false);
        }
        let labels: Vec<String> = st(app).s.lock().unwrap().windows.iter().map(|w| w.label.clone()).collect();
        for l in labels {
            render(app, &l);
        }
    }
    #[cfg(target_os = "macos")]
    dock::install(app);
    // Guardado con calma (mover una ventana manda muchos eventos) y suspensión de pestañas quietas.
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut n = 0u64;
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if st(&a).dirty.load(Ordering::Relaxed) {
                save_now(&a);
            }
            n += 1;
            if n % 30 == 0 {
                ui(&a, suspend_idle);
            }
        }
    });
    Ok(())
}

/// Crea la ventana de una entrada de la sesión: la tira y la pestaña de adelante (las otras
/// cargan al tocarlas).
fn build_window(app: &AppHandle, label: &str) -> tauri::Result<Window> {
    let (bounds, active) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        let w = s.win(label).ok_or(tauri::Error::WindowNotFound)?;
        (w.bounds, w.active)
    };
    let (w, h) = bounds.map(|b| (b.w, b.h)).unwrap_or((1280.0, 820.0));
    let mut b = WindowBuilder::new(app, label).title("zerosoft").inner_size(w, h).min_inner_size(480.0, 400.0).visible(false);
    if let Some(bd) = bounds {
        b = b.position(bd.x, bd.y);
    } else if label != MAIN {
        // En cascada desde la ventana con foco.
        if let Some(f) = app.get_window(&focused_label(app)) {
            if let (Ok(p), Ok(sf)) = (f.outer_position(), f.scale_factor()) {
                b = b.position(p.x as f64 / sf + 28.0, p.y as f64 / sf + 28.0);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        b = b.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    let win = b.build()?;
    let (cw, _) = logical_size(&win);
    // Desde la config: es la única forma de pasarle a la webview la posición de los semáforos
    // (centrados en la tira, como en Safari y Chrome).
    let mut cfg = tauri::utils::config::WindowConfig { label: strip_label(label), url: WebviewUrl::App("tabs.html".into()), drag_drop_enabled: false, ..Default::default() };
    if cfg!(target_os = "macos") {
        cfg.traffic_light_position = Some(tauri::utils::config::LogicalPosition { x: 14.0, y: STRIP_H - 14.0 });
    }
    let strip = WebviewBuilder::from_config(&cfg);
    win.add_child(strip, LogicalPosition::new(0.0, 0.0), LogicalSize::new(cw, STRIP_H))?;
    show_tab(app, active, true);
    let _ = win.show();
    Ok(win)
}

fn logical_size(win: &Window) -> (f64, f64) {
    let sf = win.scale_factor().unwrap_or(1.0);
    let s = win.inner_size().map(|s| s.to_logical::<f64>(sf)).unwrap_or(LogicalSize::new(1280.0, 820.0));
    (s.width, s.height)
}

fn content_rect(win: &Window) -> Rect {
    let (w, h) = logical_size(win);
    Rect { position: LogicalPosition::new(0.0, STRIP_H).into(), size: LogicalSize::new(w, (h - STRIP_H).max(0.0)).into() }
}

/// La tira y la pestaña de adelante ocupan la ventana (al cambiar de tamaño).
pub fn layout(app: &AppHandle, label: &str) {
    let Some(win) = app.get_window(label) else { return };
    let (w, _) = logical_size(&win);
    if let Some(strip) = app.get_webview(&strip_label(label)) {
        let _ = strip.set_bounds(Rect { position: LogicalPosition::new(0.0, 0.0).into(), size: LogicalSize::new(w, STRIP_H).into() });
    }
    let active = st(app).s.lock().unwrap().active_of(label);
    if let Some(wv) = active.and_then(|id| app.get_webview(&tab_label(id))) {
        let _ = wv.set_bounds(content_rect(&win));
    }
    render(app, label);
}

// ---------- Webview de una pestaña ----------

fn content_webview(app: &AppHandle, id: u64, path: &str) -> WebviewBuilder<Wry> {
    let server = crate::api::server(app);
    let url = url::Url::parse(&format!("{server}{path}")).or_else(|_| url::Url::parse(&format!("{server}{HOME}"))).expect("server url");
    let nav_app = app.clone();
    let new_app = app.clone();
    let load_app = app.clone();
    WebviewBuilder::new(tab_label(id), WebviewUrl::External(url))
        .initialization_script(crate::bridge_script(&server, &app.package_info().version.to_string()))
        .on_navigation(move |u| crate::route(&nav_app, u))
        .on_permission_request(|webview, kind| {
            use tauri::webview::{PermissionKind, PermissionResponse};
            let server = crate::api::server(webview.app_handle());
            let ours = webview.url().map(|u| crate::nav::classify(&u, &server) == crate::nav::Nav::Allow).unwrap_or(false);
            match kind {
                PermissionKind::Camera | PermissionKind::Microphone if ours => PermissionResponse::Allow,
                PermissionKind::Camera | PermissionKind::Microphone => PermissionResponse::Deny,
                _ => PermissionResponse::Default,
            }
        })
        .on_new_window(move |u, _| {
            // target=_blank de la app: pestaña nueva al lado; otro sitio, al navegador.
            if crate::route(&new_app, &u) {
                let path = path_of(&u);
                ui(&new_app, move |a| open_from(a, id, &path, Place::Next));
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |wv, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            crate::first_load_timing();
            if let Some(id) = tab_id(wv.label()) {
                if st(&load_app).palette.lock().unwrap().remove(&id) {
                    // ⌘T: el buscador (⌘K) de la página, apenas monta.
                    let _ = wv.eval("(function f(n){if(document.querySelector('.cmdk input'))return;window.dispatchEvent(new CustomEvent('zs:open-search'));if(n<30)setTimeout(function(){f(n+1)},150)})(0)");
                }
            }
        })
}

fn path_of(u: &url::Url) -> String {
    let mut p = u.path().to_string();
    if let Some(q) = u.query() {
        p.push('?');
        p.push_str(q);
    }
    if let Some(f) = u.fragment() {
        p.push('#');
        p.push_str(f);
    }
    p
}

/// Crea la webview de una pestaña si no está (nueva, restaurada o suspendida) y la deja en su ventana.
fn ensure_webview(app: &AppHandle, id: u64, visible: bool) -> Option<Webview> {
    let (label, path) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        (s.window_of(id)?.to_string(), s.get(id)?.path.clone())
    };
    let win = app.get_window(&label)?;
    if let Some(wv) = app.get_webview(&tab_label(id)) {
        if wv.window().label() != label {
            let _ = wv.reparent(&win);
        }
        return Some(wv);
    }
    let r = content_rect(&win);
    let (pos, size) = (r.position.to_logical::<f64>(1.0), r.size.to_logical::<f64>(1.0));
    let wv = win.add_child(content_webview(app, id, &path), pos, size).ok()?;
    if !visible {
        let _ = wv.hide();
    }
    if let Some(t) = st(app).s.lock().unwrap().get_mut(id) {
        t.loaded = true;
        t.last_active = now_ms();
    }
    Some(wv)
}

/// Pone adelante una pestaña en su ventana.
pub fn show_tab(app: &AppHandle, id: u64, focus: bool) {
    let (label, prev) = {
        let s = st(app);
        let mut s = s.s.lock().unwrap();
        let Some(l) = s.window_of(id).map(str::to_string) else { return };
        (l, s.activate(id, now_ms()))
    };
    let Some(win) = app.get_window(&label) else { return };
    let Some(wv) = ensure_webview(app, id, true) else { return };
    let _ = wv.set_bounds(content_rect(&win));
    let _ = wv.show();
    if let Some(p) = prev.and_then(|p| app.get_webview(&tab_label(p))) {
        if p.window().label() == label {
            let _ = p.hide();
        }
    }
    if focus {
        let _ = wv.set_focus();
    }
    update_title(app, &label);
    render(app, &label);
    save_soon(app);
}

fn update_title(app: &AppHandle, label: &str) {
    let title = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        s.active_of(label).and_then(|id| s.get(id)).map(|t| t.title.clone()).unwrap_or_default()
    };
    if let Some(w) = app.get_window(label) {
        // El menú Ventana de macOS lista las ventanas por este título.
        let _ = w.set_title(if title.is_empty() { "zerosoft" } else { &title });
    }
}

// ---------- Acciones ----------

/// Pestaña nueva en una ventana (o ventana nueva si no se puede).
pub fn open_in(app: &AppHandle, label: &str, path: &str, place: Place, palette: bool) {
    let id = st(app).s.lock().unwrap().add_tab(label, path, place);
    let Some(id) = id else {
        new_window(app, path);
        return;
    };
    if palette {
        st(app).palette.lock().unwrap().insert(id);
    }
    if place == Place::Background {
        ensure_webview(app, id, false);
        render(app, label);
        save_soon(app);
    } else {
        show_tab(app, id, true);
    }
}

/// Desde una pestaña (⌘-clic, target=_blank, menú del link).
pub fn open_from(app: &AppHandle, from: u64, path: &str, place: Place) {
    let label = st(app).s.lock().unwrap().window_of(from).map(str::to_string).unwrap_or_else(|| focused_label(app));
    open_in(app, &label, path, place, false);
}

pub fn new_window(app: &AppHandle, path: &str) {
    let created = st(app).s.lock().unwrap().new_window(path, None);
    if let Some((label, _)) = created {
        if let Ok(w) = build_window(app, &label) {
            let _ = w.set_focus();
        }
        save_soon(app);
    }
}

pub fn new_tab(app: &AppHandle) {
    let label = focused_label(app);
    open_in(app, &label, HOME, Place::End, false);
    show_window(app, &label);
}

pub fn close_tab(app: &AppHandle, id: u64) {
    let (label, alone) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        let Some(l) = s.window_of(id) else { return };
        (l.to_string(), s.win(l).map(|w| w.tabs.len() == 1).unwrap_or(false))
    };
    if alone {
        // La última pestaña cierra la ventana (y la última ventana se esconde, como antes).
        close_window(app, &label);
        return;
    }
    let res = st(app).s.lock().unwrap().close_tab(id);
    if let Some(wv) = app.get_webview(&tab_label(id)) {
        let _ = wv.close();
    }
    if let Some((_, next, _)) = res {
        if let Some(n) = next {
            show_tab(app, n, true);
        }
    }
    render(app, &label);
    save_soon(app);
}

pub fn close_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_window(label) {
        let _ = w.close();
    }
}

/// Botón de cerrar de una ventana: si es la única se esconde (el dictado sigue en la bandeja).
/// Devuelve true si hay que impedir el cierre.
pub fn on_close_requested(app: &AppHandle, label: &str) -> bool {
    let n = st(app).s.lock().unwrap().windows.len();
    if n <= 1 {
        if let Some(w) = app.get_window(label) {
            let _ = w.hide();
        }
        return true;
    }
    st(app).closing.lock().unwrap().insert(label.to_string());
    false
}

pub fn on_destroyed(app: &AppHandle, label: &str) {
    // Solo si la cerró la persona: al salir de la app la sesión queda como estaba.
    if st(app).closing.lock().unwrap().remove(label) {
        st(app).s.lock().unwrap().remove_window(label);
        save_now(app);
    }
}

pub fn reopen_closed(app: &AppHandle) {
    let label = focused_label(app);
    let r = st(app).s.lock().unwrap().reopen(&label);
    match r {
        Some((l, id)) => {
            show_tab(app, id, true);
            show_window(app, &l);
        }
        None => {}
    }
}

pub fn select(app: &AppHandle, label: &str, n: usize) {
    let id = st(app).s.lock().unwrap().nth(label, n);
    if let Some(id) = id {
        show_tab(app, id, true);
    }
}

pub fn cycle(app: &AppHandle, label: &str, delta: i64) {
    let id = st(app).s.lock().unwrap().cycle(label, delta);
    if let Some(id) = id {
        show_tab(app, id, true);
    }
}

pub fn duplicate(app: &AppHandle, id: u64) {
    let (label, path) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        let Some(t) = s.get(id) else { return };
        (s.window_of(id).unwrap_or(MAIN).to_string(), t.path.clone())
    };
    let _ = st(app).s.lock().unwrap().activate(id, now_ms());
    open_in(app, &label, &path, Place::Next, false);
}

pub fn close_others(app: &AppHandle, id: u64) {
    let others: Vec<u64> = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        let Some(l) = s.window_of(id) else { return };
        s.win(l).map(|w| w.tabs.iter().map(|t| t.id).filter(|x| *x != id).collect()).unwrap_or_default()
    };
    show_tab(app, id, true);
    for o in others {
        close_tab(app, o);
    }
}

/// Reordenar en la misma ventana.
pub fn move_to(app: &AppHandle, id: u64, index: usize) {
    let label = st(app).s.lock().unwrap().window_of(id).map(str::to_string);
    let Some(label) = label else { return };
    let r = st(app).s.lock().unwrap().move_tab(id, &label, index);
    if r.is_some() {
        render(app, &label);
        save_soon(app);
    }
}

/// Soltar una pestaña fuera de su tira: sobre la tira de otra ventana se muda ahí; en otro lado,
/// ventana nueva donde se soltó. x, y: pantalla, en puntos.
pub fn drop_outside(app: &AppHandle, id: u64, x: f64, y: f64) {
    let from = st(app).s.lock().unwrap().window_of(id).map(str::to_string);
    let Some(from) = from else { return };
    let labels: Vec<String> = st(app).s.lock().unwrap().windows.iter().map(|w| w.label.clone()).collect();
    for l in labels.iter().filter(|l| **l != from) {
        let Some(w) = app.get_window(l) else { continue };
        if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
            continue;
        }
        let (Ok(p), Ok(sf)) = (w.inner_position(), w.scale_factor()) else { continue };
        let (wx, wy) = (p.x as f64 / sf, p.y as f64 / sf);
        let (ww, _) = logical_size(&w);
        if x >= wx && x <= wx + ww && y >= wy - 8.0 && y <= wy + STRIP_H + 8.0 {
            let n = st(app).s.lock().unwrap().win(l).map(|w| w.tabs.len()).unwrap_or(0);
            move_between(app, id, l, n);
            return;
        }
    }
    detach(app, id, Some((x, y)));
}

fn move_between(app: &AppHandle, id: u64, to: &str, index: usize) {
    let r = st(app).s.lock().unwrap().move_tab(id, to, index);
    let Some((from, next, empty)) = r else { return };
    if let Some(n) = next {
        show_tab(app, n, false);
    }
    show_tab(app, id, true);
    show_window(app, to);
    if empty {
        st(app).closing.lock().unwrap().insert(from.clone());
        close_window(app, &from);
    } else {
        render(app, &from);
    }
    save_soon(app);
}

/// "Mover a ventana nueva" o soltar afuera.
pub fn detach(app: &AppHandle, id: u64, at: Option<(f64, f64)>) {
    let from = st(app).s.lock().unwrap().window_of(id).map(str::to_string);
    let Some(from) = from else { return };
    let size = app.get_window(&from).map(|w| logical_size(&w)).unwrap_or((1100.0, 760.0));
    let bounds = at.map(|(x, y)| Bounds { x: x - 120.0, y: y - 14.0, w: size.0, h: size.1 });
    let r = st(app).s.lock().unwrap().detach(id, bounds);
    let Some((from, label, next)) = r else { return };
    if let Some(n) = next {
        show_tab(app, n, false);
    }
    render(app, &from);
    if let Ok(w) = build_window(app, &label) {
        let _ = w.set_focus();
    }
    save_soon(app);
}

/// Suspende las pestañas quietas (cierra su webview; la pestaña queda en la tira).
pub fn suspend_idle(app: &AppHandle) {
    let ids = st(app).s.lock().unwrap().discardable(now_ms());
    if ids.is_empty() {
        return;
    }
    let mut touched = HashSet::new();
    for id in ids {
        if let Some(wv) = app.get_webview(&tab_label(id)) {
            let _ = wv.close();
        }
        let s = st(app);
        let mut s = s.s.lock().unwrap();
        if let Some(t) = s.get_mut(id) {
            t.loaded = false;
        }
        if let Some(l) = s.window_of(id) {
            touched.insert(l.to_string());
        }
    }
    for l in touched {
        render(app, &l);
    }
}

pub fn show_window(app: &AppHandle, label: &str) {
    if let Some(w) = app.get_window(label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Clic en el dock, bandeja, deep link: la última ventana con foco.
pub fn show_last(app: &AppHandle) {
    let l = focused_label(app);
    show_window(app, &l);
}

pub fn active_webview(app: &AppHandle) -> Option<Webview> {
    let l = focused_label(app);
    let id = st(app).s.lock().unwrap().active_of(&l)?;
    app.get_webview(&tab_label(id))
}

/// Carga un path en la pestaña de adelante de la ventana con foco.
pub fn navigate_active(app: &AppHandle, path: &str) {
    let l = focused_label(app);
    let id = st(app).s.lock().unwrap().active_of(&l);
    let Some(id) = id else { return };
    st(app).s.lock().unwrap().set_path(id, path);
    match app.get_webview(&tab_label(id)) {
        Some(wv) => {
            if let Ok(u) = url::Url::parse(&format!("{}{}", crate::api::server(app), path)) {
                let _ = wv.navigate(u);
            }
        }
        None => show_tab(app, id, true),
    }
}

/// Entró o salió la sesión (o cambió el servidor): las demás pestañas cargadas vuelven a pedir
/// su página. La de adelante ya la carga load_app_path.
pub fn reload_all(app: &AppHandle) {
    ui(app, |a| {
        let front = st(a).s.lock().unwrap().active_of(&focused_label(a));
        let server = crate::api::server(a);
        for (label, wv) in a.webviews() {
            let Some(id) = tab_id(&label) else { continue };
            if Some(id) == front {
                continue;
            }
            let path = st(a).s.lock().unwrap().get(id).map(|t| t.path.clone()).unwrap_or_else(|| HOME.into());
            if let Ok(u) = url::Url::parse(&format!("{server}{path}")) {
                let _ = wv.navigate(u);
            }
        }
    });
}

/// Una webview cualquiera para leer o escribir cookies (todas comparten el almacén).
pub fn any_webview(app: &AppHandle) -> Option<Webview> {
    let all = app.webviews();
    all.iter().find(|(l, _)| l.starts_with("strip-") || tab_id(l).is_some()).map(|(_, w)| w.clone()).or_else(|| all.into_values().next())
}

pub fn on_focus(app: &AppHandle, label: &str, focused: bool) {
    if focused {
        *st(app).focused.lock().unwrap() = label.to_string();
        let id = st(app).s.lock().unwrap().active_of(label);
        if let Some(id) = id {
            if let Some(t) = st(app).s.lock().unwrap().get_mut(id) {
                t.unread = false;
            }
        }
        render(app, label);
    }
}

pub fn any_focused(app: &AppHandle) -> bool {
    app.windows().iter().any(|(l, w)| is_app_window(l) && w.is_focused().unwrap_or(false))
}

/// Guarda posición y tamaño de una ventana (para restaurarla).
pub fn remember_bounds(app: &AppHandle, label: &str) {
    let Some(w) = app.get_window(label) else { return };
    if w.is_fullscreen().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(p), Ok(sf)) = (w.outer_position(), w.scale_factor()) else { return };
    let (cw, ch) = logical_size(&w);
    let s = st(app);
    let mut s = s.s.lock().unwrap();
    if let Some(win) = s.windows.iter_mut().find(|x| x.label == label) {
        win.bounds = Some(Bounds { x: p.x as f64 / sf, y: p.y as f64 / sf, w: cw, h: ch });
    }
    drop(s);
    save_soon(app);
}

// ---------- Estado que manda la página ----------

pub fn page_state(app: &AppHandle, id: u64, path: &str, title: &str) {
    let label = {
        let s = st(app);
        let mut s = s.s.lock().unwrap();
        let a = s.set_path(id, path);
        let b = s.set_title(id, title);
        if !a && !b {
            return;
        }
        s.window_of(id).map(str::to_string)
    };
    if let Some(l) = label {
        update_title(app, &l);
        render(app, &l);
        save_soon(app);
    }
}

pub fn set_recording(app: &AppHandle, id: Option<u64>, on: bool) {
    let mut touched = vec![];
    {
        let s = st(app);
        let mut s = s.s.lock().unwrap();
        for w in &mut s.windows {
            for t in &mut w.tabs {
                let v = on && Some(t.id) == id;
                if t.recording != v {
                    t.recording = v;
                    touched.push(w.label.clone());
                }
            }
        }
    }
    for l in touched {
        render(app, &l);
    }
}

/// La pestaña que graba está a la vista (su ventana adelante con foco y ella adelante).
pub fn recording_in_front(app: &AppHandle) -> bool {
    let (label, id) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        let Some(id) = s.windows.iter().flat_map(|w| &w.tabs).find(|t| t.recording).map(|t| t.id) else { return false };
        (s.window_of(id).unwrap_or(MAIN).to_string(), id)
    };
    let Some(w) = app.get_window(&label) else { return false };
    w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) && w.is_focused().unwrap_or(false) && st(app).s.lock().unwrap().active_of(&label) == Some(id)
}

pub fn recording_webview(app: &AppHandle) -> Option<Webview> {
    let id = st(app).s.lock().unwrap().windows.iter().flat_map(|w| &w.tabs).find(|t| t.recording).map(|t| t.id)?;
    app.get_webview(&tab_label(id))
}

/// La pestaña de una webview ("tab-<id>"), adelante y con su ventana al frente (Rec, rec_overlay.rs).
pub fn focus_webview(app: &AppHandle, label: &str) -> bool {
    let Some(id) = tab_id(label) else { return false };
    let win = st(app).s.lock().unwrap().window_of(id).map(str::to_string);
    let Some(win) = win else { return false };
    show_tab(app, id, true);
    show_window(app, &win);
    true
}

/// "Abrir" del indicador: la pestaña que graba, adelante.
pub fn focus_recording(app: &AppHandle) -> bool {
    let found = st(app).s.lock().unwrap().windows.iter().flat_map(|w| &w.tabs).find(|t| t.recording).map(|t| t.id);
    let Some(id) = found else { return false };
    show_tab(app, id, true);
    let l = st(app).s.lock().unwrap().window_of(id).map(str::to_string);
    if let Some(l) = l {
        show_window(app, &l);
    }
    true
}

/// Puntos de novedades por producto (badge.rs, cada 30 s).
pub fn set_unread(app: &AppHandle, products: Vec<String>) {
    let a = app.clone();
    ui(app, move |_| {
        let focused = if any_focused(&a) { Some(focused_label(&a)) } else { None };
        let changed = st(&a).s.lock().unwrap().set_unread(&products, focused.as_deref());
        if changed {
            let labels: Vec<String> = st(&a).s.lock().unwrap().windows.iter().map(|w| w.label.clone()).collect();
            for l in labels {
                render(&a, &l);
            }
        }
    });
}

// ---------- Tira de pestañas ----------

pub fn view(app: &AppHandle, label: &str) -> Value {
    let s = st(app);
    let s = s.s.lock().unwrap();
    let Some(w) = s.win(label) else { return Value::Null };
    let fullscreen = app.get_window(label).and_then(|w| w.is_fullscreen().ok()).unwrap_or(false);
    json!({
        "active": w.active,
        "fullscreen": fullscreen,
        "tabs": w.tabs.iter().map(|t| json!({
            "id": t.id,
            "title": t.title,
            "path": t.path,
            "product": session::product_of(&t.path),
            "loaded": t.loaded,
            "unread": t.unread,
            "recording": t.recording,
        })).collect::<Vec<_>>(),
    })
}

pub fn render(app: &AppHandle, label: &str) {
    let Some(strip) = app.get_webview(&strip_label(label)) else { return };
    let v = view(app, label);
    let _ = strip.eval(format!("window.__zsTabs&&window.__zsTabs.render({v})"));
}

pub fn strip_init(app: &AppHandle, label: &str) -> Value {
    let l = app.state::<crate::state::AppState>().locale;
    let mut strings = serde_json::Map::new();
    for k in ["newTab", "closeTab", "tabSuspended", "tabRecording", "tabUnread", "tabsLabel", "tabNewTitle"] {
        strings.insert(k.into(), Value::String(t(l, k)));
    }
    json!({
        "platform": if cfg!(target_os = "macos") { "darwin" } else { "win32" },
        "locale": l,
        "strings": strings,
        "view": view(app, label),
    })
}

/// Lo que pide la tira (clics, arrastres, menú).
pub fn strip_action(app: &AppHandle, label: &str, action: &str, id: Option<u64>, index: Option<usize>, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    // La pestaña tiene que ser de esta ventana.
    let mine = |id: u64| st(app).s.lock().unwrap().window_of(id) == Some(label);
    match (action, id) {
        ("new", _) => {
            open_in(app, label, HOME, Place::End, false);
        }
        ("activate", Some(id)) if mine(id) => show_tab(app, id, true),
        ("close", Some(id)) if mine(id) => close_tab(app, id),
        ("move", Some(id)) if mine(id) => move_to(app, id, index.unwrap_or(0)),
        ("drop", Some(id)) if mine(id) => drop_outside(app, id, x.unwrap_or(0.0), y.unwrap_or(0.0)),
        ("menu", Some(id)) if mine(id) => tab_menu(app, label, id),
        _ => return Err("action".into()),
    }
    Ok(())
}

fn tab_menu(app: &AppHandle, label: &str, id: u64) {
    let l = app.state::<crate::state::AppState>().locale;
    let (n, closed) = {
        let s = st(app);
        let s = s.s.lock().unwrap();
        (s.win(label).map(|w| w.tabs.len()).unwrap_or(0), !s.closed.is_empty())
    };
    let build = || -> tauri::Result<Menu<Wry>> {
        let m = Menu::new(app)?;
        m.append(&MenuItem::with_id(app, format!("tm-new:{id}"), t(l, "newTab"), true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, format!("tm-dup:{id}"), t(l, "duplicateTab"), true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, format!("tm-window:{id}"), t(l, "moveToNewWindow"), n > 1, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, format!("tm-close:{id}"), t(l, "closeTab"), true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, format!("tm-others:{id}"), t(l, "closeOtherTabs"), n > 1, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, "reopen-tab", t(l, "reopenTab"), closed, None::<&str>)?)?;
        Ok(m)
    };
    if let (Some(w), Ok(m)) = (app.get_window(label), build()) {
        let _ = w.popup_menu(&m);
    }
}

/// Clic derecho sobre un link de la app: abrir en pestaña o ventana nueva, copiar.
pub fn link_menu(app: &AppHandle, from: u64, path: &str) {
    let l = app.state::<crate::state::AppState>().locale;
    let Some(label) = st(app).s.lock().unwrap().window_of(from).map(str::to_string) else { return };
    let build = || -> tauri::Result<Menu<Wry>> {
        let m = Menu::new(app)?;
        m.append(&MenuItem::with_id(app, format!("lm-tab:{from}:{path}"), t(l, "openInNewTab"), true, None::<&str>)?)?;
        m.append(&MenuItem::with_id(app, format!("lm-window:{from}:{path}"), t(l, "openInNewWindow"), true, None::<&str>)?)?;
        m.append(&PredefinedMenuItem::separator(app)?)?;
        m.append(&MenuItem::with_id(app, format!("lm-copy:{from}:{path}"), t(l, "copyLink"), true, None::<&str>)?)?;
        Ok(m)
    };
    if let (Some(w), Ok(m)) = (app.get_window(&label), build()) {
        let _ = w.popup_menu(&m);
    }
}

/// Ítems de menú de las pestañas (los de la barra de menú y los contextuales). true si era nuestro.
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    let focused = focused_label(app);
    // ⌘W con Ajustes adelante cierra Ajustes (como hacía el ítem estándar), no una pestaña.
    if id == "close-tab" || id == "close-window" {
        if let Some((_, w)) = app.windows().into_iter().find(|(l, w)| !is_app_window(l) && w.is_focused().unwrap_or(false)) {
            let _ = w.close();
            return true;
        }
    }
    match id {
        "new-tab" => new_tab(app),
        "new-window" => new_window(app, HOME),
        "close-tab" => {
            let a = st(app).s.lock().unwrap().active_of(&focused);
            if let Some(a) = a {
                close_tab(app, a);
            }
        }
        "close-window" => close_window(app, &focused),
        "reopen-tab" => reopen_closed(app),
        "next-tab" => cycle(app, &focused, 1),
        "prev-tab" => cycle(app, &focused, -1),
        _ => {
            if let Some(rest) = id.strip_prefix("tm-") {
                let (what, n) = rest.split_once(':').unwrap_or((rest, ""));
                let Ok(n) = n.parse::<u64>() else { return true };
                let label = st(app).s.lock().unwrap().window_of(n).map(str::to_string).unwrap_or(focused);
                match what {
                    "new" => open_in(app, &label, HOME, Place::End, false),
                    "dup" => duplicate(app, n),
                    "window" => detach(app, n, None),
                    "close" => close_tab(app, n),
                    "others" => close_others(app, n),
                    _ => {}
                }
                return true;
            }
            if let Some(rest) = id.strip_prefix("lm-") {
                let mut parts = rest.splitn(3, ':');
                let (what, from, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
                let from = from.parse::<u64>().unwrap_or(0);
                if !session::valid_path(path) {
                    return true;
                }
                match what {
                    "tab" => open_from(app, from, path, Place::Next),
                    "window" => new_window(app, path),
                    "copy" => {
                        let url = format!("{}{}", crate::api::server(app), path);
                        let _ = arboard::Clipboard::new().and_then(|mut c| c.set_text(url));
                    }
                    _ => {}
                }
                return true;
            }
            return false;
        }
    }
    true
}

/// ⌘-clic, clic del medio y teclas que manda el puente de la página.
pub fn page_action(app: &AppHandle, from: u64, action: &str, path: Option<&str>, title: Option<&str>, n: Option<usize>) -> Result<(), String> {
    let label = st(app).s.lock().unwrap().window_of(from).map(str::to_string).ok_or("tab")?;
    let path_ok = path.filter(|p| session::valid_path(p));
    match action {
        "state" => page_state(app, from, path.unwrap_or(""), title.unwrap_or("")),
        "open" | "open-tab" | "open-window" => {
            let p = path_ok.ok_or("path")?.to_string();
            let links = st(app).s.lock().unwrap().prefs.links.clone();
            match action {
                // ⌘-clic: según Ajustes, pestaña atrás o ventana.
                "open" if links == "window" => new_window(app, &p),
                "open" => open_in(app, &label, &p, Place::Background, false),
                "open-tab" => open_in(app, &label, &p, Place::Next, false),
                _ => new_window(app, &p),
            }
        }
        "menu" => link_menu(app, from, path_ok.ok_or("path")?),
        "select" => select(app, &label, n.unwrap_or(0)),
        "next" => cycle(app, &label, 1),
        "prev" => cycle(app, &label, -1),
        _ => return Err("action".into()),
    }
    Ok(())
}

pub fn prefs(app: &AppHandle) -> Value {
    serde_json::to_value(&st(app).s.lock().unwrap().prefs).unwrap_or(Value::Null)
}

pub fn save_prefs(app: &AppHandle, input: &Value) -> Value {
    {
        let s = st(app);
        let mut s = s.s.lock().unwrap();
        s.prefs = session::parse_prefs(input, &s.prefs);
    }
    save_now(app);
    ui(app, suspend_idle);
    prefs(app)
}

// ---------- Comandos ----------

/// La tira de una ventana de la app (archivo local "strip-<ventana>").
fn from_strip(w: &Webview) -> Result<String, String> {
    let label = w.label().strip_prefix("strip-").ok_or("forbidden")?;
    if is_app_window(label) && w.window().label() == label {
        Ok(label.to_string())
    } else {
        Err("forbidden".into())
    }
}

/// Una pestaña con la página del servidor.
fn from_tab(app: &AppHandle, w: &Webview) -> Result<u64, String> {
    let id = tab_id(w.label()).ok_or("forbidden")?;
    let server = crate::api::server(app);
    if w.url().map(|u| crate::nav::classify(&u, &server) == crate::nav::Nav::Allow).unwrap_or(false) {
        Ok(id)
    } else {
        Err("forbidden".into())
    }
}

#[tauri::command]
pub async fn tabs_ready(app: AppHandle, webview: Webview) -> Result<Value, String> {
    let label = from_strip(&webview)?;
    Ok(strip_init(&app, &label))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn tabs_action(app: AppHandle, webview: Webview, action: String, id: Option<u64>, index: Option<usize>, x: Option<f64>, y: Option<f64>) -> Result<(), String> {
    let label = from_strip(&webview)?;
    ui(&app, move |a| {
        let _ = strip_action(a, &label, &action, id, index, x, y);
    });
    Ok(())
}

#[tauri::command]
pub async fn desktop_tabs(app: AppHandle, webview: Webview, action: String, path: Option<String>, title: Option<String>, n: Option<usize>) -> Result<(), String> {
    let id = from_tab(&app, &webview)?;
    if !matches!(action.as_str(), "state" | "open" | "open-tab" | "open-window" | "menu" | "select" | "next" | "prev") {
        return Err("action".into());
    }
    ui(&app, move |a| {
        let _ = page_action(a, id, &action, path.as_deref(), title.as_deref(), n);
    });
    Ok(())
}

#[tauri::command]
pub fn tabs_prefs_get(app: AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    if window.label() != "settings" {
        return Err("forbidden".into());
    }
    Ok(prefs(&app))
}

#[tauri::command]
pub fn tabs_prefs_save(app: AppHandle, window: tauri::WebviewWindow, input: Value) -> Result<Value, String> {
    if window.label() != "settings" {
        return Err("forbidden".into());
    }
    Ok(save_prefs(&app, &input))
}

// ---------- Menú del dock (Mac): "Ventana nueva" ----------

#[cfg(target_os = "macos")]
mod dock {
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::atomic::{AtomicPtr, Ordering};
    use tauri::{AppHandle, Manager};

    static MENU: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

    unsafe extern "C" fn dock_menu(_this: *mut AnyObject, _cmd: Sel, _app: *mut AnyObject) -> *mut AnyObject {
        MENU.load(Ordering::Relaxed) as *mut AnyObject
    }

    /// tao no expone applicationDockMenu: se le agrega el método a su delegado. El menú es de muda,
    /// así sus clics llegan por el mismo camino que los de la barra de menú (ids "new-window").
    pub fn install(app: &AppHandle) {
        use muda::ContextMenu;
        let l = app.state::<crate::state::AppState>().locale;
        let menu = muda::Menu::new();
        let _ = menu.append(&muda::MenuItem::with_id("new-window", crate::strings::t(l, "newWindow"), true, None));
        MENU.store(menu.ns_menu(), Ordering::Relaxed);
        std::mem::forget(menu);
        let _ = app.run_on_main_thread(|| unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                return;
            }
            let cls = objc2::ffi::object_getClass(delegate as *const _) as *mut objc2::ffi::objc_class;
            let imp: unsafe extern "C" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject = dock_menu;
            objc2::ffi::class_addMethod(cls, sel!(applicationDockMenu:).as_ptr(), Some(std::mem::transmute::<_, unsafe extern "C" fn()>(imp)), c"@@:@".as_ptr());
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(tab_id(&tab_label(42)), Some(42));
        assert_eq!(tab_id("tab-x"), None);
        assert_eq!(tab_id("strip-main"), None);
        for ok in ["main", "w1", "w12"] {
            assert!(is_app_window(ok), "{ok}");
        }
        for no in ["settings", "hud", "indicator", "w", "wx", "strip-main"] {
            assert!(!is_app_window(no), "{no}");
        }
    }
}
