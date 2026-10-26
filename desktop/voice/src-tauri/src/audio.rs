//! Captura de audio con cpal: micrófono (dispositivo de entrada por defecto) y,
//! en Windows, el audio del sistema con WASAPI loopback (un stream de entrada
//! sobre el dispositivo de salida). Las muestras se juntan en mono f32 y se
//! convierten a WAV de 16 kHz para subir.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;

/// Buffer compartido: muestras mono y su sample rate.
#[derive(Clone)]
pub struct SharedBuffer {
    pub samples: Arc<Mutex<Vec<f32>>>,
    pub sample_rate: u32,
}

impl SharedBuffer {
    pub fn new(sample_rate: u32) -> Self {
        Self { samples: Arc::new(Mutex::new(Vec::with_capacity(sample_rate as usize * 30))), sample_rate }
    }

    /// Saca todo lo acumulado (para cortar un trozo).
    pub fn take(&self) -> Vec<f32> {
        std::mem::take(&mut *self.samples.lock())
    }
}

/// Un stream de cpal vivo; al soltarlo se corta la captura.
pub struct Capture {
    _stream: cpal::Stream,
    pub buffer: SharedBuffer,
}

fn push_mono(buffer: &SharedBuffer, data: &[f32], channels: usize) {
    let mut out = buffer.samples.lock();
    if channels <= 1 {
        out.extend_from_slice(data);
        return;
    }
    for frame in data.chunks(channels) {
        out.push(frame.iter().sum::<f32>() / channels as f32);
    }
}

fn build(device: &cpal::Device, config: cpal::SupportedStreamConfig) -> Result<Capture> {
    let channels = config.channels() as usize;
    let buffer = SharedBuffer::new(config.sample_rate().0);
    let err_fn = |e| eprintln!("[voice] audio stream error: {e}");
    let stream_config: cpal::StreamConfig = config.clone().into();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let b = buffer.clone();
            device.build_input_stream(&stream_config, move |data: &[f32], _| push_mono(&b, data, channels), err_fn, None)?
        }
        cpal::SampleFormat::I16 => {
            let b = buffer.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let f: Vec<f32> = data.iter().map(|s| *s as f32 / i16::MAX as f32).collect();
                    push_mono(&b, &f, channels)
                },
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let b = buffer.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let f: Vec<f32> = data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect();
                    push_mono(&b, &f, channels)
                },
                err_fn,
                None,
            )?
        }
        other => return Err(anyhow!("unsupported sample format {other:?}")),
    };
    stream.play()?;
    Ok(Capture { _stream: stream, buffer })
}

/// Micrófono por defecto.
pub fn capture_mic() -> Result<Capture> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| anyhow!("no microphone"))?;
    let config = device.default_input_config()?;
    build(&device, config)
}

/// Windows: audio del sistema por WASAPI loopback (entrada sobre el dispositivo de salida).
#[cfg(target_os = "windows")]
pub fn capture_loopback() -> Result<Capture> {
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or_else(|| anyhow!("no output device"))?;
    let config = device.default_output_config()?;
    build(&device, config)
}

/// Remuestreo lineal a 16 kHz (alcanza para voz y achica 3 veces el archivo).
pub fn resample_16k(input: &[f32], from_rate: u32) -> Vec<f32> {
    const TARGET: u32 = 16_000;
    if from_rate == TARGET || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / TARGET as f64;
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = input[idx];
        let b = *input.get(idx + 1).unwrap_or(&a);
        out.push(a + (b - a) * frac);
    }
    out
}

/// Pico del audio (0..1): los trozos en silencio no se suben.
pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, s| m.max(s.abs()))
}

/// WAV PCM 16-bit mono de 16 kHz en memoria.
pub fn to_wav_16k(samples: &[f32], from_rate: u32) -> Result<Vec<u8>> {
    let data = resample_16k(samples, from_rate);
    let spec = hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cursor = std::io::Cursor::new(Vec::with_capacity(data.len() * 2 + 44));
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for s in data {
            writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}

/// Duración en ms de `n` muestras a `rate`.
pub fn duration_ms(n: usize, rate: u32) -> u64 {
    if rate == 0 {
        return 0;
    }
    (n as u64 * 1000) / rate as u64
}
