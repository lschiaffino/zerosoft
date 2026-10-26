//! Audio del sistema para reuniones ("Ellos" en la transcripción):
//! - macOS 13+: ScreenCaptureKit (solo el audio; la imagen se descarta).
//! - Windows: WASAPI loopback con cpal.
//! - Otros: no disponible (se graba solo el micrófono).

use anyhow::Result;

use crate::audio::SharedBuffer;

#[cfg(target_os = "macos")]
mod macos;

/// Captura viva del audio del sistema; al soltarla se corta. Vive y se suelta
/// en el hilo de audio (lib.rs › audio_thread), así que no necesita ser Send.
pub struct SystemCapture {
    pub buffer: SharedBuffer,
    #[allow(dead_code)]
    inner: Box<dyn std::any::Any>,
}

#[cfg(target_os = "macos")]
pub fn start() -> Result<SystemCapture> {
    let (buffer, inner) = macos::start()?;
    Ok(SystemCapture { buffer, inner: Box::new(inner) })
}

#[cfg(target_os = "windows")]
pub fn start() -> Result<SystemCapture> {
    let cap = crate::audio::capture_loopback()?;
    let buffer = cap.buffer.clone();
    Ok(SystemCapture { buffer, inner: Box::new(cap) })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn start() -> Result<SystemCapture> {
    Err(anyhow::anyhow!("system audio capture is only available on macOS and Windows"))
}
