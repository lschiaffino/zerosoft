/**
 * Pure, deterministic SVG cover generator for blog posts.
 * Shared between the BlogCover component and the /api/og/blog endpoint.
 *
 * Each cover is built from three zero-only layers:
 * 1. A faint, oversized background zero.
 * 2. A field of tiny zeros arranged in the shape of a large zero (the glyph ring).
 * 3. Decorative wave rows that flow across the canvas.
 */

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) + h + str.charCodeAt(i);
  }
  return Math.abs(h);
}

function fract(n: number): number {
  return n - Math.floor(n);
}

function rnd(seed: number, offset = 0): number {
  return fract(Math.sin(seed + offset * 12.9898) * 43758.5453);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface GlyphParticle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  rotate: number;
}

interface WaveRow {
  y: number;
  fontSize: number;
  opacity: number;
  chars: { x: number; dy: number; rotate: number }[];
}

function buildWaveRow(seed: number, idx: number, width: number, height: number): WaveRow {
  const count = Math.floor(lerp(22, 38, rnd(seed, idx)));
  const fontSize = lerp(height * 0.06, height * 0.13, rnd(seed, idx + 100));
  const baseline = lerp(height * 0.18, height * 0.82, rnd(seed, idx + 200));
  const amplitude = lerp(height * 0.03, height * 0.11, rnd(seed, idx + 300));
  const freq = lerp(0.006, 0.018, rnd(seed, idx + 400)) * (rnd(seed, idx + 450) > 0.5 ? 1 : -1);
  const phase = rnd(seed, idx + 500) * Math.PI * 2;
  const opacity = lerp(0.08, 0.35, rnd(seed, idx + 600));

  const chars: WaveRow['chars'] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = t * width;
    const wave = Math.sin(x * freq * Math.PI * 2 + phase);
    const dy = wave * amplitude;
    const rotate = wave * lerp(-10, 10, rnd(seed, idx + 700 + i));
    chars.push({ x, dy, rotate });
  }

  return { y: baseline, fontSize, opacity, chars };
}

function buildGlyphParticles(
  seed: number,
  width: number,
  height: number,
  variant: 'card' | 'hero'
): GlyphParticle[] {
  const particles: GlyphParticle[] = [];

  // The zero glyph is an ellipse ring centered on the canvas.
  const cx = width * 0.5;
  const cy = height * 0.5;
  const rx = width * (variant === 'hero' ? 0.24 : 0.22);
  const ry = height * (variant === 'hero' ? 0.34 : 0.36);
  const thickness = Math.min(rx, ry) * 0.38;

  const gap = Math.max(10, Math.round(Math.min(rx, ry) / 14));
  const jitter = gap * 0.22;

  for (let y = Math.floor(cy - ry - gap); y <= cy + ry + gap; y += gap) {
    for (let x = Math.floor(cx - rx - gap); x <= cx + rx + gap; x += gap) {
      const dx = x - cx;
      const dy = y - cy;
      const outer = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
      const innerRx = Math.max(1, rx - thickness);
      const innerRy = Math.max(1, ry - thickness);
      const inner = (dx * dx) / (innerRx * innerRx) + (dy * dy) / (innerRy * innerRy);

      if (outer <= 1 && inner >= 1) {
        const n = rnd(seed, x * 73856093 ^ y * 19349663);
        particles.push({
          x: x + (n - 0.5) * jitter * 2,
          y: y + (rnd(seed, n * 1000) - 0.5) * jitter * 2,
          size: gap * lerp(0.75, 1.15, rnd(seed, x + y)),
          opacity: lerp(0.25, 0.85, rnd(seed, x * y + 1)),
          rotate: lerp(-8, 8, rnd(seed, x - y)),
        });
      }
    }
  }

  return particles;
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(seed, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function generateBlogCoverSVG(
  slug: string,
  title: string,
  variant: 'card' | 'hero' = 'card'
): string {
  const seed = hash(slug);
  const width = variant === 'hero' ? 1200 : 600;
  const height = variant === 'hero' ? 400 : 300;

  const fontFamily = "'JetBrains Mono', ui-monospace, monospace";
  const escapeXml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 1. Background big zero.
  const bigZeroSize = Math.min(width, height) * (variant === 'hero' ? 0.82 : 0.95);
  const bigZeroOpacity = lerp(0.03, 0.07, rnd(seed, 900));

  // 2. Zero made of zeros.
  const glyphParticles = seededShuffle(buildGlyphParticles(seed, width, height, variant), seed + 11);

  // 3. Decorative wave rows.
  const rowCount = Math.floor(lerp(5, 10, rnd(seed, 50)));
  const rows = Array.from({ length: rowCount }, (_, i) => buildWaveRow(seed, i + 1, width, height));

  // Compose layers from back to front.
  const backgroundZero = `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" opacity="${bigZeroOpacity.toFixed(3)}" font-family="${fontFamily}" font-size="${bigZeroSize.toFixed(2)}" font-weight="500" style="pointer-events:none">0</text>`;

  const glyphGroup = `<g fill="#ffffff" font-family="${fontFamily}" font-weight="500" style="pointer-events:none">${glyphParticles
    .map(
      (p) =>
        `<text x="${p.x.toFixed(2)}" y="${p.y.toFixed(2)}" transform="rotate(${p.rotate.toFixed(2)}, ${p.x.toFixed(2)}, ${p.y.toFixed(2)})" text-anchor="middle" dominant-baseline="middle" font-size="${p.size.toFixed(2)}" opacity="${p.opacity.toFixed(3)}">0</text>`
    )
    .join('')}</g>`;

  const waveGroups = rows
    .map((row) => {
      const chars = row.chars
        .map(
          (c) =>
            `<text x="${c.x.toFixed(2)}" y="${row.y.toFixed(2)}" dy="${c.dy.toFixed(2)}" transform="rotate(${c.rotate.toFixed(2)}, ${c.x.toFixed(2)}, ${(row.y + c.dy).toFixed(2)})" text-anchor="middle" dominant-baseline="middle">0</text>`
        )
        .join('');
      return `<g fill="#ffffff" opacity="${row.opacity.toFixed(3)}" font-family="${fontFamily}" font-size="${row.fontSize.toFixed(2)}" font-weight="500" style="pointer-events:none">${chars}</g>`;
    })
    .join('');

  return (
    `<svg role="img" aria-label="${escapeXml(`Cover for ${title}`)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="#0a0a0a"/>` +
    backgroundZero +
    glyphGroup +
    waveGroups +
    `</svg>`
  );
}
