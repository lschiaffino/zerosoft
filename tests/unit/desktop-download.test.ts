import { describe, expect, it } from 'vitest';
import { asPlacement, downloadHref, isDesktopOs, osFromUserAgent } from '@/lib/desktop-os';
import { downloadClickProps } from '@/lib/desktop-track';
import { showDesktopHint } from '@/lib/desktop-hint';
import { desktopNotifyNote } from '@/lib/desktop-email';
import { renderBrandedHtml } from '@/lib/email';
import { buildTrackEmail } from '@/lib/track-notify';

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  chromeos: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
};

describe('sistema para la app de escritorio', () => {
  it('Mac, Windows, teléfono y el resto', () => {
    expect(osFromUserAgent(UA.macSafari)).toBe('mac-arm');
    expect(osFromUserAgent(UA.winChrome)).toBe('win');
    expect(osFromUserAgent(UA.linux)).toBe('other');
    expect(osFromUserAgent(UA.chromeos)).toBe('other');
    expect(osFromUserAgent(UA.iphone)).toBe('mobile');
    expect(osFromUserAgent(UA.android)).toBe('mobile');
    // El iPad se presenta como Mac pero tiene pantalla táctil.
    expect(osFromUserAgent(UA.macSafari, 5)).toBe('mobile');
  });

  it('solo sistemas y lugares conocidos', () => {
    expect(isDesktopOs('win')).toBe(true);
    expect(isDesktopOs('linux')).toBe(false);
    expect(isDesktopOs(null)).toBe(false);
    expect(asPlacement('header')).toBe('header');
    expect(asPlacement('email')).toBe('email');
    expect(asPlacement('<script>')).toBe('other');
    expect(asPlacement(null)).toBe('other');
  });

  it('los botones pasan por el contador con lugar, sistema e idioma', () => {
    expect(downloadHref('header', { os: 'mac-arm', locale: 'es' })).toBe('/api/desktop/download?from=header&os=mac-arm&locale=es');
    expect(downloadHref('footer')).toBe('/api/desktop/download?from=footer');
  });

  it('el evento download_click no guarda la query de la página', () => {
    const props = downloadClickProps({ placement: 'product', os: null, locale: 'pt', referer: 'https://zerosoft.ai/pt/products/voice?utm=x#desktop', signedIn: true });
    expect(props).toEqual({ placement: 'product', os: 'none', locale: 'pt', signed_in: true, $current_url: 'https://zerosoft.ai/pt/products/voice' });
    expect(downloadClickProps({ placement: 'email', os: 'win', locale: 'en', referer: null, signedIn: false })).not.toHaveProperty('$current_url');
  });
});

describe('tarjeta del inicio', () => {
  it('solo a quien no la instaló ni la cerró', () => {
    expect(showDesktopHint({ installed: false, dismissed: false })).toBe(true);
    expect(showDesktopHint({ installed: true, dismissed: false })).toBe(false);
    expect(showDesktopHint({ installed: false, dismissed: true })).toBe(false);
  });
});

describe('línea de la app de escritorio en los emails de avisos', () => {
  it('va escapada, con el link del contador, en HTML y en texto', () => {
    const note = desktopNotifyNote('es', 'https://zerosoft.ai');
    expect(note.html).toContain('href="https://zerosoft.ai/api/desktop/download?from=email&amp;locale=es"');
    expect(note.text).toContain('https://zerosoft.ai/api/desktop/download?from=email&locale=es');
    const html = renderBrandedHtml({ heading: 'x', paragraphs: ['y'], note: note.html });
    expect(html).toContain('notificación en la app de escritorio');
    expect(renderBrandedHtml({ heading: 'x', paragraphs: ['y'] })).not.toContain('/api/desktop/download');
  });

  it('Track: con la nota en el pie, o sin ella si ya tiene la app', () => {
    const item = { id: 'n1', type: 'track_assigned', title: 'ENG-1', body: null, href: '/app/track/issue/ENG-1', meta: '{}', created_at: '2026-11-01T00:00:00Z' };
    const note = desktopNotifyNote('en', 'https://zerosoft.ai');
    const withNote = buildTrackEmail([item as never], 'en', 'digest', 1, note);
    expect(withNote.html).toContain('/api/desktop/download?from=email');
    expect(withNote.text).toContain(note.text);
    const without = buildTrackEmail([item as never], 'en', 'digest', 1, null);
    expect(without.html).not.toContain('/api/desktop/download');
  });
});
