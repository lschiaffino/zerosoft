/**
 * Pure, deterministic SVG generator for product Open Graph images (1200x630).
 * Same monochrome zero-only visual language as lib/blog-cover.ts:
 * a faint oversized zero, a ring of small zeros, and quiet wave rows —
 * plus the product name and the zerosoft.ai wordmark.
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateProductOGSVG(product: string, name: string, num: string): string {
  const seed = hash(`product:${product}`);
  const width = 1200;
  const height = 630;
  const fontFamily = "'IBM Plex Mono', ui-monospace, monospace";

  // 1. Faint oversized zero, centered right.
  const bigZeroSize = height * 1.05;
  const bigZeroX = width * 0.72;
  const bigZero = `<text x="${bigZeroX}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" fill="#ffffff" opacity="${lerp(0.04, 0.08, rnd(seed, 900)).toFixed(3)}" font-family="${fontFamily}" font-size="${bigZeroSize.toFixed(2)}" font-weight="500" style="pointer-events:none">0</text>`;

  // 2. Ring of small zeros around the big zero's silhouette.
  const cx = bigZeroX;
  const cy = height / 2;
  const rx = width * 0.16;
  const ry = height * 0.36;
  const ringChars: string[] = [];
  const ringCount = 26;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx + (rnd(seed, i) - 0.5) * 10;
    const y = cy + Math.sin(a) * ry + (rnd(seed, i + 100) - 0.5) * 10;
    const size = lerp(10, 18, rnd(seed, i + 200));
    const opacity = lerp(0.15, 0.5, rnd(seed, i + 300));
    ringChars.push(
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-size="${size.toFixed(2)}" opacity="${opacity.toFixed(3)}">0</text>`,
    );
  }
  const ring = `<g fill="#ffffff" font-family="${fontFamily}" font-weight="500" style="pointer-events:none">${ringChars.join('')}</g>`;

  // 3. Two quiet wave rows crossing the canvas.
  const rows: string[] = [];
  for (let r = 0; r < 2; r++) {
    const baseline = lerp(height * 0.2, height * 0.8, rnd(seed, 50 + r));
    const amplitude = lerp(14, 34, rnd(seed, 60 + r));
    const freq = lerp(0.006, 0.012, rnd(seed, 70 + r));
    const phase = rnd(seed, 80 + r) * Math.PI * 2;
    const chars: string[] = [];
    const count = 34;
    for (let i = 0; i <= count; i++) {
      const x = (i / count) * width;
      const dy = Math.sin(x * freq * Math.PI * 2 + phase) * amplitude;
      chars.push(
        `<text x="${x.toFixed(2)}" y="${(baseline + dy).toFixed(2)}" text-anchor="middle" dominant-baseline="middle">0</text>`,
      );
    }
    rows.push(
      `<g fill="#ffffff" opacity="${lerp(0.06, 0.14, rnd(seed, 90 + r)).toFixed(3)}" font-family="${fontFamily}" font-size="22" font-weight="500" style="pointer-events:none">${chars.join('')}</g>`,
    );
  }

  // 4. Brand mark top-left, product num + name bottom-left, domain bottom-right.
  const wordmark = `<text x="64" y="96" fill="#ffffff" opacity="0.9" font-family="${fontFamily}" font-size="40" font-weight="700">0</text>`;
  const productNum = `<text x="64" y="${height - 196}" fill="#ffffff" opacity="0.45" font-family="${fontFamily}" font-size="24" font-weight="500">${escapeXml(num)} / 05</text>`;
  const productName = `<text x="64" y="${height - 104}" fill="#ffffff" font-family="${fontFamily}" font-size="96" font-weight="700">${escapeXml(name)}</text>`;
  const tagline = `<text x="${width - 64}" y="${height - 84}" text-anchor="end" fill="#ffffff" opacity="0.55" font-family="${fontFamily}" font-size="26" font-weight="500">zerosoft.ai</text>`;

  return (
    `<svg role="img" aria-label="${escapeXml(`zerosoft.ai ${name}`)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="#0a0a0a"/>` +
    bigZero +
    ring +
    rows.join('') +
    wordmark +
    productNum +
    productName +
    tagline +
    `</svg>`
  );
}
