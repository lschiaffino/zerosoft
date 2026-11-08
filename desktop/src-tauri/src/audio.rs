//! Micrófono con cpal. El stream vive en su propio hilo (en Mac no es Send): `start` lo abre y
//! espera a que arranque; `finish` lo corta y devuelve las muestras (mono, a la frecuencia del
//! dispositivo). El nivel (pico de los últimos ~20 ms) queda en un atómico para el HUD.
//! Para mandar: se pasa a 16 kHz mono y WAV de 16 bits (32 KB por segundo, 2 min ≈ 3,8 MB).

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub const TARGET_RATE: u32 = 16_000;

pub struct Recorded {
    pub samples: Vec<f32>,
    pub rate: u32,
}

impl Recorded {
    pub fn duration_ms(&self) -> u64 {
        if self.rate == 0 {
            0
        } else {
            self.samples.len() as u64 * 1000 / self.rate as u64
        }
    }
}

pub struct Capture {
    stop: mpsc::Sender<()>,
    done: mpsc::Receiver<Recorded>,
    pub level: Arc<AtomicU32>,
}

#[derive(Debug)]
pub enum MicError {
    Denied,
    NoDevice,
    /// El detalle va al log (Debug).
    #[allow(dead_code)]
    Failed(String),
}

impl Capture {
    /// Corta y devuelve lo grabado.
    pub fn finish(self) -> Option<Recorded> {
        let _ = self.stop.send(());
        self.done.recv_timeout(Duration::from_secs(3)).ok()
    }
}

pub fn start() -> Result<Capture, MicError> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), MicError>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (done_tx, done_rx) = mpsc::channel::<Recorded>();
    let level = Arc::new(AtomicU32::new(0f32.to_bits()));
    let level_cb = level.clone();
    thread::Builder::new()
        .name("zs-mic".into())
        .spawn(move || {
            use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
            let host = cpal::default_host();
            let Some(device) = host.default_input_device() else {
                let _ = ready_tx.send(Err(MicError::NoDevice));
                return;
            };
            let config = match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    let _ = ready_tx.send(Err(MicError::Failed(e.to_string())));
                    return;
                }
            };
            let rate = config.sample_rate().0;
            let channels = config.channels() as usize;
            let buf = Arc::new(Mutex::new(Vec::<f32>::with_capacity(rate as usize * 30)));
            let push = {
                let buf = buf.clone();
                move |frames: &mut dyn Iterator<Item = f32>| {
                    let mut peak = 0f32;
                    let mut out = buf.lock().unwrap();
                    let mut acc = 0f32;
                    let mut n = 0usize;
                    for s in frames {
                        acc += s;
                        n += 1;
                        if n == channels {
                            let m = acc / channels as f32;
                            peak = peak.max(m.abs());
                            out.push(m);
                            acc = 0.0;
                            n = 0;
                        }
                    }
                    level_cb.store(peak.to_bits(), Ordering::Relaxed);
                }
            };
            let err_fn = |e| log::warn!("mic stream error: {e}");
            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => {
                    let push = push;
                    device.build_input_stream(&config.into(), move |d: &[f32], _| push(&mut d.iter().copied()), err_fn, None)
                }
                cpal::SampleFormat::I16 => {
                    let push = push;
                    device.build_input_stream(&config.into(), move |d: &[i16], _| push(&mut d.iter().map(|s| *s as f32 / 32768.0)), err_fn, None)
                }
                cpal::SampleFormat::U16 => {
                    let push = push;
                    device.build_input_stream(&config.into(), move |d: &[u16], _| push(&mut d.iter().map(|s| (*s as f32 - 32768.0) / 32768.0)), err_fn, None)
                }
                f => {
                    let _ = ready_tx.send(Err(MicError::Failed(format!("sample format {f:?}"))));
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let msg = e.to_string();
                    let denied = msg.to_ascii_lowercase().contains("permission");
                    let _ = ready_tx.send(Err(if denied { MicError::Denied } else { MicError::Failed(msg) }));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(MicError::Failed(e.to_string())));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            // Hasta que manden cortar (o se caiga main): tope duro de 10 min por las dudas.
            let _ = stop_rx.recv_timeout(Duration::from_secs(600));
            drop(stream);
            // En Mac, sin permiso de micrófono el stream "anda" pero llega silencio puro o nada.
            let samples = std::mem::take(&mut *buf.lock().unwrap());
            let _ = done_tx.send(Recorded { samples, rate });
        })
        .map_err(|e| MicError::Failed(e.to_string()))?;
    match ready_rx.recv_timeout(Duration::from_secs(4)) {
        Ok(Ok(())) => Ok(Capture { stop: stop_tx, done: done_rx, level }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(MicError::Failed("timeout".into())),
    }
}

/// Remuestreo lineal a `to` Hz (suficiente para voz que va a un modelo de transcripción).
pub fn resample(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.is_empty() || from == 0 {
        return samples.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let n = ((samples.len() as f64) / ratio).floor() as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let j = pos.floor() as usize;
            let frac = (pos - j as f64) as f32;
            let a = samples[j];
            let b = *samples.get(j + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}

/// WAV PCM 16 bits mono.
pub fn wav_bytes(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

/// Lo grabado → WAV a 16 kHz. También dice si hubo sonido (pico > umbral): sin permiso de
/// micrófono, macOS entrega silencio absoluto.
pub fn encode(rec: &Recorded) -> (Vec<u8>, bool) {
    let mono = resample(&rec.samples, rec.rate, TARGET_RATE);
    let heard = mono.iter().any(|s| s.abs() > 0.0005);
    (wav_bytes(&mono, TARGET_RATE), heard)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header() {
        let w = wav_bytes(&[0.0, 1.0, -1.0], 16_000);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(&w[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()), 6);
        assert_eq!(i16::from_le_bytes(w[46..48].try_into().unwrap()), 32767);
        assert_eq!(i16::from_le_bytes(w[48..50].try_into().unwrap()), -32767);
        assert_eq!(w.len(), 44 + 6);
    }

    #[test]
    fn resample_48k_to_16k() {
        let s: Vec<f32> = (0..48_000).map(|i| i as f32 / 48_000.0).collect();
        let r = resample(&s, 48_000, 16_000);
        assert_eq!(r.len(), 16_000);
        assert!((r[8_000] - 0.5).abs() < 0.001);
        assert_eq!(resample(&s[..10], 16_000, 16_000).len(), 10);
    }

    #[test]
    fn silence_is_detected() {
        let (_, heard) = encode(&Recorded { samples: vec![0.0; 4_800], rate: 48_000 });
        assert!(!heard);
        let (wav, heard) = encode(&Recorded { samples: vec![0.2; 4_800], rate: 48_000 });
        assert!(heard);
        assert_eq!(wav.len(), 44 + 1_600 * 2);
        assert_eq!(Recorded { samples: vec![0.0; 48_000], rate: 48_000 }.duration_ms(), 1000);
    }
}
