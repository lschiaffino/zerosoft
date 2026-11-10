//! Audio del sistema (lo que suena en la compu: la otra gente de una llamada) para las notas de
//! reunión. En Mac usa ScreenCaptureKit (macOS 13 o más), que pide el permiso de Grabación de
//! pantalla y audio del sistema. La página lo pide por el puente: `start`, `read` cada ~250 ms (PCM
//! de 16 bits, 16 kHz, mono, en base64) y `stop`. El stream vive en su propio hilo, como el
//! micrófono (audio.rs). Fuera de Mac no hay captura nativa: la página usa getDisplayMedia.

#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// Muestras (i16 mono a 16 kHz) pendientes de leer. Se acota a 60 s por si la página deja de leer.
static BUF: Mutex<Vec<i16>> = Mutex::new(Vec::new());
const MAX_SAMPLES: usize = 16_000 * 60;
static RUNNING: AtomicBool = AtomicBool::new(false);
/// Última lectura de la página (ms desde 1970). Si la página deja de leer (se cerró la pestaña, se
/// recargó o navegó), la captura se corta sola a los IDLE_STOP_MS: nadie queda grabado sin saberlo.
static LAST_READ: AtomicU64 = AtomicU64::new(0);
const IDLE_STOP_MS: u64 = 30_000;
static STOP: OnceLock<Mutex<Option<std::sync::mpsc::Sender<()>>>> = OnceLock::new();

#[derive(Debug, PartialEq, Eq)]
pub enum SysAudio {
    Ok,
    /// Falta el permiso de Grabación de pantalla y audio del sistema.
    Denied,
    /// Este sistema no puede (no es Mac o es anterior a macOS 13).
    Unsupported,
    Failed,
}

impl SysAudio {
    pub fn code(&self) -> &'static str {
        match self {
            SysAudio::Ok => "ok",
            SysAudio::Denied => "denied",
            SysAudio::Unsupported => "unsupported",
            SysAudio::Failed => "failed",
        }
    }
}

/// Float [-1, 1] → i16.
pub fn to_i16(x: f32) -> i16 {
    (x.clamp(-1.0, 1.0) * 32767.0) as i16
}

/// Promedia los canales de un buffer no entrelazado (un buffer f32 por canal) a mono.
pub fn mix_mono(channels: &[Vec<f32>]) -> Vec<f32> {
    let n = channels.iter().map(|c| c.len()).min().unwrap_or(0);
    if channels.is_empty() || n == 0 {
        return Vec::new();
    }
    (0..n).map(|i| channels.iter().map(|c| c[i]).sum::<f32>() / channels.len() as f32).collect()
}

fn push(samples: &[f32]) {
    if let Ok(mut b) = BUF.lock() {
        b.extend(samples.iter().map(|s| to_i16(*s)));
        let over = b.len().saturating_sub(MAX_SAMPLES);
        if over > 0 {
            b.drain(..over);
        }
    }
}

/// Lo acumulado desde la última lectura, como bytes i16 little endian.
pub fn read() -> Vec<u8> {
    touch();
    let taken: Vec<i16> = BUF.lock().map(|mut b| std::mem::take(&mut *b)).unwrap_or_default();
    taken.iter().flat_map(|s| s.to_le_bytes()).collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn touch() {
    LAST_READ.store(now_ms(), Ordering::Relaxed);
}

/// La página no lee hace más de IDLE_STOP_MS.
pub fn idle(now: u64, last: u64) -> bool {
    now.saturating_sub(last) > IDLE_STOP_MS
}

pub fn running() -> bool {
    RUNNING.load(Ordering::Relaxed)
}

pub fn stop() {
    if let Some(m) = STOP.get() {
        if let Some(tx) = m.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(());
        }
    }
    RUNNING.store(false, Ordering::Relaxed);
    if let Ok(mut b) = BUF.lock() {
        b.clear();
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use screencapturekit::prelude::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    pub fn permission() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    /// Muestra el aviso de macOS la primera vez (después no hace nada: hay que ir a Ajustes).
    pub fn ask_permission() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }

    struct Handler;

    impl SCStreamOutputTrait for Handler {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
            if !matches!(output_type, SCStreamOutputType::Audio) {
                return;
            }
            let Some(list) = sample.audio_buffer_list() else { return };
            // Float32 no entrelazado: un buffer por canal (se pidió mono, normalmente es uno).
            let channels: Vec<Vec<f32>> = list
                .iter()
                .map(|b| b.data().chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
                .collect();
            push(&mix_mono(&channels));
        }
    }

    pub fn start() -> SysAudio {
        if !permission() {
            ask_permission();
            return SysAudio::Denied;
        }
        let (ready_tx, ready_rx) = mpsc::channel::<SysAudio>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let spawned = std::thread::Builder::new().name("zs-sysaudio".into()).spawn(move || {
            let built = (|| -> Result<SCStream, String> {
                let content = SCShareableContent::get().map_err(|e| format!("{e:?}"))?;
                let display = content.displays().into_iter().next().ok_or("no display")?;
                let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build();
                // Solo audio: el video mínimo que ScreenCaptureKit exige no se usa.
                let config = SCStreamConfiguration::new()
                    .with_width(2)
                    .with_height(2)
                    .with_captures_audio(true)
                    .with_excludes_current_process_audio(true)
                    .with_sample_rate(16000)
                    .with_channel_count(1);
                let mut stream = SCStream::new(&filter, &config);
                stream.add_output_handler(Handler, SCStreamOutputType::Audio).ok_or("no audio handler")?;
                stream.start_capture().map_err(|e| format!("{e:?}"))?;
                Ok(stream)
            })();
            match built {
                Ok(stream) => {
                    let _ = ready_tx.send(SysAudio::Ok);
                    touch();
                    // Sale con `stop`, o sola si la página dejó de leer.
                    loop {
                        match stop_rx.recv_timeout(Duration::from_secs(2)) {
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if idle(now_ms(), LAST_READ.load(Ordering::Relaxed)) {
                                    log::info!("system audio: sin lecturas, se corta la captura");
                                    RUNNING.store(false, Ordering::Relaxed);
                                    if let Ok(mut b) = BUF.lock() {
                                        b.clear();
                                    }
                                    break;
                                }
                            }
                            _ => break,
                        }
                    }
                    let _ = stream.stop_capture();
                }
                Err(e) => {
                    log::warn!("system audio: {e}");
                    let _ = ready_tx.send(SysAudio::Failed);
                }
            }
        });
        if spawned.is_err() {
            return SysAudio::Failed;
        }
        match ready_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(SysAudio::Ok) => {
                *STOP.get_or_init(|| Mutex::new(None)).lock().unwrap() = Some(stop_tx);
                RUNNING.store(true, Ordering::Relaxed);
                SysAudio::Ok
            }
            Ok(other) => other,
            Err(_) => {
                let _ = stop_tx.send(());
                SysAudio::Failed
            }
        }
    }
}

/// Empieza a capturar el audio del sistema. Si ya estaba, la reinicia (sin dejar dos capturas).
pub fn start() -> SysAudio {
    stop();
    #[cfg(target_os = "macos")]
    return mac::start();
    #[cfg(not(target_os = "macos"))]
    SysAudio::Unsupported
}

/// ¿Está concedido el permiso de Grabación de pantalla? (siempre true donde no hace falta)
pub fn permission_granted() -> bool {
    #[cfg(target_os = "macos")]
    return mac::permission();
    #[cfg(not(target_os = "macos"))]
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_i16_clamps() {
        assert_eq!(to_i16(0.0), 0);
        assert_eq!(to_i16(1.0), 32767);
        assert_eq!(to_i16(-2.0), -32767);
    }

    #[test]
    fn idle_after_thirty_seconds_without_reads() {
        assert!(!idle(40_000, 20_000));
        assert!(idle(51_000, 20_000));
        assert!(!idle(10, 20_000));
    }

    #[test]
    fn mix_mono_averages_channels() {
        assert_eq!(mix_mono(&[vec![1.0, 0.0], vec![0.0, 1.0]]), vec![0.5, 0.5]);
        assert!(mix_mono(&[]).is_empty());
    }
}
