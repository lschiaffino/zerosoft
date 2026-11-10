// ffprobe/ffmpeg checks used by the self-test.
import { run } from './proc.js';

/**
 * @param {string} ffprobe
 * @param {string} file
 */
export async function probe(ffprobe, file) {
  const r = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', file]);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    return {
      format: String(j.format?.format_name || ''),
      durationSec: Number(j.format?.duration || 0),
      streams: (j.streams || []).map((/** @type {any} */ s) => ({
        type: s.codec_type,
        codec: s.codec_name,
        width: s.width,
        height: s.height,
        sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
        channels: s.channels,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Fully decodes the file; true if ffmpeg reports no errors.
 * @param {string} ffmpeg
 * @param {string} file
 */
export async function decodes(ffmpeg, file) {
  const r = await run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-f', 'null', '-'], { timeoutMs: 120000 });
  return r.code === 0 && !r.stderr.trim();
}

/**
 * Max and mean volume of the audio track, in dB.
 * @param {string} ffmpeg
 * @param {string} file
 */
export async function volume(ffmpeg, file) {
  const r = await run(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { timeoutMs: 120000 });
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(r.stderr);
  const n = (/** @type {RegExpExecArray|null} */ m) => (m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : null);
  return { maxDb: n(max), meanDb: n(mean) };
}

/**
 * Average luma and its spread over the video, to tell a blank screen from a page.
 * @param {string} ffmpeg
 * @param {string} file
 */
export async function lumaStats(ffmpeg, file) {
  const r = await run(
    ffmpeg,
    ['-hide_banner', '-nostdin', '-i', file, '-an', '-vf', 'fps=1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'],
    { timeoutMs: 120000 },
  );
  const vals = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  if (!vals.length) return null;
  return { frames: vals.length, minYavg: Math.min(...vals), maxYavg: Math.max(...vals) };
}
