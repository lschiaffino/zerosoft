//! Dictado en cualquier app:
//!
//! - Un atajo global (Carbon en Mac, RegisterHotKey en Windows: no pide Accesibilidad) con
//!   apretar y soltar. Modo "both": mantener más de HOLD es mantener para hablar; un toque corto
//!   sigue escuchando (manos libres) hasta el próximo toque. "hold" y "toggle" fijan uno solo.
//! - Mientras graba, Esc cancela (se registra solo durante la grabación).
//! - El micrófono (cpal) graba en un hilo; el HUD muestra nivel y reloj.
//! - Al terminar: WAV a 16 kHz → POST /api/voice/dictate con la sesión del webview → texto limpio
//!   → portapapeles + Cmd/Ctrl+V → se devuelve el portapapeles.
//! - Si no llega (sin conexión, sesión, servidor), el audio queda para mandarlo de nuevo.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::audio;
use crate::clipboard::{paste_via_clipboard, ClipboardPort, How};
use crate::config::paste_last_shortcut;
use crate::hud::{self, HudState};
use crate::platform;
use crate::retry::{classify, keep_for_retry, new_pending_id, Failure, Outcome, PendingMeta};
use crate::state::{now_ms, AppState, Phase};
use crate::strings::{fill, t};

pub const MAX_MS: u64 = 120_000;
const MIN_MS: u64 = 300;
/// Más que esto apretado es "mantener"; menos es un toque (manos libres en modo both).
const HOLD: Duration = Duration::from_millis(300);

fn locale(app: &AppHandle) -> &'static str {
    app.state::<AppState>().locale
}

fn s(app: &AppHandle, key: &str) -> String {
    t(locale(app), key)
}

/// "CommandOrControl+Shift+D" → "Command + Shift + D" (Mac) para mostrar.
pub fn shortcut_label(accel: &str) -> String {
    let mac = cfg!(target_os = "macos");
    accel
        .split('+')
        .map(|p| match p {
            "CommandOrControl" | "CmdOrCtrl" => if mac { "Command" } else { "Ctrl" },
            "Alt" | "Option" => if mac { "Option" } else { "Alt" },
            "Super" => if mac { "Command" } else { "Windows" },
            "Control" => if mac { "Control" } else { "Ctrl" },
            other => other,
        })
        .collect::<Vec<_>>()
        .join(" + ")
}

fn hud_state(_app: &AppHandle, phase: &'static str, label: String) -> HudState {
    HudState { phase, label, hint: String::new(), started_at: None, max_ms: MAX_MS }
}

pub fn is_recording(app: &AppHandle) -> bool {
    app.state::<AppState>().dictation.lock().unwrap().phase == Phase::Recording
}

fn set_escape(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    if on {
        if !gs.is_registered("Escape") {
            let _ = gs.on_shortcut("Escape", |app, _, ev| {
                if ev.state == ShortcutState::Pressed {
                    cancel(app);
                }
            });
        }
    } else if gs.is_registered("Escape") {
        let _ = gs.unregister("Escape");
    }
}

pub fn start(app: &AppHandle, hands_free: bool) {
    let st = app.state::<AppState>();
    let generation = {
        let mut d = st.dictation.lock().unwrap();
        if d.phase != Phase::Idle {
            return;
        }
        d.phase = Phase::Recording;
        d.hands_free = hands_free;
        d.capture = None;
        d.source_app.clear();
        d.generation += 1;
        d.generation
    };
    let shortcut = shortcut_label(&st.settings.lock().unwrap().shortcut);
    let (label, hint) = if hands_free {
        (s(app, "handsFree"), fill(&s(app, "hudHandsFreeHint"), &[("key", &shortcut)]))
    } else {
        (s(app, "listening"), s(app, "hudEscHint"))
    };
    hud::show(app, HudState { phase: "recording", label, hint, started_at: Some(now_ms()), max_ms: MAX_MS });
    set_escape(app, true);
    tauri::async_runtime::spawn(crate::api::warm(app.clone()));
    crate::tray::rebuild(app);
    // La app de adelante y el micrófono, fuera del hilo de eventos.
    let app2 = app.clone();
    std::thread::spawn(move || {
        let name = platform::frontmost_app();
        let st = app2.state::<AppState>();
        st.dictation.lock().unwrap().source_app = name;
    });
    let app3 = app.clone();
    std::thread::spawn(move || {
        let res = audio::start();
        let st = app3.state::<AppState>();
        let mut d = st.dictation.lock().unwrap();
        if d.generation != generation || d.phase != Phase::Recording {
            // Ya se canceló o terminó mientras abría el micrófono.
            drop(d);
            if let Ok(c) = res {
                let _ = c.finish();
            }
            return;
        }
        match res {
            Ok(capture) => {
                let level = capture.level.clone();
                d.capture = Some(capture);
                drop(d);
                pump_level(&app3, generation, level);
            }
            Err(e) => {
                log::warn!("mic: {e:?}");
                d.phase = Phase::Idle;
                drop(d);
                set_escape(&app3, false);
                let label = if matches!(e, audio::MicError::Denied) { s(&app3, "errMic") } else { s(&app3, "micBusy") };
                show_then_hide(&app3, "error", label);
            }
        }
    });
    // Tope de tiempo.
    let app4 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(MAX_MS));
        let same = app4.state::<AppState>().dictation.lock().unwrap().generation == generation;
        if same && is_recording(&app4) {
            stop(&app4);
        }
    });
}

fn pump_level(app: &AppHandle, generation: u64, level: std::sync::Arc<std::sync::atomic::AtomicU32>) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        {
            let st = app.state::<AppState>();
            let d = st.dictation.lock().unwrap();
            if d.generation != generation || d.phase != Phase::Recording {
                break;
            }
        }
        hud::level(&app, f32::from_bits(level.load(Ordering::Relaxed)));
        std::thread::sleep(Duration::from_millis(50));
    });
}

fn show_then_hide(app: &AppHandle, phase: &'static str, label: String) {
    hud::show(app, hud_state(app, phase, label));
    crate::tray::rebuild(app);
    let app = app.clone();
    let ms = if phase == "error" { 3200 } else { 1100 };
    let generation = app.state::<AppState>().dictation.lock().unwrap().generation;
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ms));
        let st = app.state::<AppState>();
        let d = st.dictation.lock().unwrap();
        if d.generation == generation && d.phase == Phase::Idle {
            drop(d);
            hud::show(&app, hud_state(&app, "hidden", String::new()));
        }
    });
}

pub fn cancel(app: &AppHandle) {
    let capture = {
        let st = app.state::<AppState>();
        let mut d = st.dictation.lock().unwrap();
        if d.phase != Phase::Recording {
            return;
        }
        d.phase = Phase::Idle;
        d.generation += 1;
        d.capture.take()
    };
    set_escape(app, false);
    if let Some(c) = capture {
        std::thread::spawn(move || drop(c.finish()));
    }
    hud::show(app, hud_state(app, "hidden", String::new()));
    crate::tray::rebuild(app);
}

pub fn stop(app: &AppHandle) {
    let released_at = Instant::now();
    let st = app.state::<AppState>();
    let generation = {
        let mut d = st.dictation.lock().unwrap();
        if d.phase != Phase::Recording {
            return;
        }
        d.phase = Phase::Working;
        d.generation
    };
    set_escape(app, false);
    hud::show(app, hud_state(app, "working", s(app, "working")));
    crate::tray::rebuild(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // El micrófono puede estar abriéndose todavía (toque muy corto): se espera un poco.
        let mut capture = None;
        for _ in 0..40 {
            capture = app.state::<AppState>().dictation.lock().unwrap().capture.take();
            if capture.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let Some(capture) = capture else {
            finish_idle(&app, generation);
            hud::show(&app, hud_state(&app, "hidden", String::new()));
            return;
        };
        let rec = tauri::async_runtime::spawn_blocking(move || capture.finish()).await.ok().flatten();
        let Some(rec) = rec else {
            finish_idle(&app, generation);
            show_then_hide(&app, "error", s(&app, "errFailed"));
            return;
        };
        let duration_ms = rec.duration_ms();
        if duration_ms < MIN_MS {
            finish_idle(&app, generation);
            hud::show(&app, hud_state(&app, "hidden", String::new()));
            return;
        }
        let (wav, heard) = tauri::async_runtime::spawn_blocking(move || audio::encode(&rec)).await.unwrap_or_default();
        if !heard && platform::microphone_status() != platform::PermissionStatus::Granted && cfg!(target_os = "macos") {
            finish_idle(&app, generation);
            show_then_hide(&app, "error", s(&app, "errMic"));
            return;
        }
        let audio_at = Instant::now();
        let source_app = app.state::<AppState>().dictation.lock().unwrap().source_app.clone();
        let context = platform::context_for_app(&source_app);
        let res = crate::api::dictate(&app, wav.clone(), &source_app, context, duration_ms).await;
        let server_at = Instant::now();
        match classify(res.status, res.body.as_ref()) {
            Outcome::Ok(text) => {
                wait_keys_released(&app).await;
                let how = insert_text(&app, &text).await;
                let timing = Latency {
                    total_ms: released_at.elapsed().as_millis() as u64,
                    audio_ms: (audio_at - released_at).as_millis() as u64,
                    request_ms: (server_at - audio_at).as_millis() as u64,
                    paste_ms: server_at.elapsed().as_millis() as u64,
                    transcribe_ms: server_ms(res.body.as_ref(), "transcribeMs"),
                    cleanup_ms: server_ms(res.body.as_ref(), "cleanupMs"),
                    server_ms: server_ms(res.body.as_ref(), "totalMs"),
                    ai: res.body.as_ref().and_then(|b| b.get("ai")).and_then(|v| v.as_bool()).unwrap_or(false),
                };
                eprintln!("zs-timing dictation {}", serde_json::to_string(&timing).unwrap_or_default());
                *app.state::<AppState>().last_latency.lock().unwrap() = Some(timing);
                finish_idle(&app, generation);
                show_then_hide(&app, "done", pasted_label(&app, how));
            }
            Outcome::Failed(f) => {
                let saved = keep_for_retry(f) && save_pending(&app, &wav, duration_ms, &source_app, context, f);
                finish_idle(&app, generation);
                show_then_hide(&app, "error", failure_label(&app, f, saved));
            }
        }
    });
}

/// Dónde se fue el tiempo de un dictado (Ajustes › Historial lo muestra).
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Latency {
    /// Desde soltar el atajo hasta el texto pegado.
    pub total_ms: u64,
    /// Cerrar el micrófono y armar el WAV.
    pub audio_ms: u64,
    /// El pedido entero (subida, servidor y respuesta).
    pub request_ms: u64,
    pub paste_ms: u64,
    /// Lo que dice el servidor (si lo manda).
    pub transcribe_ms: Option<u64>,
    pub cleanup_ms: Option<u64>,
    pub server_ms: Option<u64>,
    pub ai: bool,
}

fn server_ms(body: Option<&serde_json::Value>, key: &str) -> Option<u64> {
    body?.get("timings")?.get(key)?.as_u64()
}

fn finish_idle(app: &AppHandle, generation: u64) {
    let st = app.state::<AppState>();
    let mut d = st.dictation.lock().unwrap();
    if d.generation == generation {
        d.phase = Phase::Idle;
        d.hands_free = false;
    }
}

fn save_pending(app: &AppHandle, wav: &[u8], duration_ms: u64, source_app: &str, context: &str, failure: Failure) -> bool {
    let st = app.state::<AppState>();
    let now = now_ms();
    let meta = PendingMeta {
        id: new_pending_id(now, rand::random::<u32>()),
        created_at: now,
        mime: "audio/wav".into(),
        duration_ms,
        source_app: source_app.chars().take(100).collect(),
        context: context.into(),
        failure,
        attempts: 0,
    };
    let ok = st.pending.save(&meta, wav);
    st.pending.list(now); // poda
    crate::tray::rebuild(app);
    ok
}

pub fn failure_label(app: &AppHandle, f: Failure, saved: bool) -> String {
    let key = match f {
        Failure::Offline => "errOffline",
        Failure::SignedOut => "errSignedOut",
        Failure::RateLimited => "errRateLimited",
        Failure::Server => "errServer",
        Failure::TooLarge => "errTooLarge",
        Failure::Empty => "errEmpty",
        Failure::Rejected => "errFailed",
    };
    if saved {
        format!("{}. {}", s(app, key), s(app, "savedToRetry"))
    } else {
        s(app, key)
    }
}

fn pasted_label(app: &AppHandle, how: How) -> String {
    match how {
        How::Pasted => s(app, "pasted"),
        How::Copied => fill(&s(app, "copied"), &[("key", if cfg!(target_os = "macos") { "⌘V" } else { "Ctrl+V" })]),
    }
}

/// Teclas del atajo todavía apretadas (Option apretado convertiría Cmd+V en Cmd+Option+V).
async fn wait_keys_released(app: &AppHandle) {
    for _ in 0..100 {
        if app.state::<AppState>().dictation.lock().unwrap().pressed_at.is_none() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}

// ---------- Portapapeles del sistema ----------

pub enum Snap {
    Empty,
    Text(String),
    Image(arboard::ImageData<'static>),
}

struct SystemClipboard(arboard::Clipboard);

impl ClipboardPort for SystemClipboard {
    type Snapshot = Snap;
    fn snapshot(&mut self) -> Option<Snap> {
        if let Ok(t) = self.0.get_text() {
            return Some(Snap::Text(t));
        }
        if let Ok(i) = self.0.get_image() {
            return Some(Snap::Image(i.to_owned_img()));
        }
        Some(Snap::Empty)
    }
    fn is_empty(s: &Snap) -> bool {
        matches!(s, Snap::Empty)
    }
    fn write_text(&mut self, text: &str) -> bool {
        self.0.set_text(text).is_ok()
    }
    fn read_text(&mut self) -> Option<String> {
        self.0.get_text().ok()
    }
    fn restore(&mut self, s: Snap) -> bool {
        match s {
            Snap::Empty => self.0.clear().is_ok(),
            Snap::Text(t) => self.0.set_text(t).is_ok(),
            Snap::Image(i) => self.0.set_image(i).is_ok(),
        }
    }
    fn clear(&mut self) {
        let _ = self.0.clear();
    }
}

/// La tecla de la "v" con la distribución de teclado actual. En Mac se busca en el hilo principal
/// (las APIs de teclado de macOS lo exigen); si no contesta a tiempo, la V de QWERTY.
async fn paste_keycode(app: &AppHandle) -> u16 {
    if !cfg!(target_os = "macos") {
        return 0;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    if app.run_on_main_thread(move || drop(tx.send(platform::paste_keycode()))).is_err() {
        return 9;
    }
    tokio::time::timeout(Duration::from_millis(400), rx).await.ok().and_then(|r| r.ok()).unwrap_or(9)
}

/// Pega en la app con el foco (o deja copiado si no hay permiso). Corre en un hilo aparte.
pub async fn insert_text(app: &AppHandle, text: &str) -> How {
    *app.state::<AppState>().last_text.lock().unwrap() = text.to_string();
    let restore = app.state::<AppState>().settings.lock().unwrap().restore_clipboard;
    let can_paste = platform::can_simulate_paste();
    let keycode = if can_paste { paste_keycode(app).await } else { 0 };
    let text = text.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(cb) = arboard::Clipboard::new() else { return How::Copied };
        let mut port = SystemClipboard(cb);
        let mut tap = move || platform::tap_paste(keycode);
        let tap: Option<&mut dyn FnMut() -> bool> = if can_paste { Some(&mut tap) } else { None };
        paste_via_clipboard(&mut port, &text, tap, restore, &mut |d| std::thread::sleep(d)).0
    })
    .await
    .unwrap_or(How::Copied)
}

/// Manda de nuevo un dictado guardado. El texto queda copiado (no se pega solo: la persona ya
/// puede estar en otra app) y en el historial de Voice.
pub async fn retry_pending(app: &AppHandle, id: &str) -> Result<String, Failure> {
    let st = app.state::<AppState>();
    let Some((meta, audio)) = st.pending.read(id, now_ms()) else { return Err(Failure::Rejected) };
    hud::show(app, hud_state(app, "working", s(app, "sending")));
    let res = crate::api::dictate(app, audio, &meta.source_app, &meta.context, meta.duration_ms).await;
    match classify(res.status, res.body.as_ref()) {
        Outcome::Ok(text) => {
            st.pending.remove(&meta.id);
            if let Ok(mut cb) = arboard::Clipboard::new() {
                let _ = cb.set_text(text.clone());
            }
            *st.last_text.lock().unwrap() = text.clone();
            crate::tray::rebuild(app);
            show_then_hide(app, "done", pasted_label(app, How::Copied));
            Ok(text)
        }
        Outcome::Failed(f) => {
            if keep_for_retry(f) {
                st.pending.mark_attempt(&meta.id, f, now_ms());
            } else {
                st.pending.remove(&meta.id);
            }
            crate::tray::rebuild(app);
            show_then_hide(app, "error", failure_label(app, f, keep_for_retry(f)));
            Err(f)
        }
    }
}

pub async fn retry_all(app: &AppHandle) {
    let ids: Vec<String> = app.state::<AppState>().pending.list(now_ms()).into_iter().map(|m| m.id).collect();
    for id in ids {
        if retry_pending(app, &id).await == Err(Failure::Offline) {
            break;
        }
    }
}

/// Pegar otra vez el último dictado: el de esta sesión o, si no hay, el último del historial.
pub async fn paste_last(app: &AppHandle) {
    let mut text = app.state::<AppState>().last_text.lock().unwrap().clone();
    if text.is_empty() {
        let res = crate::api::get(app, "/api/voice/sessions?kind=dictation&limit=1").await;
        text = res.body.as_ref().and_then(|b| b.pointer("/sessions/0/text")).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    }
    if text.is_empty() {
        show_then_hide(app, "error", s(app, "noRecent"));
        return;
    }
    wait_keys_released(app).await;
    let how = insert_text(app, &text).await;
    show_then_hide(app, "done", pasted_label(app, how));
}

// ---------- Atajos ----------

fn on_main_shortcut(app: &AppHandle, state: ShortcutState) {
    let st = app.state::<AppState>();
    let mode = st.settings.lock().unwrap().mode.clone();
    let (phase, hands_free, pressed_at) = {
        let mut d = st.dictation.lock().unwrap();
        let prev = d.pressed_at;
        d.pressed_at = if state == ShortcutState::Pressed { Some(Instant::now()) } else { None };
        (d.phase, d.hands_free, prev)
    };
    match state {
        ShortcutState::Pressed => match phase {
            Phase::Idle => start(app, mode == "toggle"),
            // Manos libres: el próximo toque termina.
            Phase::Recording if hands_free => stop(app),
            _ => {}
        },
        ShortcutState::Released => {
            if phase != Phase::Recording || hands_free {
                return;
            }
            let held = pressed_at.map(|t| t.elapsed()).unwrap_or(HOLD);
            if held >= HOLD {
                stop(app);
            } else if mode == "both" {
                // Un toque corto: sigue escuchando hasta el próximo toque.
                st.dictation.lock().unwrap().hands_free = true;
                let shortcut = shortcut_label(&st.settings.lock().unwrap().shortcut);
                hud::show(
                    app,
                    HudState {
                        phase: "recording",
                        label: s(app, "handsFree"),
                        hint: fill(&s(app, "hudHandsFreeHint"), &[("key", &shortcut)]),
                        started_at: None,
                        max_ms: MAX_MS,
                    },
                );
            } else {
                cancel(app);
            }
        }
    }
}

/// Registra el atajo de dictado y el de pegar el último. Devuelve false si el de dictado está
/// ocupado por otra app.
pub fn register_shortcuts(app: &AppHandle, previous: Option<&str>) -> bool {
    let gs = app.global_shortcut();
    if let Some(p) = previous {
        let _ = gs.unregister(p);
    }
    let accel = app.state::<AppState>().settings.lock().unwrap().shortcut.clone();
    let ok = gs.is_registered(accel.as_str()) || gs.on_shortcut(accel.as_str(), |app, _, ev| on_main_shortcut(app, ev.state)).is_ok();
    app.state::<AppState>().shortcut_taken.store(!ok, Ordering::Relaxed);
    let last = paste_last_shortcut(if cfg!(target_os = "macos") { "macos" } else { "windows" });
    if !gs.is_registered(last) {
        let _ = gs.on_shortcut(last, |app, _, ev| {
            if ev.state == ShortcutState::Pressed {
                let app = app.clone();
                tauri::async_runtime::spawn(async move { paste_last(&app).await });
            }
        });
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        let l = shortcut_label("CommandOrControl+Shift+D");
        assert!(l == "Command + Shift + D" || l == "Ctrl + Shift + D");
        assert!(shortcut_label("Alt+Space").ends_with("+ Space"));
    }
}
