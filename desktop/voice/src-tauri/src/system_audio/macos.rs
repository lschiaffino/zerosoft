//! macOS: audio del sistema con ScreenCaptureKit (macOS 13+). Se pide un
//! stream de la pantalla principal con audio y se descarta el video. La
//! primera vez macOS pide el permiso de "Grabación de pantalla y audio".
//!
//! API del crate `screencapturekit` 0.3: si cambia entre versiones, este es el
//! único archivo que hay que ajustar.

use anyhow::{anyhow, Result};
use screencapturekit::{
    output::CMSampleBuffer,
    shareable_content::SCShareableContent,
    stream::{
        configuration::SCStreamConfiguration, content_filter::SCContentFilter, output_trait::SCStreamOutputTrait,
        output_type::SCStreamOutputType, SCStream,
    },
};

use crate::audio::SharedBuffer;

const SAMPLE_RATE: u32 = 48_000;

struct AudioOut {
    buffer: SharedBuffer,
}

impl SCStreamOutputTrait for AudioOut {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Audio) {
            return;
        }
        let Ok(list) = sample.get_audio_buffer_list() else { return };
        // Buffers de f32 no intercalados: se promedian los canales.
        let channels: Vec<&[u8]> = list.buffers().iter().map(|b| b.data()).collect();
        if channels.is_empty() {
            return;
        }
        let frames = channels[0].len() / 4;
        let mut out = self.buffer.samples.lock();
        for i in 0..frames {
            let mut sum = 0.0f32;
            for ch in &channels {
                let bytes = [ch[i * 4], ch[i * 4 + 1], ch[i * 4 + 2], ch[i * 4 + 3]];
                sum += f32::from_le_bytes(bytes);
            }
            out.push(sum / channels.len() as f32);
        }
    }
}

pub struct MacCapture {
    stream: SCStream,
}

impl Drop for MacCapture {
    fn drop(&mut self) {
        let _ = self.stream.stop_capture();
    }
}

pub fn start() -> Result<(SharedBuffer, MacCapture)> {
    let content = SCShareableContent::get().map_err(|e| anyhow!("screen capture permission: {e:?}"))?;
    let display = content.displays().into_iter().next().ok_or_else(|| anyhow!("no display"))?;
    let filter = SCContentFilter::new().with_display_excluding_windows(&display, &[]);
    let config = SCStreamConfiguration::new()
        .set_captures_audio(true)
        .map_err(|e| anyhow!("{e:?}"))?
        .set_sample_rate(SAMPLE_RATE)
        .map_err(|e| anyhow!("{e:?}"))?
        .set_channel_count(2)
        .map_err(|e| anyhow!("{e:?}"))?
        // Video mínimo: ScreenCaptureKit exige un stream de pantalla.
        .set_width(2)
        .map_err(|e| anyhow!("{e:?}"))?
        .set_height(2)
        .map_err(|e| anyhow!("{e:?}"))?;
    let buffer = SharedBuffer::new(SAMPLE_RATE);
    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(AudioOut { buffer: buffer.clone() }, SCStreamOutputType::Audio);
    stream.start_capture().map_err(|e| anyhow!("start capture: {e:?}"))?;
    Ok((buffer, MacCapture { stream }))
}
