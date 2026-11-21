import { describe, expect, it } from 'vitest';
import { parseAutoplayParam, parseStartParam, recEmbedCode, recEmbedSrc } from '@/lib/rec-schema';

describe('Rec: opciones del embed (t y autoplay, como Loom)', () => {
  it('autoplay solo con 1, true o yes', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' 1 ']) expect(parseAutoplayParam(v)).toBe(true);
    for (const v of [null, undefined, '', '0', 'false', 'no', 'on', '11']) expect(parseAutoplayParam(v)).toBe(false);
  });

  it('arma la dirección del embed con sus opciones', () => {
    const share = 'https://zerosoft.ai/en/v/abc12345';
    expect(recEmbedSrc(share)).toBe(`${share}/embed`);
    expect(recEmbedSrc(`${share}/`)).toBe(`${share}/embed`);
    expect(recEmbedSrc(share, { start: 90 })).toBe(`${share}/embed?t=90`);
    expect(recEmbedSrc(share, { start: 90.7, autoplay: true })).toBe(`${share}/embed?t=90&autoplay=1`);
    expect(recEmbedSrc(share, { start: 0, autoplay: true })).toBe(`${share}/embed?autoplay=1`);
    expect(recEmbedSrc(share, { start: null, autoplay: false })).toBe(`${share}/embed`);
  });

  it('el campo "Empezar en" entiende los mismos formatos que el link', () => {
    expect(parseStartParam('1:30')).toBe(90);
    expect(parseStartParam('1m30s')).toBe(90);
    expect(parseStartParam('90')).toBe(90);
    expect(parseStartParam('1:75')).toBeNull();
    expect(parseStartParam('abc')).toBeNull();
  });

  it('escapa el título y el & de la dirección en el iframe', () => {
    const html = recEmbedCode('https://x.test/en/v/abc12345/embed?t=5&autoplay=1', 'Q&A "demo" <b>');
    expect(html).toContain('src="https://x.test/en/v/abc12345/embed?t=5&amp;autoplay=1"');
    expect(html).toContain('title="Q&amp;A &quot;demo&quot; &lt;b&gt;"');
    expect(html).toContain('allow="autoplay; fullscreen"');
    expect(html).not.toMatch(/<b>/);
  });
});
