import { describe, expect, it } from 'vitest';
import { DEFAULT_HELP_ACCENT, contrastRatio, helpAccent, helpAccentStyle } from '@/lib/docs-accent';

describe('Centro de ayuda: color del workspace', () => {
  it('sin color usa la línea de Docs', () => {
    expect(helpAccent(null).line).toBe(DEFAULT_HELP_ACCENT);
    expect(helpAccent('no-es-hex').line).toBe(DEFAULT_HELP_ACCENT);
  });

  it('el texto en el color siempre pasa AA sobre blanco', () => {
    for (const color of ['#e6b400', '#00b8a9', '#ffff00', '#7b4dff', '#fff', '#2f6bff']) {
      const a = helpAccent(color);
      expect(contrastRatio(a.ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('un color oscuro se usa tal cual como texto', () => {
    expect(helpAccent('#7B4DFF').ink).toBe('#7b4dff');
  });

  it('el texto sobre el relleno elige blanco o tinta según contraste', () => {
    expect(helpAccent('#e6b400').on).toBe('#111111');
    expect(helpAccent('#1d4ed8').on).toBe('#ffffff');
  });

  it('expone las variables CSS del acento', () => {
    const style = helpAccentStyle('#0e9f6e');
    expect(style['--help-accent']).toBe('#0e9f6e');
    expect(style['--accent']).toBe('#0e9f6e');
    expect(contrastRatio(style['--help-accent-ink'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
