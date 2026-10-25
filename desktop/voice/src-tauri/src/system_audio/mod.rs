//! Audio del sistema para reuniones ("Ellos" en la transcripción):
//! - macOS 13+: ScreenCaptureKit (solo el audio; la imagen se descarta).
//! - Windows: WASAPI loopback con cpal.
//! - Otros: no disponible (se graba solo el micrófono).

use anyhow::Result;

use crate::audio::SharedBuffer;

#[cfg(target_os = "macos")]
mod macos;

/// Captura viva del audio del sistema; al soltarla se corta.
pub struct SystemCapture {
    pub buffer: SharedBuffer,
    #[allow(dead_code)]
    inner: Box<dyn std::any::Any + Send>,
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
    Ok(SystemCapture { buffer, inner: Box::new(SendStream(cap)) })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn start() -> Result<SystemCapture> {
    Err(anyhow::anyhow!("system audio capture is only available on macOS and Windows"))
}

/// cpal::Stream no es Send en todas las plataformas; se mantiene en el hilo que lo creó.
#[cfg(target_os = "windows")]
struct SendStream(#[allow(dead_code)] crate::audio::Capture);
#[cfg(target_os = "windows")]
unsafe impl Send for SendStream {}
