//! zerosoft Voice para escritorio (Tauri v2).
//!
//! - Dictado: mantener el atajo global (Control+Alt+Space por defecto) graba
//!   el micrófono; al soltar sube el audio a /api/v1/voice/dictate y pega el
//!   texto limpio en la app activa.
//! - Reuniones: desde la bandeja o la ventana, graba el micrófono ("me") y el
//!   audio del sistema ("them": ScreenCaptureKit en macOS, WASAPI loopback en
//!   Windows) y sube un trozo de cada uno cada 20 s a la reunión. La nota se
//!   arma después en zerosoft (Voice › Reuniones).
//!
//! El audio vive en un hilo propio (los streams de cpal no son Send en todas
//! las plataformas); la UI y el atajo le mandan órdenes por un canal.

mod api;
mod audio;
mod config;
mod paste;
mod system_audio;

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use config::Config;

/// Duración de cada trozo de una reunión.
const CHUNK: Duration = Duration::from_secs(20);
/// Tope de un dictado: 2 minutos de WAV a 16 kHz entran en el límite de 4 MB de la API.
const DICTATION_MAX: Duration = Duration::from_secs(120);
/// Pico mínimo para subir un trozo (más bajo es silencio).
const SILENCE: f32 = 0.01;

enum Command {
    StartDictation,
    StopDictation,
    StartMeeting { session: String },
    StopMeeting,
}

#[derive(Clone, Serialize, Default)]
struct Status {
    dictating: bool,
    meeting: Option<String>,
    last_text: String,
    message: String,
}

struct AppState {
    tx: Mutex<Sender<Command>>,
    config: Mutex<Config>,
    config_dir: PathBuf,
    status: Mutex<Status>,
}

fn emit_status(app: &AppHandle) {
    let state = app.state::<AppState>();
    let s = state.status.lock().clone();
    let _ = app.emit("voice://status", s);
}

fn set_message(app: &AppHandle, msg: impl Into<String>) {
    app.state::<AppState>().status.lock().message = msg.into();
    emit_status(app);
}

/// Hilo de audio: dueño de los streams de captura.
fn audio_thread(app: AppHandle, rx: Receiver<Command>) {
    let mut dictation: Option<(audio::Capture, Instant)> = None;
    let mut meeting: Option<Meeting> = None;
    loop {
        let timeout = if meeting.is_some() || dictation.is_some() { Duration::from_millis(250) } else { Duration::from_secs(3600) };
        match rx.recv_timeout(timeout) {
            Ok(Command::StartDictation) => {
                if dictation.is_some() {
                    continue;
                }
                match audio::capture_mic() {
                    Ok(cap) => {
                        dictation = Some((cap, Instant::now()));
                        app.state::<AppState>().status.lock().dictating = true;
                        emit_status(&app);
                    }
                    Err(e) => set_message(&app, format!("Microphone: {e}")),
                }
            }
            Ok(Command::StopDictation) => {
                if let Some((cap, started)) = dictation.take() {
                    finish_dictation(&app, cap, started);
                }
            }
            Ok(Command::StartMeeting { session }) => {
                if meeting.is_some() {
                    continue;
                }
                match Meeting::start(session.clone()) {
                    Ok(m) => {
                        let note = if m.system.is_none() { " (microphone only: allow screen and audio recording to capture the call)" } else { "" };
                        meeting = Some(m);
                        let state = app.state::<AppState>();
                        state.status.lock().meeting = Some(session);
                        set_message(&app, format!("Recording the meeting{note}"));
                    }
                    Err(e) => set_message(&app, format!("Could not start: {e}")),
                }
            }
            Ok(Command::StopMeeting) => {
                if let Some(m) = meeting.take() {
                    let session = m.session.clone();
                    m.flush(&app, true);
                    let cfg = app.state::<AppState>().config.lock().clone();
                    let _ = api::finish_meeting(&cfg, &session);
                    app.state::<AppState>().status.lock().meeting = None;
                    set_message(&app, "Meeting saved. Open Voice › Meetings to write the notes.");
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        if let Some(m) = meeting.as_mut() {
            if m.chunk_started.elapsed() >= CHUNK {
                m.flush(&app, false);
            }
        }
        if let Some((_, started)) = &dictation {
            if started.elapsed() >= DICTATION_MAX {
                let (cap, started) = dictation.take().unwrap();
                finish_dictation(&app, cap, started);
            }
        }
    }
}

fn finish_dictation(app: &AppHandle, cap: audio::Capture, started: Instant) {
    let samples = cap.buffer.take();
    let rate = cap.buffer.sample_rate;
    drop(cap);
    let state = app.state::<AppState>();
    state.status.lock().dictating = false;
    emit_status(app);
    if started.elapsed() < Duration::from_millis(300) || audio::peak(&samples) < SILENCE {
        return;
    }
    let cfg = state.config.lock().clone();
    let duration = audio::duration_ms(samples.len(), rate);
    let app = app.clone();
    // La subida y el pegado van fuera del hilo de audio.
    std::thread::spawn(move || {
        set_message(&app, "Transcribing…");
        let result = audio::to_wav_16k(&samples, rate).and_then(|wav| api::dictate(&cfg, wav, duration, "desktop"));
        match result {
            Ok(d) if !d.text.is_empty() => {
                app.state::<AppState>().status.lock().last_text = d.text.clone();
                if paste::paste(&d.text).is_err() {
                    let _ = paste::copy(&d.text);
                    set_message(&app, "Copied (could not paste: allow Accessibility for zerosoft Voice)");
                } else {
                    set_message(&app, "");
                }
            }
            Ok(_) => set_message(&app, "Nothing was heard"),
            Err(e) => set_message(&app, format!("Dictation failed: {e}")),
        }
    });
}

struct Meeting {
    session: String,
    mic: audio::Capture,
    system: Option<system_audio::SystemCapture>,
    started: Instant,
    chunk_started: Instant,
}

impl Meeting {
    fn start(session: String) -> anyhow::Result<Self> {
        let mic = audio::capture_mic()?;
        // Sin permiso de captura (o en Linux) se sigue con el micrófono.
        let system = system_audio::start().map_err(|e| eprintln!("[voice] system audio: {e}")).ok();
        let now = Instant::now();
        Ok(Self { session, mic, system, started: now, chunk_started: now })
    }

    /// Corta el trozo actual de cada fuente y lo sube en otro hilo.
    fn flush(&mut self, app: &AppHandle, last: bool) {
        let offset = self.chunk_started.duration_since(self.started).as_millis() as u64;
        let seq = offset / 100;
        let mut parts = vec![("me", self.mic.buffer.take(), self.mic.buffer.sample_rate)];
        if let Some(sys) = &self.system {
            parts.push(("them", sys.buffer.take(), sys.buffer.sample_rate));
        }
        self.chunk_started = Instant::now();
        let cfg = app.state::<AppState>().config.lock().clone();
        let session = self.session.clone();
        let handle = std::thread::spawn(move || {
            for (source, samples, rate) in parts {
                if audio::peak(&samples) < SILENCE {
                    continue;
                }
                let duration = audio::duration_ms(samples.len(), rate);
                let Ok(wav) = audio::to_wav_16k(&samples, rate) else { continue };
                // Reintentos simples: la API es idempotente por (fuente, seq).
                for attempt in 0..3 {
                    match api::upload_chunk(&cfg, &session, source, seq, offset, duration, wav.clone()) {
                        Ok(()) => break,
                        Err(e) => {
                            eprintln!("[voice] chunk upload failed ({attempt}): {e}");
                            std::thread::sleep(Duration::from_secs(2 * (attempt + 1)));
                        }
                    }
                }
            }
        });
        if last {
            let _ = handle.join();
        }
    }
}

// ---------- Comandos de la ventana ----------

/// La ventana nunca recibe la API key: solo si hay una guardada.
#[tauri::command]
fn get_config(state: State<'_, AppState>) -> config::PublicConfig {
    state.config.lock().public()
}

#[tauri::command]
fn get_status(state: State<'_, AppState>) -> Status {
    state.status.lock().clone()
}

#[tauri::command]
fn save_config(app: AppHandle, state: State<'_, AppState>, input: config::ConfigInput) -> Result<(), String> {
    if !config::valid_server(&input.server) {
        return Err("The server must use https:// (http only for localhost)".into());
    }
    let current_key = state.config.lock().api_key.clone();
    let config = Config {
        server: input.server.trim().trim_end_matches('/').to_string(),
        api_key: input.api_key.filter(|k| !k.trim().is_empty()).map(|k| k.trim().to_string()).unwrap_or(current_key),
        shortcut: input.shortcut,
        context: input.context,
    };
    api::ping(&config).map_err(|e| format!("Could not connect: {e}"))?;
    config::save(&state.config_dir, &config).map_err(|e| e.to_string())?;
    let old = std::mem::replace(&mut *state.config.lock(), config.clone());
    if old.shortcut != config.shortcut {
        let gs = app.global_shortcut();
        let _ = gs.unregister(old.shortcut.as_str());
        gs.register(config.shortcut.as_str()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_meeting(state: State<'_, AppState>, title: String) -> Result<String, String> {
    let cfg = state.config.lock().clone();
    let id = api::create_meeting(&cfg, &title).map_err(|e| e.to_string())?;
    state.tx.lock().send(Command::StartMeeting { session: id.clone() }).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
fn stop_meeting(state: State<'_, AppState>) -> Result<(), String> {
    state.tx.lock().send(Command::StopMeeting).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_last(state: State<'_, AppState>) -> Result<(), String> {
    let text = state.status.lock().last_text.clone();
    paste::copy(&text).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    let state = app.state::<AppState>();
                    let cmd = match event.state() {
                        ShortcutState::Pressed => Command::StartDictation,
                        ShortcutState::Released => Command::StopDictation,
                    };
                    let _ = state.tx.lock().send(cmd);
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from("."));
            let cfg = config::load(&dir);
            let (tx, rx) = mpsc::channel();
            app.manage(AppState { tx: Mutex::new(tx), config: Mutex::new(cfg.clone()), config_dir: dir, status: Mutex::new(Status::default()) });
            let handle = app.handle().clone();
            std::thread::spawn(move || audio_thread(handle, rx));
            if let Err(e) = app.global_shortcut().register(cfg.shortcut.as_str()) {
                eprintln!("[voice] shortcut {}: {e}", cfg.shortcut);
            }

            let open = MenuItem::with_id(app, "open", "Open zerosoft Voice", true, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start meeting", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop meeting", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &start, &stop, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("icon"))
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "start" => {
                        let state = app.state::<AppState>();
                        let cfg = state.config.lock().clone();
                        match api::create_meeting(&cfg, "") {
                            Ok(id) => {
                                let _ = state.tx.lock().send(Command::StartMeeting { session: id });
                            }
                            Err(e) => set_message(app, format!("Could not start: {e}")),
                        }
                    }
                    "stop" => {
                        let _ = app.state::<AppState>().tx.lock().send(Command::StopMeeting);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, get_status, save_config, start_meeting, stop_meeting, copy_last])
        .run(tauri::generate_context!())
        .expect("error while running zerosoft Voice");
}
